// Integración contra Postgres real (ver src/lib/accounting/__tests__/db-harness.ts).
// Se omite sin UTOPIA_TEST_DATABASE_URL.
//
// Partes IV/V: el resultado se guarda en `reports` (jsonb, kind
// 'financial_audit_result') atado a la versión del informe, y se lee por
// {resultId, resultHash} DENTRO del workspace. Aquí se comprueba con Postgres
// lo que el fake de las pruebas de rutas sólo simula: que el viaje por jsonb
// reproduce la huella del sobre y que el filtro por workspace/kind es real.

import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { HAS_TEST_DB } from '@/lib/accounting/__tests__/db-harness';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import { buildAuditResultVersion } from '../audit-result-version';

const REPORT_REF = { reportId: '0b9c7d1e-2f3a-4b5c-8d6e-7f8091a2b3c4', reportHash: 'a'.repeat(64) };

function audit(overrides: Partial<AuditReport> = {}): AuditReport {
  const domains = ['niif', 'tributario', 'legal', 'revisoria'] as const;
  return {
    company: { name: 'Empresa Prueba SAS', nit: '900123456-8', fiscalPeriod: '2025' },
    auditorResults: domains.map((domain) => ({
      domain, auditorName: `Auditor ${domain}`, complianceScore: 87.5,
      findings: [], summary: 'ñ — acentos y comillas "dobles"', fullContent: '', failed: false,
    })),
    overallScore: 87.5,
    opinionType: 'con_salvedades',
    opinionText: 'Con salvedades.',
    consolidatedFindings: [],
    findingCounts: { critico: 0, alto: 1, medio: 0, bajo: 0, informativo: 0 },
    executiveSummary: 'Resumen.',
    consolidatedReport: '# Dictámenes',
    generatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

describe.skipIf(!HAS_TEST_DB)('resultado persistido de las Partes IV/V — Postgres', () => {
  let W1: string;
  let W2: string;

  beforeAll(async () => {
    const { getDb } = await import('@/lib/db/client');
    const { workspaces } = await import('@/lib/db/schema');
    const [a] = await getDb().insert(workspaces).values({ name: `iv-a-${Date.now()}` }).returning();
    const [b] = await getDb().insert(workspaces).values({ name: `iv-b-${Date.now()}` }).returning();
    W1 = a.id;
    W2 = b.id;
  }, 60_000);

  const version = () => buildAuditResultVersion({
    part: 'iv', reportRef: REPORT_REF, auditRef: null, language: 'es', result: audit(),
  });

  it('persiste y relee el resultado por referencia: jsonb reproduce la huella del sobre', async () => {
    const { persistAuditResult, loadAuditResult } = await import('../audit-result-store');
    const v = version();
    const saved = await persistAuditResult({ workspaceId: W1, version: v });
    expect(saved.status).toBe('persisted');
    if (saved.status !== 'persisted') return;
    const loaded = await loadAuditResult(W1, saved.ref, 'iv');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.resultHash).toBe(v.resultHash);
    expect(loaded.data.reportRef).toEqual(REPORT_REF);
    expect((loaded.data.result as AuditReport).overallScore).toBe(87.5);
  });

  it('otro workspace o id inexistente → 404 idéntico; otra huella → 409; fila alterada → 409', async () => {
    const { persistAuditResult, loadAuditResult } = await import('../audit-result-store');
    const { getDb } = await import('@/lib/db/client');
    const { reports } = await import('@/lib/db/schema');
    const saved = await persistAuditResult({ workspaceId: W1, version: version() });
    if (saved.status !== 'persisted') throw new Error('no persistió');

    const foreign = await loadAuditResult(W2, saved.ref, 'iv');
    const missing = await loadAuditResult(W1, { ...saved.ref, resultId: '33333333-3333-4333-8333-333333333333' }, 'iv');
    expect(foreign).toEqual(missing);
    expect(foreign).toMatchObject({ ok: false, status: 404 });

    expect(await loadAuditResult(W1, { ...saved.ref, resultHash: 'f'.repeat(64) }, 'iv'))
      .toMatchObject({ ok: false, status: 409, code: 'AUDIT_RESULT_MISMATCH' });
    expect(await loadAuditResult(W1, saved.ref, 'v'))
      .toMatchObject({ ok: false, status: 409, code: 'AUDIT_RESULT_PART_MISMATCH' });

    const [row] = await getDb().select({ data: reports.data }).from(reports).where(eq(reports.id, saved.ref.resultId));
    const data = row.data as { result: AuditReport };
    data.result.opinionType = 'favorable';
    await getDb().update(reports).set({ data }).where(eq(reports.id, saved.ref.resultId));
    expect(await loadAuditResult(W1, saved.ref, 'iv'))
      .toMatchObject({ ok: false, status: 409, code: 'AUDIT_RESULT_INTEGRITY' });
  });

  it('un id de versión del informe no se lee como resultado aunque sea del mismo workspace', async () => {
    const { loadAuditResult } = await import('../audit-result-store');
    const { getDb } = await import('@/lib/db/client');
    const { reports } = await import('@/lib/db/schema');
    const v = version();
    const [row] = await getDb().insert(reports)
      .values({ workspaceId: W1, kind: 'financial_report', data: v as unknown as Record<string, unknown> })
      .returning({ id: reports.id });
    expect(await loadAuditResult(W1, { resultId: row.id, resultHash: v.resultHash }, 'iv'))
      .toMatchObject({ ok: false, status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Procedencia servidor (P1) — el veredicto del acta lo fija el servidor
// ---------------------------------------------------------------------------
// /consolidate persiste la Parte III que envía el navegador. Si el cliente
// omitía o reescribía `actaQualifications`, la versión persistida salía con un
// acta cuyas cifras contradicen el balance y, como /export sólo mira ese flag,
// el Excel/PDF salía 200 sellado "PROCEDENCIA VERIFICADA" (mientras /html, que
// recalcula el acta, rechazaba la MISMA versión). Ahora /consolidate recalcula
// el acta contra el balance re-derivado y el veredicto del servidor sólo puede
// endurecer el del cliente.
//
// Alcance: `getDb()` es el fake de `provenance-fixture` y el workspace de la
// sesión se fija con un mock; no acredita aislamiento real de tenants.
// ---------------------------------------------------------------------------

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));

import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import {
  PROVENANCE_COMPANY,
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const COMPANY = PROVENANCE_COMPANY;
const read = preprocessUploadedTrialBalanceText(consolidateBody().rawData);
if (read.kind !== 'ok') throw new Error('fixture sin balance');
const pp = read.preprocessed;
/** Utilidad neta del P&G del fixture (Activo $10.000): $2.000 en centavos. */
const NET_INCOME = '200000';
let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

/** Acta estructurada con la utilidad neta dada. */
function acta(netIncomeCop: string) {
  const exp = buildActaExpectedArithmetic({ ...COMPANY, niifGroup: 2 }, pp)!;
  return {
    shareholderMinutes: {
      resultDistribution: {
        netIncomeCop,
        applies: exp.distributionApplies,
        lines: [],
        neutralProposalText: 'La asamblea decide sobre la destinación de la utilidad.',
      },
      capitalizationProposal: {
        applies: exp.capitalizationApplies,
        retainedEarningsBaseCop: exp.capitalizationBaseCop,
        capitalizationAmountCop: exp.capitalizationAmountCop,
        legalReference: 'Ley 1258/2008',
        body: 'No se propone capitalización.',
      },
    },
  };
}

function parts(netIncomeCop: string, actaQualifications?: unknown) {
  const r = makeProvenanceParts();
  (r.governance as { json?: unknown }).json = acta(netIncomeCop);
  if (actaQualifications !== undefined) {
    (r.governance as { actaQualifications?: unknown }).actaQualifications = actaQualifications;
  }
  return r;
}

async function consolidateWith(reportParts: unknown) {
  const res = await consolidate(
    new Request('http://localhost/api/financial-report/consolidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(consolidateBody({ reportParts })),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { report: FinancialReport; reportRef?: { reportId: string; reportHash: string } };
}

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-tests';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  if (previousDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDbUrl;
});

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeReportsTableFake();
  state.db = fake.db;
  state.workspace = W1;
});

describe('/consolidate recalcula el veredicto del acta antes de persistir', () => {
  it('acta que contradice el P&G y SIN veredicto del cliente → versión persistida con salvedad y export 422', async () => {
    const out = await consolidateWith(parts('99999900'));
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    expect(stored.governance.actaQualifications?.clean).toBe(false);
    expect(stored.governance.actaQualifications?.motivos.join('\n')).toMatch(/Utilidad Neta del acta/);
    // Plegado sobre la reconciliación: el canal que apaga las descargas en la UI.
    expect(stored.niifAnalysis.reconciliation?.clean).toBe(false);
    expect(out.report.governance.actaQualifications?.clean).toBe(false);

    const res = await exportReport(
      new Request('http://localhost/api/financial-report/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportRef: out.reportRef, format: 'excel' }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { details: string[] }).details).toContain(
      'El informe contiene salvedades o validaciones bloqueantes.',
    );
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('un `clean: true` del cliente no levanta la salvedad del servidor', async () => {
    await consolidateWith(parts('99999900', { clean: true, motivos: [] }));
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    expect(stored.governance.actaQualifications?.clean).toBe(false);
  });

  it('un `clean: false` del cliente se conserva aunque el servidor no encuentre desviaciones', async () => {
    await consolidateWith(parts(NET_INCOME, { clean: false, motivos: ['Motivo del especialista'] }));
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    expect(stored.governance.actaQualifications).toEqual({ clean: false, motivos: ['Motivo del especialista'] });
  });

  it('acta honesta (utilidad neta del P&G): sin salvedad, reconciliación intacta y export 200', async () => {
    const out = await consolidateWith(parts(NET_INCOME));
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    expect(stored.governance.actaQualifications).toEqual({ clean: true, motivos: [] });
    expect(stored.niifAnalysis.reconciliation?.clean).toBe(true);
    const res = await exportReport(
      new Request('http://localhost/api/financial-report/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportRef: out.reportRef, format: 'excel' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
  });
});

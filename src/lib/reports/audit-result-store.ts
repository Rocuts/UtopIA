import 'server-only';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { reports } from '@/lib/db/schema';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import {
  FINANCIAL_AUDIT_RESULT_KIND,
  auditResultProvenanceOf,
  sameAuditResultRef,
  sameReportRef,
  verifyAuditResultVersion,
  type AuditResultData,
  type AuditResultPart,
  type AuditResultProvenance,
  type AuditResultRef,
} from './audit-result-version';
import type { ReportRef } from './report-ref';

// ---------------------------------------------------------------------------
// Almacenamiento de los resultados de las Partes IV y V en la tabla `reports`
// ---------------------------------------------------------------------------
// Mismo tenant y mismas reglas que las versiones del informe
// (financial-report-store.ts): el workspace sale SIEMPRE de la sesión, nunca
// del cuerpo; un id de otro workspace responde igual que uno inexistente.
// ---------------------------------------------------------------------------

export type PersistAuditResultOutcome =
  | { status: 'persisted'; ref: AuditResultRef; complete: boolean }
  | { status: 'not_persisted'; reason: 'no_database' | 'no_workspace' | 'storage_error' };

/** Inserta el resultado como fila nueva (una por ejecución de los agentes). */
export async function persistAuditResult(args: {
  workspaceId: string | null;
  version: AuditResultData;
  companyName?: string;
}): Promise<PersistAuditResultOutcome> {
  if (!process.env.DATABASE_URL) return { status: 'not_persisted', reason: 'no_database' };
  if (!args.workspaceId) return { status: 'not_persisted', reason: 'no_workspace' };
  const title = `${args.version.part === 'iv' ? 'Dictámenes' : 'Meta-auditoría'} ${args.companyName ?? ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  try {
    const [row] = await getDb()
      .insert(reports)
      .values({
        workspaceId: args.workspaceId,
        kind: FINANCIAL_AUDIT_RESULT_KIND,
        title,
        data: args.version as unknown as Record<string, unknown>,
      })
      .returning({ id: reports.id });
    if (!row?.id) return { status: 'not_persisted', reason: 'storage_error' };
    return {
      status: 'persisted',
      ref: { resultId: row.id, resultHash: args.version.resultHash },
      complete: args.version.complete,
    };
  } catch (err) {
    // El mensaje del driver puede llevar los parámetros SQL (el dictamen completo).
    console.error(
      '[reports/audit-result-store] no se pudo persistir el resultado:',
      err instanceof Error ? err.name : 'unknown',
    );
    return { status: 'not_persisted', reason: 'storage_error' };
  }
}

export type LoadAuditResultOutcome =
  | { ok: true; data: AuditResultData; provenance: AuditResultProvenance }
  | { ok: false; status: 404 | 409 | 503; code: string; error: string };

const NOT_FOUND: LoadAuditResultOutcome = {
  ok: false,
  status: 404,
  code: 'AUDIT_RESULT_NOT_FOUND',
  error: 'Audit result not found.',
};

/**
 * Carga el resultado referenciado DENTRO del workspace de la sesión.
 *
 *   - Sin DB, sin workspace, id inexistente o de otro workspace → 404 idéntico.
 *   - Misma fila con otra huella → 409 (el cliente trae otro resultado).
 *   - Fila cuya huella ya no reproduce su contenido → 409 (integridad).
 *   - Resultado de la otra Parte → 409.
 *   - Error de consulta → 503.
 */
export async function loadAuditResult(
  workspaceId: string | null,
  ref: AuditResultRef,
  part: AuditResultPart,
): Promise<LoadAuditResultOutcome> {
  if (!process.env.DATABASE_URL || !workspaceId) return NOT_FOUND;
  let rows: Array<{ id: string; data: unknown }>;
  try {
    rows = await getDb()
      .select({ id: reports.id, data: reports.data })
      .from(reports)
      .where(
        and(
          eq(reports.id, ref.resultId),
          eq(reports.workspaceId, workspaceId),
          eq(reports.kind, FINANCIAL_AUDIT_RESULT_KIND),
        ),
      )
      .limit(1);
  } catch (err) {
    console.error(
      '[reports/audit-result-store] lectura fallida:',
      err instanceof Error ? err.name : 'unknown',
    );
    return { ok: false, status: 503, code: 'AUDIT_RESULT_STORE_UNAVAILABLE', error: 'Audit result storage unavailable.' };
  }
  const row = rows[0];
  if (!row) return NOT_FOUND;
  const stored = row.data as { resultHash?: unknown } | null;
  if (!stored || stored.resultHash !== ref.resultHash) {
    return {
      ok: false,
      status: 409,
      code: 'AUDIT_RESULT_MISMATCH',
      error: 'The audit result does not match the persisted result it references.',
    };
  }
  const verified = verifyAuditResultVersion(row.data);
  if (!verified.ok) {
    console.error(`[reports/audit-result-store] resultado ${row.id} sin integridad: ${verified.reason}`);
    return {
      ok: false,
      status: 409,
      code: 'AUDIT_RESULT_INTEGRITY',
      error: 'The persisted audit result failed its integrity check.',
    };
  }
  if (verified.data.part !== part) {
    return {
      ok: false,
      status: 409,
      code: 'AUDIT_RESULT_PART_MISMATCH',
      error: 'The reference names a result of the other audit part.',
    };
  }
  return { ok: true, data: verified.data, provenance: auditResultProvenanceOf(row.id, verified.data) };
}

export type BoundAuditResults =
  | {
      ok: true;
      audit: AuditReport | null;
      quality: QualityAssessment | null;
      provenance: { audit: AuditResultProvenance | null; quality: AuditResultProvenance | null };
    }
  | { ok: false; status: 400 | 404 | 409 | 503; code: string; error: string };

function reject(status: 409, code: string, error: string): BoundAuditResults {
  return { ok: false, status, code, error };
}

/**
 * Carga los resultados que una descarga pide incluir y prueba que pertenecen a
 * la versión exportada:
 *
 *   - cada uno examinó EXACTAMENTE esa versión (`{reportId, reportHash}`);
 *   - cada uno está completo (un resultado parcial no se publica como el de
 *     registro);
 *   - la Parte V leyó exactamente la Parte IV enviada, en ambos sentidos: ni
 *     otra Parte IV, ni ninguna cuando se envía una.
 */
export async function loadBoundAuditResults(args: {
  workspaceId: string | null;
  reportRef: ReportRef;
  auditRef: AuditResultRef | null;
  qualityRef: AuditResultRef | null;
}): Promise<BoundAuditResults> {
  const loaded: Partial<Record<AuditResultPart, Extract<LoadAuditResultOutcome, { ok: true }>>> = {};
  for (const [part, ref] of [['iv', args.auditRef], ['v', args.qualityRef]] as const) {
    if (!ref) continue;
    const outcome = await loadAuditResult(args.workspaceId, ref, part);
    if (!outcome.ok) return outcome;
    if (!sameReportRef(outcome.data.reportRef, args.reportRef)) {
      return reject(409, 'AUDIT_RESULT_OTHER_VERSION', 'The audit result examined a different report version.');
    }
    if (!outcome.data.complete) {
      return reject(409, 'AUDIT_RESULT_INCOMPLETE', 'The audit result is incomplete and cannot be exported.');
    }
    loaded[part] = outcome;
  }
  const quality = loaded.v;
  if (quality && !sameAuditResultRef(quality.data.auditRef, args.auditRef)) {
    return reject(409, 'AUDIT_RESULT_PAIRING', 'The meta-audit examined a different audit result.');
  }
  return {
    ok: true,
    audit: (loaded.iv?.data.result as AuditReport | undefined) ?? null,
    quality: (quality?.data.result as QualityAssessment | undefined) ?? null,
    provenance: { audit: loaded.iv?.provenance ?? null, quality: quality?.provenance ?? null },
  };
}

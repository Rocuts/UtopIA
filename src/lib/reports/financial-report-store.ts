import 'server-only';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { reports } from '@/lib/db/schema';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import {
  FINANCIAL_REPORT_KIND,
  provenanceOf,
  verifyFinancialReportVersion,
  type FinancialReportVersionData,
} from './financial-report-version';
import type { AdjustmentsTrail } from './adjustment-ledger';
import type { ReportProvenance, ReportRef } from './report-ref';

// ---------------------------------------------------------------------------
// Almacenamiento de versiones del informe en la tabla `reports`
// ---------------------------------------------------------------------------
// Reutiliza la tabla y la resolución de tenant existentes (MAP.md, fila 1):
// `reports.kind = 'financial_report'`, `data` jsonb con la versión y
// `control_totals` con los totales del periodo primario. El tenant sale SIEMPRE
// de la sesión (`getCurrentWorkspaceId`: sesión BetterAuth o cookie del
// workspace anónimo, sin crearlo), nunca del cuerpo de la petición.
//
// Sin `DATABASE_URL` o sin workspace no hay procedencia servidor: quien llama
// sigue por el camino histórico y el artefacto se rotula "procedencia no
// verificada".
// ---------------------------------------------------------------------------

/** Workspace de la sesión para leer/escribir versiones; null si no hay DB o tenant. */
export async function resolveReportWorkspaceId(): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    return (await getCurrentWorkspaceId()) ?? null;
  } catch {
    return null;
  }
}

export type PersistVersionOutcome =
  | { status: 'persisted'; provenance: ReportProvenance }
  | { status: 'not_persisted'; reason: 'no_database' | 'no_workspace' | 'storage_error' };

/** Inserta la versión como fila nueva del workspace (una fila por consolidación). */
export async function persistFinancialReportVersion(args: {
  workspaceId: string | null;
  version: FinancialReportVersionData;
  controlTotals: unknown;
}): Promise<PersistVersionOutcome> {
  if (!process.env.DATABASE_URL) return { status: 'not_persisted', reason: 'no_database' };
  if (!args.workspaceId) return { status: 'not_persisted', reason: 'no_workspace' };
  const { report } = args.version;
  const title = `Informe financiero ${report.company?.name ?? ''} ${report.company?.fiscalPeriod ?? ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  try {
    const [row] = await getDb()
      .insert(reports)
      .values({
        workspaceId: args.workspaceId,
        kind: FINANCIAL_REPORT_KIND,
        title,
        data: args.version as unknown as Record<string, unknown>,
        controlTotals: (args.controlTotals ?? null) as Record<string, unknown> | null,
      })
      .returning({ id: reports.id });
    if (!row?.id) return { status: 'not_persisted', reason: 'storage_error' };
    return { status: 'persisted', provenance: provenanceOf(row.id, args.version) };
  } catch (err) {
    console.error(
      '[reports/financial-report-store] no se pudo persistir la versión:',
      err instanceof Error ? err.message : 'unknown',
    );
    return { status: 'not_persisted', reason: 'storage_error' };
  }
}

export type LoadVersionOutcome =
  | {
      ok: true;
      report: FinancialReport;
      preprocessed: PreprocessedBalance | undefined;
      provenance: ReportProvenance;
      /** Ajustes confirmados aplicados al balance de la versión (null sin ajustes). */
      adjustments: AdjustmentsTrail | null;
      /** Idioma del informe persistido. */
      language: 'es' | 'en';
    }
  | { ok: false; status: 404 | 409 | 503; code: string; error: string };

const NOT_FOUND: LoadVersionOutcome = {
  ok: false,
  status: 404,
  code: 'REPORT_VERSION_NOT_FOUND',
  error: 'Report version not found.',
};

/**
 * Carga la versión referenciada DENTRO del workspace de la sesión.
 *
 *   - Sin DB, sin workspace, id inexistente o de otro workspace → 404 idéntico
 *     (la respuesta no revela si la versión existe en otro tenant).
 *   - Misma fila con otra huella → 409 (la referencia no es la versión
 *     persistida: el cliente trae un informe distinto).
 *   - Fila cuya huella ya no reproduce su contenido → 409 (integridad).
 *   - Error de consulta → 503.
 */
export async function loadFinancialReportVersion(
  workspaceId: string | null,
  ref: ReportRef,
): Promise<LoadVersionOutcome> {
  if (!process.env.DATABASE_URL || !workspaceId) return NOT_FOUND;
  let rows: Array<{ id: string; data: unknown }>;
  try {
    rows = await getDb()
      .select({ id: reports.id, data: reports.data })
      .from(reports)
      .where(
        and(
          eq(reports.id, ref.reportId),
          eq(reports.workspaceId, workspaceId),
          eq(reports.kind, FINANCIAL_REPORT_KIND),
        ),
      )
      .limit(1);
  } catch (err) {
    console.error(
      '[reports/financial-report-store] lectura fallida:',
      err instanceof Error ? err.message : 'unknown',
    );
    return {
      ok: false,
      status: 503,
      code: 'REPORT_STORE_UNAVAILABLE',
      error: 'Report storage unavailable.',
    };
  }
  const row = rows[0];
  if (!row) return NOT_FOUND;
  const stored = row.data as { reportHash?: unknown } | null;
  if (!stored || stored.reportHash !== ref.reportHash) {
    return {
      ok: false,
      status: 409,
      code: 'REPORT_VERSION_MISMATCH',
      error: 'The report does not match the persisted version it references.',
    };
  }
  const verified = verifyFinancialReportVersion(row.data);
  if (!verified.ok) {
    console.error(`[reports/financial-report-store] versión ${row.id} sin integridad: ${verified.reason}`);
    return {
      ok: false,
      status: 409,
      code: 'REPORT_VERSION_INTEGRITY',
      error: 'The persisted report version failed its integrity check.',
    };
  }
  return {
    ok: true,
    report: verified.report,
    preprocessed: verified.preprocessed,
    provenance: provenanceOf(row.id, verified.data),
    adjustments: verified.adjustments,
    language: verified.language,
  };
}

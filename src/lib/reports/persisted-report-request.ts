import 'server-only';
import { NextResponse } from 'next/server';

import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { loadFinancialReportVersion, resolveReportWorkspaceId } from './financial-report-store';
import { parseReportRef, type ReportProvenance } from './report-ref';

export type PersistedReportResolution =
  | { kind: 'absent' }
  | { kind: 'error'; response: Response }
  | {
      kind: 'ok';
      report: FinancialReport;
      preprocessed: PreprocessedBalance | undefined;
      provenance: ReportProvenance;
    };

/**
 * Resuelve `body.reportRef` contra el almacenamiento, dentro del workspace de
 * la sesión. Frontera común de /export, /html y /api/escudo/fiscal-anchor:
 *
 *   - sin referencia → `absent` (camino histórico, procedencia no verificada);
 *   - referencia mal formada → 400 sin consultar;
 *   - no encontrada / de otro workspace → 404; huella distinta → 409;
 *     almacenamiento caído → 503.
 */
export async function resolvePersistedReport(body: unknown): Promise<PersistedReportResolution> {
  const raw = body && typeof body === 'object' ? (body as { reportRef?: unknown }).reportRef : undefined;
  const parsed = parseReportRef(raw);
  if (parsed.kind === 'absent') return { kind: 'absent' };
  if (parsed.kind === 'invalid') {
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'Invalid reportRef.', code: 'REPORT_REF_INVALID' },
        { status: 400 },
      ),
    };
  }
  const workspaceId = await resolveReportWorkspaceId();
  const loaded = await loadFinancialReportVersion(workspaceId, parsed.ref);
  if (!loaded.ok) {
    return {
      kind: 'error',
      response: NextResponse.json({ error: loaded.error, code: loaded.code }, { status: loaded.status }),
    };
  }
  return {
    kind: 'ok',
    report: loaded.report,
    preprocessed: loaded.preprocessed,
    provenance: loaded.provenance,
  };
}

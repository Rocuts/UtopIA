import type { FinancialReport } from '@/lib/agents/financial/types';
import { NiifReportSchema } from '@/lib/agents/financial/contracts/niif-report';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import { checkCashFlowInvariants, formatCashFlowViolations } from '@/lib/agents/financial/contracts/deterministic-breakdown';

/** Server-side output gate. Client flags never substitute for arithmetic checks.
 * This checks internal consistency, not provenance of a client-supplied report.
 */
export function financialExportBlockers(report: FinancialReport): string[] {
  const blockers: string[] = [];
  if (report.emittability?.kind === 'no-emitible' ||
      report.niifAnalysis?.reconciliation?.clean === false ||
      report.governance?.actaQualifications?.clean === false || report.validation?.ok === false) {
    blockers.push('El informe contiene salvedades o validaciones bloqueantes.');
  }
  const parsed = NiifReportSchema.safeParse(report.niifAnalysis?.json);
  if (!parsed.success) {
    blockers.push('Faltan cifras estructuradas válidas. Regenera el informe antes de exportar.');
    return blockers;
  }
  const validation = validateNiifReportJson(parsed.data);
  blockers.push(...validation.errors);
  // A printed balance without supporting detail must not be downloadable.
  blockers.push(...validation.warnings.filter(w => w.startsWith('E15.')));
  blockers.push(...formatCashFlowViolations(checkCashFlowInvariants(parsed.data.cashFlow)));
  return blockers;
}

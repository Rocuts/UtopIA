// ─── WS5 — Step: persist-run ──────────────────────────────────────────────────
// Upsert monthly_close_runs en cada etapa para audit trail completo.

import type { CloseMonthInput, HealthCheckResult } from '@/lib/accounting/closing/types';
import { upsertCloseRun, updateCloseRun } from '../repository';

export interface PersistRunInput {
  workspaceId: string;
  periodId: string;
  status: string;
  runId?: string;
  workflowRunId?: string;
  healthCheckResults?: HealthCheckResult;
  depreciationEntryId?: string | null;
  amortizationEntryId?: string | null;
  provisionEntryIds?: string[];
  closingEntryId?: string | null;
  previousPeriodHash?: string | null;
  periodHash?: string | null;
  pdfReportUrl?: string | null;
  notifiedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
}

/** Crea o actualiza la fila en monthly_close_runs. Retorna el UUID de la fila. */
export async function persistRunSnapshot(input: PersistRunInput): Promise<string> {
  'use step';

  if (input.runId) {
    // Actualizar fila existente
    const healthJson = input.healthCheckResults
      ? {
          unbalancedEntries: input.healthCheckResults.unbalancedEntries,
          bankReconciliationGaps: input.healthCheckResults.bankReconciliationGaps.map((g) => ({
            accountId: g.bankAccountId,
            difference: g.differenceCop,
          })),
          pendingDocs: input.healthCheckResults.pendingDocs,
          warnings: input.healthCheckResults.warnings,
          blocking: input.healthCheckResults.blocking,
        }
      : undefined;

    await updateCloseRun(input.runId, {
      status: input.status,
      ...(input.workflowRunId !== undefined && { workflowRunId: input.workflowRunId }),
      ...(healthJson !== undefined && { healthCheckResults: healthJson }),
      ...(input.depreciationEntryId !== undefined && { depreciationEntryId: input.depreciationEntryId }),
      ...(input.amortizationEntryId !== undefined && { amortizationEntryId: input.amortizationEntryId }),
      ...(input.provisionEntryIds !== undefined && { provisionEntryIds: input.provisionEntryIds }),
      ...(input.closingEntryId !== undefined && { closingEntryId: input.closingEntryId }),
      ...(input.previousPeriodHash !== undefined && { previousPeriodHash: input.previousPeriodHash }),
      ...(input.periodHash !== undefined && { periodHash: input.periodHash }),
      ...(input.pdfReportUrl !== undefined && { pdfReportUrl: input.pdfReportUrl }),
      ...(input.notifiedAt !== undefined && { notifiedAt: input.notifiedAt }),
      ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
      ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
    });
    return input.runId;
  }

  // Crear fila nueva
  const row = await upsertCloseRun({
    workspaceId: input.workspaceId,
    periodId: input.periodId,
    status: input.status,
    workflowRunId: input.workflowRunId ?? null,
    triggeredBy: input.triggeredBy ?? null,
  });
  return row.id;
}

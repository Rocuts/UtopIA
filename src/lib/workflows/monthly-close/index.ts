// ─── WS5 — Monthly Close Workflow ────────────────────────────────────────────
//
// Workflow durable con Vercel Workflow DevKit.
//
// Pasos:
//   1. Persist initial run row (step)
//   2. Health check (step)
//   3. Si blocking + !override → pausar con createHook esperando aprobación
//   4. Ajustes NIIF (step) — deprec / amort / provisiones vía WS4
//   5. Asiento de cierre zero-out (step)
//   6. Lock del período (step)
//   7. Period hash SHA-256 encadenado (step)
//   8. PDF élite (step)
//   9. Notificación (step) — vía WS6
//  10. Final snapshot (step) → CloseMonthResult
//
// Reglas del workflow sandbox:
//   - 'use workflow' → orquestación pura. Sin fetch/fs/crypto/setTimeout directos.
//   - 'use step' (en cada módulo step) → full Node.js access.
//   - start() se llama desde routes/CLI, NO desde aquí.

import { createHook, FatalError } from 'workflow';

import {
  closeApprovalHookToken,
  type CloseHookResumePayload,
  type CloseMonthInput,
  type CloseMonthResult,
} from '@/lib/accounting/closing/types';

import { persistRunSnapshot } from './steps/persist-run';
import { runHealthCheck } from './steps/health-check';
import { runAdjustments } from './steps/run-adjustments';
import { generateClosingEntry } from './steps/closing-entry';
import { lockPeriod } from './steps/lock-period';
import { computePeriodHash } from './steps/period-hash';
import { generatePdfReport } from './steps/generate-pdf';
import { sendLockNotification } from './steps/notify';

export async function closeMonthWorkflow(input: CloseMonthInput): Promise<CloseMonthResult> {
  'use workflow';

  const { workspaceId, periodId } = input;
  const override = input.override ?? false;

  // ─── 1. Persistir fila inicial ───────────────────────────────────────────
  const runId = await persistRunSnapshot({
    workspaceId,
    periodId,
    status: 'running',
    triggeredBy: input.triggeredBy,
  });

  // ─── 2. Health check ─────────────────────────────────────────────────────
  const health = await runHealthCheck({ ...input });

  // ─── 3. Pausa si hay bloqueo y no hay override ───────────────────────────
  let wasOverridden = override;

  if (health.blocking && !override) {
    await persistRunSnapshot({
      workspaceId,
      periodId,
      runId,
      status: 'awaiting_resolution',
      healthCheckResults: health,
    });

    using hook = createHook<CloseHookResumePayload>({
      token: closeApprovalHookToken(periodId),
    });

    const decision = await hook;

    if (!decision.approved) {
      await persistRunSnapshot({
        workspaceId,
        periodId,
        runId,
        status: 'cancelled',
        errorMessage: `Rechazado por ${decision.approvedBy}: ${decision.reason ?? 'sin razón'}`,
      });
      throw new FatalError('Cierre mensual cancelado por el revisor fiscal.');
    }

    // Aprobado con salvedades
    wasOverridden = true;
    await persistRunSnapshot({
      workspaceId,
      periodId,
      runId,
      status: 'running',
      healthCheckResults: health,
    });
  } else {
    await persistRunSnapshot({
      workspaceId,
      periodId,
      runId,
      status: 'running',
      healthCheckResults: health,
    });
  }

  // ─── 4. Ajustes NIIF ─────────────────────────────────────────────────────
  const adjustments = await runAdjustments({ ...input, override: wasOverridden, runId });

  await persistRunSnapshot({
    workspaceId,
    periodId,
    runId,
    status: 'adjustments_done',
    depreciationEntryId: adjustments.depreciationEntryId,
    amortizationEntryId: adjustments.amortizationEntryId,
    provisionEntryIds: adjustments.provisionEntryIds,
  });

  // ─── 5. Asiento de cierre ────────────────────────────────────────────────
  const closingResult = await generateClosingEntry({ ...input, override: wasOverridden, runId });

  await persistRunSnapshot({
    workspaceId,
    periodId,
    runId,
    status: 'closing_entry_done',
    closingEntryId: closingResult.closingEntryId !== 'no-op' ? closingResult.closingEntryId : null,
  });

  // ─── 6. Lock del período ─────────────────────────────────────────────────
  await lockPeriod({ ...input, override: wasOverridden, runId });

  await persistRunSnapshot({
    workspaceId,
    periodId,
    runId,
    status: 'locked',
  });

  // ─── 7. Period hash ──────────────────────────────────────────────────────
  const hashResult = await computePeriodHash({ ...input, runId, override: wasOverridden });

  await persistRunSnapshot({
    workspaceId,
    periodId,
    runId,
    status: 'hashed',
    periodHash: hashResult.periodHash,
  });

  // ─── 8. PDF élite ────────────────────────────────────────────────────────
  const pdfUrl = await generatePdfReport({
    ...input,
    override: wasOverridden,
    runId,
    hash: hashResult.periodHash,
  });

  await persistRunSnapshot({
    workspaceId,
    periodId,
    runId,
    status: 'pdf_done',
    pdfReportUrl: pdfUrl,
  });

  // ─── 9. Notificación ─────────────────────────────────────────────────────
  const notifyResult = await sendLockNotification({
    ...input,
    override: wasOverridden,
    runId,
    hash: hashResult.periodHash,
    withWarnings: wasOverridden,
    pdfUrl,
  });

  const notifiedAt = notifyResult.sent ? new Date() : null;

  // ─── 10. Snapshot final ──────────────────────────────────────────────────
  await persistRunSnapshot({
    workspaceId,
    periodId,
    runId,
    status: 'completed',
    notifiedAt,
    completedAt: new Date(),
  });

  return {
    workspaceId,
    periodId,
    runId,
    status: 'completed',
    healthCheck: health,
    depreciationEntryId: adjustments.depreciationEntryId,
    amortizationEntryId: adjustments.amortizationEntryId,
    provisionEntryIds: adjustments.provisionEntryIds,
    closingEntry: closingResult,
    periodHash: hashResult.periodHash,
    previousPeriodHash: null, // se lee del run row si se necesita
    pdfReportUrl: pdfUrl,
    excelReportUrl: null,
    notifiedAt,
  };
}

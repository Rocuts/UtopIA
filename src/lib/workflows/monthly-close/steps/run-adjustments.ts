// ─── WS5 — Step: run-adjustments ─────────────────────────────────────────────
// Llama a AdjustmentsPort (WS4) para obtener los previews y los postea con el
// MISMO servicio que las rutas /api/accounting/adjustments/* (posting.ts):
//
//   - Depreciación y amortización actualizan el activo/diferido en la misma
//     transacción que el asiento (auditoría contab-nomina-05: antes el cierre
//     nunca actualizaba accumulated/last_period y se depreciaba para siempre).
//   - Idempotente por período: un reintento del paso, o un POST previo al
//     API, no duplica asientos (createEntry idempotentBySource).
//   - Las fallas de posteo son ERRORES del paso (FatalError con detalle), no
//     console.warn: antes una provisión mal configurada se omitía en silencio.
//   - El período 13 (cierre anual) no recibe ajustes mensuales.
//
// Si WS4 no está activo (feature flag), retorna ids nulos.

import { FatalError } from 'workflow';

import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import type { AdjustmentsPort } from '@/lib/accounting/adjustments/types';
import { getPeriodById } from '../repository';

export interface AdjustmentsResult {
  depreciationEntryId: string | null;
  amortizationEntryId: string | null;
  provisionEntryIds: string[];
  /** Provisiones omitidas con su motivo (N/D explícito, no error). */
  provisionsSkipped: Array<{ provisionType: string; reason: string }>;
}

const EMPTY: AdjustmentsResult = {
  depreciationEntryId: null,
  amortizationEntryId: null,
  provisionEntryIds: [],
  provisionsSkipped: [],
};

export async function runAdjustments(
  input: CloseMonthInput & { runId: string },
): Promise<AdjustmentsResult> {
  'use step';

  const { workspaceId, periodId } = input;

  // Si el flag de ajustes no está activo, saltar silenciosamente
  const adjEnabled = process.env.UTOPIA_ENABLE_AUTO_ADJUSTMENTS === 'true';
  if (!adjEnabled) {
    console.warn('[monthly-close] UTOPIA_ENABLE_AUTO_ADJUSTMENTS no activo — ajustes omitidos.');
    return EMPTY;
  }

  const period = await getPeriodById(workspaceId, periodId);
  if (!period) throw new FatalError(`Período ${periodId} no encontrado`);
  if (period.month === 13) return EMPTY;

  // Cargar el servicio de ajustes dinámicamente
  let adjustmentsPort: AdjustmentsPort;
  let posting: typeof import('@/lib/accounting/adjustments/posting');
  try {
    const mod = await import('@/lib/accounting/adjustments');
    adjustmentsPort = mod.adjustmentsPort as AdjustmentsPort;
    if (!adjustmentsPort) throw new Error('adjustmentsPort no exportado');
    posting = await import('@/lib/accounting/adjustments/posting');
  } catch (err) {
    throw new FatalError(
      `No se pudo cargar el servicio de ajustes: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Fecha de cierre = último día del período
  const previewBase = { workspaceId, periodId, entryDate: period.endsAt };
  const postedBy = input.triggeredBy ?? null;
  const failures: string[] = [];

  let depreciationEntryId: string | null = null;
  try {
    const depPreview = await adjustmentsPort.previewDepreciation(previewBase);
    const r = await posting.postDepreciation(depPreview, periodId, postedBy);
    depreciationEntryId = r.entryId;
  } catch (err) {
    failures.push(`depreciación: ${err instanceof Error ? err.message : String(err)}`);
  }

  let amortizationEntryId: string | null = null;
  try {
    const amortPreview = await adjustmentsPort.previewAmortization(previewBase);
    const r = await posting.postAmortization(amortPreview, periodId, postedBy);
    amortizationEntryId = r.entryId;
  } catch (err) {
    failures.push(`amortización: ${err instanceof Error ? err.message : String(err)}`);
  }

  const provisionEntryIds: string[] = [];
  let provisionsSkipped: AdjustmentsResult['provisionsSkipped'] = [];
  try {
    const provPreview = await adjustmentsPort.previewProvisions(previewBase);
    provisionsSkipped = provPreview.skipped;
    const r = await posting.postProvisions(provPreview, postedBy);
    provisionEntryIds.push(...r.postedEntryIds);
    for (const e of r.errors) failures.push(`provisión ${e.provisionType}: ${e.message}`);
  } catch (err) {
    failures.push(`provisiones: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (failures.length > 0) {
    // Lo posteado queda (es idempotente); corregida la causa, el reintento
    // sólo crea lo que falta.
    throw new FatalError(`Ajustes de cierre con errores: ${failures.join(' | ')}`);
  }

  return { depreciationEntryId, amortizationEntryId, provisionEntryIds, provisionsSkipped };
}

// ─── WS5 — Step: run-adjustments ─────────────────────────────────────────────
// Llama a AdjustmentsPort (WS4) para obtener los previews y postea los asientos
// via createEntry del double-entry service.
//
// Si WS4 no está activo (feature flag), retorna ids nulos gracefully.

import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import type { AdjustmentsPort } from '@/lib/accounting/adjustments/types';
import { createEntry } from '@/lib/accounting/double-entry/service';
import { getPeriodById } from '../repository';

export interface AdjustmentsResult {
  depreciationEntryId: string | null;
  amortizationEntryId: string | null;
  provisionEntryIds: string[];
}

export async function runAdjustments(
  input: CloseMonthInput & { runId: string },
): Promise<AdjustmentsResult> {
  'use step';

  const { workspaceId, periodId } = input;

  // Si el flag de ajustes no está activo, saltar silenciosamente
  const adjEnabled = process.env.UTOPIA_ENABLE_AUTO_ADJUSTMENTS === 'true';
  if (!adjEnabled) {
    console.warn('[monthly-close] UTOPIA_ENABLE_AUTO_ADJUSTMENTS no activo — ajustes omitidos.');
    return { depreciationEntryId: null, amortizationEntryId: null, provisionEntryIds: [] };
  }

  // Cargar el servicio de ajustes dinámicamente
  let adjustmentsPort: AdjustmentsPort;
  try {
    const mod = await import('@/lib/accounting/adjustments');
    adjustmentsPort = mod.adjustmentsPort as AdjustmentsPort;
    if (!adjustmentsPort) throw new Error('adjustmentsPort no exportado');
  } catch (err) {
    console.warn('[monthly-close] No se pudo cargar AdjustmentsPort:', err);
    return { depreciationEntryId: null, amortizationEntryId: null, provisionEntryIds: [] };
  }

  // Fecha de cierre = último día del período
  const period = await getPeriodById(workspaceId, periodId);
  if (!period) throw new Error(`Período ${periodId} no encontrado`);
  const entryDate = period.endsAt;

  const previewBase = { workspaceId, periodId, entryDate };

  // Depreciation
  let depreciationEntryId: string | null = null;
  try {
    const depPreview = await adjustmentsPort.previewDepreciation(previewBase);
    if (depPreview.proposedEntry) {
      const created = await createEntry({
        ...depPreview.proposedEntry,
        status: 'posted',
        sourceType: 'depreciation',
        sourceRef: `period:${periodId}:depreciation`,
      });
      depreciationEntryId = created.entry.id;
    }
  } catch (err) {
    console.warn('[monthly-close] Depreciation omitida:', err);
  }

  // Amortization
  let amortizationEntryId: string | null = null;
  try {
    const amortPreview = await adjustmentsPort.previewAmortization(previewBase);
    if (amortPreview.proposedEntry) {
      const created = await createEntry({
        ...amortPreview.proposedEntry,
        status: 'posted',
        sourceType: 'adjustment',
        sourceRef: `period:${periodId}:amortization`,
      });
      amortizationEntryId = created.entry.id;
    }
  } catch (err) {
    console.warn('[monthly-close] Amortización omitida:', err);
  }

  // Provisions
  const provisionEntryIds: string[] = [];
  try {
    const provPreview = await adjustmentsPort.previewProvisions(previewBase);
    for (const entry of provPreview.proposedEntries) {
      const created = await createEntry({
        ...entry,
        status: 'posted',
        sourceType: 'adjustment',
        sourceRef: `period:${periodId}:provisions`,
      });
      provisionEntryIds.push(created.entry.id);
    }
  } catch (err) {
    console.warn('[monthly-close] Provisiones omitidas:', err);
  }

  return { depreciationEntryId, amortizationEntryId, provisionEntryIds };
}

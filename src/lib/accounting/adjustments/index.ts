// ─── WS4 — NIIF Auto-Adjustments: implementación de AdjustmentsPort ──────────
//
// Este archivo es el barrel público de WS4. Exporta `adjustmentsPort`,
// que es la implementación de `AdjustmentsPort` definido en `./types`.
//
// WS5 (Monthly Close Workflow) importa este barrel:
//   import { adjustmentsPort } from '@/lib/accounting/adjustments'

import 'server-only';

import type { AdjustmentPreviewBase, AdjustmentsPort } from './types';
import { getPeriod } from './repository';
import { listActiveFixedAssets } from './depreciation/repository';
import { calculateDepreciation } from './depreciation/calculator';
import { listActiveDeferredAssets } from './amortization/repository';
import { calculateAmortization } from './amortization/calculator';
import {
  listActiveProvisionsConfig,
  getPeriodAccountBalances,
} from './provisions/repository';
import { calculateProvisions } from './provisions/calculator';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const adjustmentsPortImpl: AdjustmentsPort = {
  async previewDepreciation(input: AdjustmentPreviewBase) {
    const period = await getPeriod(input.workspaceId, input.periodId);
    const assets = await listActiveFixedAssets(input.workspaceId);
    return calculateDepreciation({
      workspaceId: input.workspaceId,
      period,
      entryDate: input.entryDate,
      assets,
    });
  },

  async previewAmortization(input: AdjustmentPreviewBase) {
    const period = await getPeriod(input.workspaceId, input.periodId);
    const assets = await listActiveDeferredAssets(input.workspaceId);
    return calculateAmortization({
      workspaceId: input.workspaceId,
      period,
      entryDate: input.entryDate,
      deferredAssets: assets,
    });
  },

  async previewProvisions(input: AdjustmentPreviewBase) {
    const period = await getPeriod(input.workspaceId, input.periodId);
    const [configs, periodBalances] = await Promise.all([
      listActiveProvisionsConfig(input.workspaceId),
      getPeriodAccountBalances(input.workspaceId, input.periodId),
    ]);
    return calculateProvisions({
      workspaceId: input.workspaceId,
      period,
      entryDate: input.entryDate,
      configs,
      periodBalances,
    });
  },
};

export const adjustmentsPort: AdjustmentsPort = adjustmentsPortImpl;

// Re-exports for convenience (WS5 may import individual previews).
export type {
  AdjustmentsPort,
  AdjustmentPreviewBase,
  DepreciationPreview,
  AmortizationPreview,
  ProvisionsPreview,
  DepreciationLine,
  AmortizationLine,
  ProvisionLine,
  ProvisionType,
  AdjustmentsError,
} from './types';
export { ADJ_ERR, isAutoAdjustmentsEnabled } from './types';

// Sub-module exports (for endpoints that need direct access)
export { updateAfterDepreciation } from './depreciation/repository';
export { listActiveFixedAssets } from './depreciation/repository';
export { updateAfterAmortization } from './amortization/repository';
export { listActiveDeferredAssets } from './amortization/repository';
export { listActiveProvisionsConfig, getPeriodAccountBalances } from './provisions/repository';
export { getPeriod, getAccountByCode, upsertAccountByCode } from './repository';
export { computePretaxIncome, computeIncomeTaxProvision, INCOME_TAX_RATE_2026 } from './provisions/income-tax';

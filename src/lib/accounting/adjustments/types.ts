// ─── WS4 — NIIF Auto-Adjustments: contratos públicos (Ola 1+1 Élite) ────────
//
// El consumidor principal es WS5 (cierre mensual): cada step del workflow
// llama a `previewDepreciation`, `previewAmortization`, `previewProvisions`
// para obtener `CreateEntryInput[]` y luego decide postearlos. Owner: WS4.

import type {
  DeferredAssetRow,
  FixedAssetRow,
  ProvisionsConfigRow,
} from '@/lib/db/schema';
import type { CreateEntryInput } from '@/lib/accounting/types';

export type { DeferredAssetRow, FixedAssetRow, ProvisionsConfigRow };

// ---------------------------------------------------------------------------
// Common preview shape
// ---------------------------------------------------------------------------

export interface AdjustmentPreviewBase {
  workspaceId: string;
  periodId: string;
  /** Fecha del asiento — típicamente el último día del período. */
  entryDate: Date;
}

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

export interface DepreciationLine {
  fixedAssetId: string;
  fixedAssetCode: string;
  monthlyAmountCop: string;
  /** Acumulado tras este período. */
  newAccumulatedCop: string;
  bookValueAfterCop: string;
  method: 'straight_line' | 'units_of_production' | 'accelerated';
}

export interface DepreciationPreview {
  lines: DepreciationLine[];
  totalAmountCop: string;
  /** CreateEntryInput listo para `createEntry()` del double-entry service. */
  proposedEntry: CreateEntryInput | null;
  /** Número de activos saltados con razón (ej. `fully_depreciated`, `disposed`). */
  skipped: Array<{ fixedAssetId: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Amortization
// ---------------------------------------------------------------------------

export interface AmortizationLine {
  deferredAssetId: string;
  description: string;
  monthlyAmountCop: string;
  newAmortizedCop: string;
  remainingCop: string;
  /** Si el período es parcial (inicio o fin del diferido), marca el % aplicado. */
  proratedFraction: number;
}

export interface AmortizationPreview {
  lines: AmortizationLine[];
  totalAmountCop: string;
  proposedEntry: CreateEntryInput | null;
  skipped: Array<{ deferredAssetId: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Provisions
// ---------------------------------------------------------------------------

export type ProvisionType =
  | 'prima'
  | 'cesantias'
  | 'intereses_cesantias'
  | 'vacaciones'
  | 'salud'
  | 'pension'
  | 'arl'
  | 'parafiscales'
  | 'income_tax';

export interface ProvisionLine {
  provisionType: ProvisionType;
  rate: string;
  baseAmountCop: string;
  provisionAmountCop: string;
  expenseAccountCode: string;
  liabilityAccountCode: string;
}

export interface ProvisionsPreview {
  lines: ProvisionLine[];
  totalAmountCop: string;
  /** Una entry por provisionType (más limpio que un mega-asiento). */
  proposedEntries: CreateEntryInput[];
  skipped: Array<{ provisionType: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Public API surface (a implementar por WS4)
// ---------------------------------------------------------------------------

export interface AdjustmentsPort {
  previewDepreciation(input: AdjustmentPreviewBase): Promise<DepreciationPreview>;
  previewAmortization(input: AdjustmentPreviewBase): Promise<AmortizationPreview>;
  previewProvisions(input: AdjustmentPreviewBase): Promise<ProvisionsPreview>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AdjustmentsError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AdjustmentsError';
    this.code = code;
    this.details = details;
  }
}

export const ADJ_ERR = {
  PERIOD_NOT_FOUND: 'ADJ_PERIOD_NOT_FOUND',
  PERIOD_NOT_OPEN: 'ADJ_PERIOD_NOT_OPEN',
  ALREADY_APPLIED: 'ADJ_ALREADY_APPLIED',
  CONFIG_MISSING: 'ADJ_CONFIG_MISSING',
  INVALID_INPUT: 'ADJ_INVALID_INPUT',
  ENGINE_DISABLED: 'ADJ_ENGINE_DISABLED',
} as const;

// ---------------------------------------------------------------------------
// Feature flag helper
// ---------------------------------------------------------------------------

export function isAutoAdjustmentsEnabled(): boolean {
  return process.env.UTOPIA_ENABLE_AUTO_ADJUSTMENTS === 'true';
}

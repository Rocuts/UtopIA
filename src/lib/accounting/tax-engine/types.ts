// ─── WS1 — Tax Engine: contratos públicos (Ola 1+1 Élite) ───────────────────
//
// Estos tipos definen el contrato del motor de impuestos que consumen WS2
// (OCR → Journal Bridge, cuando promueve facturas) y, en general, cualquier
// flujo que cree journal_entries con tax lines automáticas.
//
// La implementación vive en `./rules-engine.ts`, `./line-generator.ts`,
// `./integrity-validator.ts`. Owner: WS1.

import type {
  TaxRegimeKind,
  TaxRuleRow,
  TaxType,
  ThirdPartyTaxProfileRow,
} from '@/lib/db/schema';
import type { JournalLineInput } from '@/lib/accounting/types';

// Re-export para que consumidores no tengan que ir hasta @/lib/db/schema.
export type { TaxRegimeKind, TaxRuleRow, TaxType, ThirdPartyTaxProfileRow };

// ---------------------------------------------------------------------------
// Input al motor — describe la transacción a evaluar
// ---------------------------------------------------------------------------

export type TaxTransactionType =
  | 'purchase'
  | 'sale'
  | 'service_purchase'
  | 'service_sale';

export interface TaxEvaluationInput {
  workspaceId: string;
  transactionType: TaxTransactionType;
  /** Subtotal (base gravable) en COP, NUMERIC string para precisión. */
  subtotalCop: string;
  /** Año del UVT a aplicar (default: año de `transactionDate`). */
  uvtYear?: number;
  /** ISO date — define qué reglas con valid_from/valid_until aplican. */
  transactionDate?: Date;
  /** UUID en `third_parties` (counterpart de la transacción). */
  thirdPartyId?: string;
  /** Cuenta contable (gasto / ingreso / activo) ya determinada por el caller. */
  baseAccountCode?: string;
  /** Cuando el subtotal ya incluye el impuesto, indicarlo para back-calcular base. */
  amountIncludesTax?: boolean;
  /** Para overrides forzados (ej. usuario marcó "no aplicar IVA"). */
  excludeTaxTypes?: TaxType[];
  /** Para tracing en `tax_engine_audits`. */
  contextRef?: string;
}

// ---------------------------------------------------------------------------
// Output del motor — propuesta de líneas tributarias
// ---------------------------------------------------------------------------

export interface TaxLineProposal {
  ruleId: string;
  ruleCode: string;
  taxType: TaxType;
  baseAmountCop: string;
  taxAmountCop: string;
  rate: string;
  /** 'debit' = la línea suma al débito; 'credit' = al crédito. */
  side: 'debit' | 'credit';
  accountCode: string;
  description: string;
  /** Si el tax engine bajó la confianza (ej. tercero sin perfil tributario). */
  confidence: number;
  warnings: string[];
}

export interface TaxEvaluationResult {
  /** Líneas propuestas listas para combinarse con la línea base en createEntry. */
  proposedLines: TaxLineProposal[];
  /** Líneas exactas que un caller puede pasar a `JournalLineInput[]`. */
  journalLines: JournalLineInput[];
  /** Total a pagar al proveedor / a cobrar al cliente (CxP / CxC). */
  totalPayableCop: string;
  /** Conjunto de IDs de reglas matched (para audit). */
  matchedRuleIds: string[];
  /** Resumen humano legible para UI. */
  summary: string;
  /** Warnings agregadas (ej. "tercero sin perfil tributario, asumimos régimen común"). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validador de integridad — `tax_amount == base * rate`
// ---------------------------------------------------------------------------

export interface IntegrityViolation {
  ruleCode: string;
  expectedAmountCop: string;
  actualAmountCop: string;
  differenceCop: string;
  toleranceCop: string;
  severity: 'warning' | 'error';
}

export interface IntegrityValidationResult {
  ok: boolean;
  violations: IntegrityViolation[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TaxEngineError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'TaxEngineError';
    this.code = code;
    this.details = details;
  }
}

export const TAX_ERR = {
  RULE_NOT_FOUND: 'TAX_RULE_NOT_FOUND',
  ACCOUNT_NOT_FOUND: 'TAX_ACCOUNT_NOT_FOUND',
  INTEGRITY_VIOLATION: 'TAX_INTEGRITY_VIOLATION',
  ENGINE_DISABLED: 'TAX_ENGINE_DISABLED',
  INVALID_INPUT: 'TAX_INVALID_INPUT',
  UNKNOWN_THIRD_PARTY: 'TAX_UNKNOWN_THIRD_PARTY',
} as const;

// ---------------------------------------------------------------------------
// Public API surface (a implementar por WS1)
// ---------------------------------------------------------------------------

export interface TaxEnginePort {
  /** Evalúa una transacción y propone líneas. NO escribe a DB. */
  evaluate(input: TaxEvaluationInput): Promise<TaxEvaluationResult>;
  /** Valida integridad de líneas existentes contra las reglas. */
  validateLines(input: {
    workspaceId: string;
    lines: JournalLineInput[];
    transactionType: TaxTransactionType;
  }): Promise<IntegrityValidationResult>;
}

// ---------------------------------------------------------------------------
// Feature flag helper
// ---------------------------------------------------------------------------

export function isTaxEngineEnabled(): boolean {
  return process.env.UTOPIA_ENABLE_TAX_ENGINE === 'true';
}

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

// ---------------------------------------------------------------------------
// Triggers de una regla — contrato ampliado (JSONB `applicable_triggers`)
// ---------------------------------------------------------------------------
//
// El `$type<>` declarado en `@/lib/db/schema-tax` es un SUBCONJUNTO de este
// contrato: la columna es JSONB, así que las claves nuevas viajan sin cambio de
// esquema SQL. `readTriggers()` es el único punto donde se ensancha el tipo,
// para que el resto del motor trabaje contra `TaxRuleTriggers` y no contra el
// literal de Drizzle. PENDIENTE (fuera de esta frontera): reflejar estas claves
// en el `$type<>` de `taxRules.applicableTriggers` en schema-tax.ts.

export interface TaxRuleTriggers {
  transactionTypes?: TaxTransactionType[];
  /** Regímenes del proveedor que ACTIVAN la regla (lista inclusiva). */
  supplierRegimes?: string[];
  /** Regímenes del cliente que ACTIVAN la regla (lista inclusiva). */
  customerRegimes?: string[];
  /**
   * Regímenes del proveedor que IMPIDEN la regla aunque el resto de filtros
   * pase. Sin este campo la exclusión no era expresable y el motor practicaba
   * retención a sujetos expresamente no sometidos:
   *   - autorretenedor del respectivo concepto: la obligación se traslada al
   *     beneficiario (Art. 369 E.T.; Art. 368 par. 1 E.T.; DUR 1625/2016
   *     Arts. 1.2.6.1 y 1.2.6.2);
   *   - contribuyentes del SIMPLE: "no estarán sujetos a retención en la
   *     fuente", salvo pagos laborales (Art. 911 E.T.);
   *   - entidades no contribuyentes de los Arts. 22 y 23 E.T. (Art. 369 num. 1).
   * La exclusión gana sobre `supplierRegimes`.
   */
  excludeSupplierRegimes?: string[];
  /**
   * Regímenes del proveedor que NO excluyen por sí solos pero exigen
   * verificación manual antes de contabilizar (p. ej. gran contribuyente: sólo
   * queda fuera de retención si además está autorizado como autorretenedor del
   * concepto — responsabilidad 15 del RUT). La regla se conserva pero baja su
   * confianza y arrastra `verifyMessage`.
   */
  verifySupplierRegimes?: string[];
  /** Mensaje de la verificación anterior. Si falta, el motor usa uno genérico. */
  verifyMessage?: string;
  economicActivities?: string[];
  cityCode?: string;
  minBaseUvt?: number;
  minBaseAmount?: number;
  /**
   * Grupo de EXCLUSIÓN MUTUA. Dos reglas del mismo `taxType` y mismo
   * `exclusionGroup` no pueden contabilizarse a la vez: una operación se grava
   * con UNA sola tarifa de IVA (Arts. 468, 468-1, 468-3, 477, 424/476 E.T.) y
   * un pago se somete a UN solo concepto de retención en la fuente.
   * Reglas sin grupo no compiten con nadie.
   */
  exclusionGroup?: string;
  /** Desempate dentro del grupo: gana la especificidad MAYOR. Default 0. */
  specificity?: number;
  /**
   * Etiquetas de tratamiento que el caller debe declarar en
   * `TaxEvaluationInput.taxTreatments` para que la regla entre. TODAS deben
   * estar presentes (AND). Modela lo que el motor NO puede inferir del
   * `transactionType`: si el bien está en la lista taxativa del Art. 468-1,
   * si el servicio está en la del Art. 468-3, si la operación es exenta
   * (Art. 477) o excluida (Arts. 424/476), si el pago es honorario o servicio
   * general, si el beneficiario es o no declarante.
   */
  requiresTreatments?: string[];
  /**
   * Advertencia normativa que el motor adjunta SIEMPRE que la regla aplique
   * (p. ej. el acumulado de 3.300 UVT del Art. 1.2.4.3.1 DUR, que el motor no
   * lleva por tercero).
   */
  advisory?: string;
}

/**
 * Etiquetas de tratamiento built-in que reconocen las reglas sembradas.
 * Son datos, no lógica: el motor sólo compara strings.
 */
export const TAX_TREATMENT = {
  /** Bien de la lista taxativa del Art. 468-1 E.T. (5%). */
  IVA_5_BIENES: 'iva_5_bienes',
  /** Servicio de la lista taxativa del Art. 468-3 E.T. (5%). */
  IVA_5_SERVICIOS: 'iva_5_servicios',
  /** Operación exenta — Art. 477 E.T. (tarifa 0% CON derecho a descontables). */
  IVA_EXENTO: 'iva_exento',
  /** Operación excluida — Arts. 424 (bienes) / 476 (servicios) E.T. */
  IVA_EXCLUIDO: 'iva_excluido',
  /** El pago se califica como honorario o comisión (Art. 392 inc. 2 E.T.). */
  HONORARIOS: 'honorarios',
  /** El beneficiario NO está obligado a declarar renta. */
  BENEFICIARIO_NO_DECLARANTE: 'beneficiario_no_declarante',
} as const;

export type TaxTreatmentTag =
  (typeof TAX_TREATMENT)[keyof typeof TAX_TREATMENT];

/**
 * Ensancha el JSONB de Drizzle al contrato completo de triggers.
 * Único punto de cast del motor.
 */
export function readTriggers(rule: {
  applicableTriggers?: unknown;
}): TaxRuleTriggers {
  return (rule.applicableTriggers ?? {}) as TaxRuleTriggers;
}

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
  /**
   * Calificaciones que el caller declara sobre la operación y que el motor no
   * puede inferir (ver `TaxRuleTriggers.requiresTreatments` y `TAX_TREATMENT`).
   * Sin declararlas, sólo entran las reglas residuales: IVA 19% (Art. 468 E.T.)
   * y ReteFuente de servicios generales 4% (Art. 392 E.T.).
   */
  taxTreatments?: string[];
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

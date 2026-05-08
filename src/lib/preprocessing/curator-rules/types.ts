// ---------------------------------------------------------------------------
// Curator NIIF Middleware — tipos
// ---------------------------------------------------------------------------
// Capa de validación determinística que extiende el preprocessing del balance
// de prueba con 4 reglas (R1–R4). Se ejecuta al final de
// `buildSnapshotForPeriod`, sin LLM, antes de que ningún agente del pipeline
// financiero lea los datos.
//
// `CuratorFinding` es shape-compatible con `AuditFinding` para que el audit
// pipeline pueda mergearlos opcionalmente sin coerción.
// ---------------------------------------------------------------------------

export type CuratorSeverity =
  | 'critico'
  | 'alto'
  | 'medio'
  | 'bajo'
  | 'informativo';

export type CuratorRuleCode =
  | 'CUR-R1'
  | 'CUR-R2'
  | 'CUR-R3'
  | 'CUR-R4'
  | 'CUR-R5'
  | 'CUR-R6'
  | 'CUR-R7';

export interface CuratorFinding {
  code: CuratorRuleCode;
  severity: CuratorSeverity;
  title: string;
  description: string;
  /** Referencia normativa (NIC, NIIF, Art. ET, Decreto). */
  normReference: string;
  recommendation: string;
  impact: string;
  /** Periodo al que aplica el finding. */
  period?: string;
}

// ---------------------------------------------------------------------------
// R1 — Reclasificación de saldos negativos en activos
// ---------------------------------------------------------------------------

export interface Reclassification {
  /** Cuenta PUC original (de Clase 1) con saldo negativo. */
  accountCode: string;
  accountName: string;
  /** Saldo crudo (negativo) antes del ajuste sugerido. */
  originalBalanceCop: number;
  /** Cuenta de pasivo virtual a la que se reclasifica el monto absoluto. */
  reclassifiedToCode: string;
  reclassifiedToName: string;
  /** Magnitud absoluta del saldo reclasificado. */
  amountCop: number;
  /** Justificación NIIF (NIC 1 párr. 32 — no compensación). */
  justification: string;
  // -------------------------------------------------------------------------
  // Pulido Diamante — campos del contrato R1 con mutación efectiva del snapshot.
  // Opcionales por retrocompatibilidad: el productor histórico de R1
  // (r1-negative-assets.ts) los omite mientras la lógica B1 no los popule. El
  // contrato post-Pulido-Diamante exige los tres presentes en cada Reclassification
  // que llegue al renderer del Balance.
  // -------------------------------------------------------------------------
  /**
   * Indica si la regla R1 aplicó la mutación efectiva al snapshot
   * (mover el monto absoluto del Activo al Pasivo). `false` significa que se
   * detectó la incoherencia pero no se mutó (modo solo-finding).
   */
  applied?: boolean;
  /** Magnitud monetaria absoluta efectivamente movida del Activo al Pasivo. */
  effectiveTransferCop?: number;
  /** Nota literal a renderizar en el Balance debajo del rubro afectado. */
  balanceFootnoteText?: string;
}

// ---------------------------------------------------------------------------
// R2 — Estado de Flujos de Efectivo (método indirecto, NIC 7)
// ---------------------------------------------------------------------------

export interface CashFlowOperatingSection {
  utilidadNeta: number;
  /** + Depreciación / Amortización (Δ saldos PUC 1592, 1595, 1598). */
  depreciacionAmortizacion: number;
  /** ± Variación Cuentas por Cobrar (Δ Clase 13). Activos ↑ → flujo ↓. */
  varCuentasPorCobrar: number;
  /** ± Variación Inventarios (Δ Clase 14). */
  varInventarios: number;
  /** ± Variación Proveedores (Δ Clase 22). */
  varProveedores: number;
  /** ± Variación Cuentas por Pagar comerciales (Δ Clase 23). */
  varCuentasPorPagar: number;
  /** ± Variación Impuestos por Pagar (Δ Clase 24). */
  varImpuestosPorPagar: number;
  /** ± Variación Obligaciones Laborales (Δ Clase 25). */
  varObligacionesLaborales: number;
  /** Total flujo de actividades operativas. */
  total: number;
}

export interface CashFlowInvestingSection {
  /** Δ Propiedad Planta y Equipo bruto (Clase 15 sin depreciación). */
  varPPE: number;
  /** ± Otros movimientos de inversión. */
  otros: number;
  total: number;
}

export interface CashFlowFinancingSection {
  /** Δ Obligaciones financieras (Clase 21). */
  varObligacionesFinancieras: number;
  /** Δ Capital + reservas (Clases 31, 32, 33 excluyendo utilidad del ejercicio). */
  varCapitalReservas: number;
  /** Dividendos / distribuciones aproximadas (Δ Utilidades acumuladas — Utilidad neta T). */
  dividendosEstimados: number;
  total: number;
}

export interface CashFlowStatement {
  period: string;
  comparativePeriod: string;
  operating: CashFlowOperatingSection;
  investing: CashFlowInvestingSection;
  financing: CashFlowFinancingSection;
  /** Variación neta de efectivo (operating + investing + financing). */
  netChangeInCash: number;
  /** Δ saldo PUC 11 entre T-1 y T (control de reconciliación). */
  observedChangeInCash: number;
  /** netChangeInCash − observedChangeInCash. Tolerancia esperada. */
  reconciliationGap: number;
  /** Si true, la reconciliación cuadra dentro de tolerancia razonable. */
  reconciled: boolean;
  /** Marcador para los agentes: "este flujo fue inferido, no operativo". */
  inferred: true;
}

// ---------------------------------------------------------------------------
// R3 — Atribución de brecha de cuadratura
// ---------------------------------------------------------------------------

export interface BalanceGapAttribution {
  /** Magnitud (con signo) del descuadre Activo − (Pasivo + Patrimonio). */
  amountCop: number;
  /** Cuenta leaf con mayor variación atípica T vs T-1. */
  accountCode: string;
  accountName: string;
  /** PUC clase a la que pertenece la cuenta. */
  classCode: number;
  /** z-score sobre la distribución de Δ% de la misma clase. */
  zScore: number;
  /** Δ% de la cuenta vs media de su clase. */
  varianceVsT1Pct: number;
  /** Saldo en T-1 y en T para auditar manualmente. */
  balanceTMinus1: number;
  balanceT: number;
  /** Acción sugerida (mensaje accionable para el usuario). */
  suggestedAction: string;
}

// ---------------------------------------------------------------------------
// R4 — Validación renta teórica (Art. 240 E.T., 35%)
// ---------------------------------------------------------------------------

/** Tasa nominal de renta colombiana 2026 (Art. 240 E.T.). */
export const RENTA_NOMINAL_RATE = 0.35;
/** Threshold a partir del cual disparamos el riesgo. */
export const RENTA_PROVISION_FLOOR = 0.30;

export interface TaxProvisionRisk {
  utilidadNeta: number;
  /** Provisión observada en cuenta 24xx. */
  actualProvisionCop: number;
  /** utilidadNeta × 35%. */
  expectedProvisionCop: number;
  /** expected − actual (positivo = falta provisión). */
  gapCop: number;
  /** Impacto en caja al pagar renta del ejercicio (≈ gap). */
  cashImpactCop: number;
  /** actualProvision / expectedProvision. */
  ratio: number;
  severidad: 'critico';
}

// ---------------------------------------------------------------------------
// Resultado consolidado
// ---------------------------------------------------------------------------

export interface CuratorResult {
  period: string;
  comparativePeriod: string | null;
  /** R1: cuentas de activo con saldo negativo reclasificadas. */
  reclassifications: Reclassification[];
  /** R2: flujo de efectivo método indirecto (si hay comparativo). */
  cashFlowIndirecto?: CashFlowStatement;
  /** R3: atribución de brecha de cuadratura (si hay descuadre). */
  balanceGapAttribution?: BalanceGapAttribution;
  /** R4: riesgo fiscal (si la provisión < 30% de utilidad). */
  taxProvisionRisk?: TaxProvisionRisk;
  /** R5: ajuste de anclaje patrimonial (Balance ↔ ECP). */
  convergenceAdjustment?: ConvergenceAdjustment;
  /** R6: cierre del flujo de efectivo (EFE ↔ caja PUC 11). */
  cashFlowClosureAdjustment?: CashFlowClosureAdjustment;
  /** R7: advertencia de costo presunto (no muta cifras). */
  presumedCostWarning?: PresumedCostWarning;
  /** Findings agregados de las reglas. */
  findings: CuratorFinding[];
  /** Errores capturados por regla (regla → mensaje). Para diagnóstico. */
  errors: Record<string, string>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// R5 — Anclaje patrimonial (Balance ↔ ECP)
// ---------------------------------------------------------------------------
export interface ConvergenceAdjustment {
  /** Diferencia detectada (Saldo Final ECP − Total Patrimonio Balance). */
  gapCop: number;
  /** Total Patrimonio que reportaba el Balance crudo. */
  balanceEquity: number;
  /** Saldo Final del Estado de Cambios en el Patrimonio antes del ajuste. */
  ecpClosingBalance: number;
  /** Total Patrimonio FINAL post-ajuste — autoritativo para Balance Y ECP. */
  reconciledEquity: number;
  /** Cuenta virtual donde se imputa la línea automática. */
  virtualAccountCode: string;
  virtualAccountName: string;
  /** Texto literal de la línea que el Analyst debe insertar en el ECP. */
  ledgerLineLabel: string;
  justification: string;
}

// ---------------------------------------------------------------------------
// R6 — Cierre de flujo de efectivo (EFE ↔ caja PUC 11)
// ---------------------------------------------------------------------------
export interface CashFlowClosureAdjustment {
  efeNetChangeBefore: number;
  observedChangeInCash: number;
  /** Brecha = efeNetChangeBefore − observedChangeInCash. */
  gapCop: number;
  /** Línea del EFE donde se absorbe el ajuste. */
  adjustmentLineLabel: string;
  /** Saldo final caja a reportar — DEBE coincidir al centavo con PUC 11 cierre. */
  reconciledClosingCash: number;
  /** Saldo inicial caja del periodo. */
  openingCash: number;
  justification: string;
}

// ---------------------------------------------------------------------------
// R7 — Costo presunto (advertencia de valoración, NO muta cifras)
// ---------------------------------------------------------------------------
export interface PresumedCostWarning {
  observedGrossMargin: number;
  thresholdGrossMargin: number;
  reportedCogsCop: number;
  inventoryCop: number;
  presumedCogsCop: number;
  severidad: 'alto';
  calloutTitle: string;
  calloutBody: string;
}

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
  | 'CUR-R7'
  | 'CUR-R8'
  | 'CUR-R9'
  | 'CUR-R10'
  | 'CUR-R11'
  | 'CUR-R12'
  | 'CUR-R13'
  | 'CUR-R14'
  | 'CUR-R15'
  | 'CUR-R16'
  // Wave 2.F4 — Parte 5 spec v2.0 anomalías catalogadas como reglas curator.
  | 'CUR-R17'
  | 'CUR-R18'
  | 'CUR-R19'
  // Sub-códigos de R1 — trazan lo que la regla decidió NO reclasificar. Sin
  // ellos, "no hubo reclasificación" es indistinguible de "no había nada".
  // Ver ./contra-asset-registry.ts para el fundamento normativo.
  /** Correctora de activo preservada (NIC 1 párr. 33). */
  | 'CUR-R1-CA'
  /** Correctora con saldo débito — anomalía inversa. */
  | 'CUR-R1-B'
  /** Cuenta 1596 de naturaleza mixta sin desglosar. */
  | 'CUR-R1-MX'
  /** Presunta correctora fuera del catálogo PUC, detectada por denominación. */
  | 'CUR-R1-CP';

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
  /**
   * + Depreciación, amortización y deterioros no monetarios: aumento de las
   * correctoras de los grupos 15-18 (1592, 1597, 1598, 1599, 1698, 1699,
   * 1798, 1899 … ver `contra-asset-registry.ts`).
   */
  depreciacionAmortizacion: number;
  /** ± Variación Cuentas por Cobrar (Δ Clase 13). Activos ↑ → flujo ↓. */
  varCuentasPorCobrar: number;
  /** ± Variación Inventarios (Δ Clase 14). */
  varInventarios: number;
  /** ± Variación Proveedores (Δ Clase 22). */
  varProveedores: number;
  /** ± Variación Cuentas por Pagar (Δ Clase 23, sin 2360 dividendos por pagar). */
  varCuentasPorPagar: number;
  /** ± Variación Impuestos por Pagar (Δ Clase 24). */
  varImpuestosPorPagar: number;
  /** ± Variación Obligaciones Laborales (Δ Clase 25). */
  varObligacionesLaborales: number;
  /**
   * ± Variación de otros pasivos operativos: 26 pasivos estimados y
   * provisiones, 27 diferidos, 28 otros pasivos (anticipos recibidos …).
   * Opcional por compatibilidad con literales previos; R2 siempre lo emite.
   */
  varOtrosPasivosOperativos?: number;
  /** Total flujo de actividades operativas. */
  total: number;
}

export interface CashFlowInvestingSection {
  /** Δ Propiedad Planta y Equipo bruto (Clase 15 sin correctoras). */
  varPPE: number;
  /**
   * ± Otros movimientos de inversión: −Δ12 inversiones, −Δ16/17/18 brutos,
   * −Δ19 valorizaciones + Δ38 superávit por valorizaciones (no monetarios,
   * se netean entre sí).
   */
  otros: number;
  total: number;
}

export interface CashFlowFinancingSection {
  /** Δ Obligaciones financieras (21) y bonos (29), incluidos sobregiros reclasificados. */
  varObligacionesFinancieras: number;
  /**
   * Δ capital, superávit, reservas y revalorización (31-35) más el
   * movimiento de resultados acumulados que no es resultado del año ni
   * dividendo identificado.
   */
  varCapitalReservas: number;
  /**
   * Dividendos pagados (≤ 0), SÓLO con evidencia (2360/35):
   * Δ(36+37, incl. virtuales de R8) − utilidad del año + Δ2360.
   */
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
// R4 — Causación del impuesto de renta
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (niif-preproceso-17): R4 ya no calcula una "renta teórica"
// (35 % de la utilidad neta contra todo el grupo 24). La utilidad contable no
// es base fiscal; sin depuración verificada no se cuantifica impuesto ni
// brecha. `TaxProvisionRisk` se conserva sólo por compatibilidad de tipos y
// R4 no lo emite.
// ---------------------------------------------------------------------------

/** @deprecated R4 ya no cuantifica una brecha de renta (ver arriba). */
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
  /** Presentation v3.0 — D&A explícita + ORI condicional + ECP inteligente. */
  presentationV3?: import('@/lib/agents/financial/prompts/presentation-v3').PresentationV3Data;
  /** R2: flujo de efectivo método indirecto (si hay comparativo). */
  cashFlowIndirecto?: CashFlowStatement;
  /** R3: atribución de brecha de cuadratura (si hay descuadre). */
  balanceGapAttribution?: BalanceGapAttribution;
  /** R4 (histórico): ya no se emite; R4 sólo produce un hallazgo informativo. */
  taxProvisionRisk?: TaxProvisionRisk;
  /** R5: ajuste de anclaje patrimonial (Balance ↔ ECP). */
  convergenceAdjustment?: ConvergenceAdjustment;
  /** R6: cierre del flujo de efectivo (EFE ↔ caja PUC 11). */
  cashFlowClosureAdjustment?: CashFlowClosureAdjustment;
  /** R7: advertencia de costo presunto (no muta cifras). */
  presumedCostWarning?: PresumedCostWarning;
  /** R8: ajuste de Cierre Virtual (utilidad transitoria → patrimonio). */
  virtualCloseAdjustment?: VirtualCloseAdjustment;
  /** R9: auditoría del contrato raw + cents (precisión preservada). */
  precisionCentsAudit?: PrecisionCentsAudit;
  /** R10: clasificación cuenta 18 + detección causación impuesto. */
  class18ClassificationAudit?: Class18ClassificationAudit;
  /** R12: detector de cierre de libros (gate previo a R8). */
  closingDetectorAudit?: ClosingDetectorAudit;
  /** R14: PPE sin depreciación sincronizada. */
  ppeDepreciationAudit?: PpeDepreciationAudit;
  /** R15: costos sin grupo 6135 en comercializadoras. */
  costClassificationAudit?: CostClassificationAudit;
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
// R8 — Cierre Virtual (Autonomía de Cierre)
// ---------------------------------------------------------------------------
// Garantiza la ecuación patrimonial Activo = Pasivo + Patrimonio incluso si
// el balance de prueba se exporta a mitad de año (sin asiento de cierre) o
// si el ERP entrega un Clase 3 con un saldo histórico en 3605 que no
// corresponde al P&L del periodo.
//
// Cuando hay actividad P&L la regla:
//   1. Toma utilidad transitoria = Clase 4 - Clase 5 - Clase 6 - Clase 7
//      (ya calculada en `controlTotals.utilidadNeta` por preprocesamiento).
//   2. Lee el grupo 36 del CSV (3605 utilidad y 3610 pérdida del ejercicio).
//      Si coincide con la utilidad transitoria, es el resultado del periodo y
//      se reemplaza. Si difiere, es un resultado de ejercicios anteriores no
//      trasladado y se reclasifica a la cuenta virtual `3710VC`. Conserva
//      trazabilidad: anula el saldo de 36 a 0 sin remover la fila.
//   3. Inyecta una cuenta virtual `3605VC` (Resultado del Ejercicio — Corte
//      Actual) en Clase 3 con saldo = utilidad transitoria.
//   4. Recalcula `controlTotals.patrimonio` y `summary.totalEquity`.
//   5. NO absorbe ninguna otra diferencia. Si tras los pasos 2-3
//      Activo − Pasivo − Patrimonio ≠ 0 al centavo, el residual queda visible
//      como descuadre BLOQUEANTE (`validation.curatorBlockingReasons`).
//   6. Sobreescribe `equityBreakdown.utilidadEjercicio` con el cálculo
//      dinámico y suma la reclasificación a `utilidadesAcumuladas`.
//
// Severidad de findings:
//   - 'informativo' siempre (la regla siempre actúa por diseño).
//   - 'medio' si tuvo que reclasificar saldo material de 36 (auditor lo
//     debe revisar).
//   - 'critico' si queda un residual no explicado (bloquea la emisión).
// ---------------------------------------------------------------------------
export interface VirtualCloseAdjustment {
  /** Utilidad transitoria calculada del P&L (Clase 4 − 5 − 6 − 7). */
  dynamicNetIncome: number;
  /** Saldo del grupo 36 (3605 + 3610) leído del CSV (0 si no existía). */
  csvUtilidadEjercicio: number;
  /** Diferencia |dynamicNetIncome − csvUtilidadEjercicio|. */
  utilidadGap: number;
  /** Si true, hubo que reclasificar saldo no-trivial del grupo 36 a 3710VC. */
  reclassifiedFrom3605: boolean;
  /** Monto reclasificado del grupo 36 hacia 3710VC (0 si no hubo). */
  reclassifiedAmount: number;
  /** Activo − Pasivo − Patrimonio tras el traslado (pesos). Si ≠ 0 NO se
   *  absorbe: queda como descuadre bloqueante. */
  residualGapBeforeCents: number;
  /**
   * Histórico: ajuste residual absorbido en 3710VC. Desde la auditoría
   * 2026-09 R8 no absorbe residuales, así que siempre vale 0; se conserva
   * por compatibilidad con consumidores que lo leen.
   */
  centsAdjustment: number;
  /** Residual no explicado por el resultado del ejercicio, en pesos. */
  unexplainedResidual?: number;
  /** Mismo residual en string canónica de centavos exactos (`-?\d+\.\d{2}`). */
  unexplainedResidualRaw?: string;
  /** True si el residual ≠ 0 y el snapshot quedó bloqueado. */
  blocking?: boolean;
  /** Total Patrimonio FINAL post-R8 — autoritativo. */
  reconciledEquity: number;
  /** Cuenta virtual donde se imputa la utilidad del ejercicio. */
  virtualCurrentCode: string;
  virtualCurrentName: string;
  /** Cuenta virtual donde se reclasifica 3605 viejo y centavos. */
  virtualRetainedCode: string;
  virtualRetainedName: string;
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

// ---------------------------------------------------------------------------
// R9 — Precision Cents (parser endurecido, contrato raw + cents bigint)
// ---------------------------------------------------------------------------
// Garantiza que la aritmética monetaria se preserva sin pérdida de precisión:
// `controlTotals.raw` (string canónica) + `controlTotals.cents` (bigint en
// centavos). Los validators del gate comparan SIEMPRE en cents (BigInt) con
// tolerancia 0n.
// ---------------------------------------------------------------------------
export interface PrecisionCentsAudit {
  /** Total de campos canónicos verificados. */
  fieldsChecked: number;
  /** Cantidad de campos con drift detectado entre raw → number → cents. */
  driftCount: number;
  /** Lista de campos con drift (debug). */
  driftedFields: string[];
  /** True si el contrato raw + cents está intacto al centavo. */
  preserved: boolean;
}

// ---------------------------------------------------------------------------
// R10 — Clasificación cuenta 18 + detección de causación de impuesto
// ---------------------------------------------------------------------------
// Cuenta PUC 18xx ("Otros activos / Diferidos"): saldo deudor → siempre
// Activo. Si la entidad reporta gasto de impuesto en clase 5 grupo 54 sin la
// contraparte de pasivo en clase 2 grupo 24, marca `missingTaxCausation`.
// La regla NO inventa asientos; sólo detecta y reporta.
// ---------------------------------------------------------------------------
export interface Class18ClassificationAudit {
  /** Saldo neto agregado del grupo 18xx en clase 1 (puede ser 0). */
  class18BalanceCop: number;
  /** Saldo del grupo 54xx (impuestos como gasto) en clase 5. */
  taxExpenseCop: number;
  /** Saldo del grupo 24xx (impuestos por pagar) en clase 2. */
  taxPayableCop: number;
  /** True si hay gasto de impuesto sin causación correspondiente en pasivo. */
  missingTaxCausation: boolean;
  /** True si la cuenta 18 fue usada como gasto del periodo (saldo acreedor). */
  cuenta18UsadaComoGasto: boolean;
}

// ---------------------------------------------------------------------------
// R12 — Detector de cierre de libros
// ---------------------------------------------------------------------------
// "Sin traslado": el P&G del periodo es material y el grupo 36 no lo contiene
// (el grupo 37 son ejercicios anteriores y no cuenta). La bandera del gate
// (`librosNoCerrados` → V12) se omite en cortes 'parcial'. Además detecta un
// comparativo no cerrado (P&G del periodo posiblemente acumulado).
// ---------------------------------------------------------------------------

/** Evidencia de P&G acumulado por comparativo no cerrado (recalculo-03). */
export interface PygAcumuladoAudit {
  /** Periodo comparativo cuyo resultado no ingresó al patrimonio. */
  comparativePeriod: string;
  /** Resultado del comparativo (pesos). */
  utilidadComparativo: number;
  /** Resultado publicado del periodo principal (saldo final de clases 4-7). */
  utilidadPublicada: number;
  /** Cifra alternativa: resultado del ejercicio = publicado − comparativo (centavos exactos). */
  utilidadMovimientoRaw: string;
  /** Ingresos netos del ejercicio si el P&G es acumulado (centavos exactos). */
  ingresosNetosMovimientoRaw: string;
  /** Variación de resultados anteriores (patrimonio sin resultado del año, sin aportes). */
  variacionResultadosAnterioresRaw: string;
}

export interface ClosingDetectorAudit {
  /** Resultado del P&L del periodo (= controlTotals.utilidadNeta). */
  utilidadTransitoriaCop: number;
  /** Saldo neto REAL del grupo 36 (resultados del ejercicio) en clase 3. */
  grupo36SaldoCop: number;
  /** Saldo neto REAL del grupo 37 (resultados ejercicios anteriores) en clase 3. */
  grupo37SaldoCop: number;
  /** True si los libros NO están cerrados y el corte no es parcial (o el comparativo no se cerró). */
  librosNoCerrados: boolean;
  /** Asientos sugeridos (NO aplicados) para cerrar el periodo. */
  suggestedClosingEntries: string[];
  /** Presente si el P&G del periodo puede ser acumulado (comparativo sin cerrar). */
  pygAcumulado?: PygAcumuladoAudit;
}

// ---------------------------------------------------------------------------
// R14 — PPE sin depreciación sincronizada (Sección 17 NIIF para PYMES)
// ---------------------------------------------------------------------------
// Si saldo(15xxxx, excepto 1592) > umbral material AND saldo(1592xx) === 0
// AND saldo(5160xx) === 0 (en TODOS los periodos), levantar warning.
// NO muta el snapshot — sólo alerta.
// ---------------------------------------------------------------------------
export interface PpeDepreciationAudit {
  /** PPE bruto excluyendo cuenta 1592 (depreciación acumulada). */
  ppeBrutoCop: number;
  /** Saldo cuenta 1592 (depreciación acumulada). */
  depreciacionAcumuladaCop: number;
  /** Saldo cuenta 5160 (gasto depreciación del periodo). */
  gastoDepreciacionCop: number;
  /** True si hay PPE material sin depreciación correspondiente. */
  ppeWithoutDepreciation: boolean;
}

// ---------------------------------------------------------------------------
// R15 — Costos sin grupo 6135 (costeo incompleto en comercializadoras)
// ---------------------------------------------------------------------------
// Si la entidad reporta ingresos de comercialización (clase 41) AND
// saldo(6135xx) === 0 AND hay movimiento clase 7 etiquetado como costo,
// levantar `costeoIncompleto`. El renderer NO calcula margen bruto si este
// flag está activo (o lo marca con warning prominente).
// ---------------------------------------------------------------------------
export interface CostClassificationAudit {
  /** Ingresos de comercialización (grupo 4135 dentro de clase 41). */
  ingresosComercializacionCop: number;
  /** Saldo cuenta 6135 (costo de mercancías vendidas). */
  costo6135Cop: number;
  /** Saldo cuenta 7405 u otra clase 7 etiquetada como costo. */
  costoClase7Cop: number;
  /** True si el costeo está incompleto (clase 7 sin descargue 6135). */
  costeoIncompleto: boolean;
}

// ---------------------------------------------------------------------------
// Pillars Service — tipos públicos
// ---------------------------------------------------------------------------
// Agregador de KPIs ricos por los 4 Pilares (Escudo / Valor / Verdad / Futuro)
// con Health Score 0-100. Coexiste con `src/lib/kpis/pillar-view.ts` (queries
// SQL raw que alimentan el AreaCard grid del ExecutiveDashboard) — este módulo
// va un nivel arriba: 3 KPIs por pilar + alerts + score consolidado.
//
// Inputs principales:
//   - PeriodSnapshot del periodo actual (curator ya inyectado).
//   - Opcionales: comparative snapshot, ForensicScanResult, banking conciliation,
//                 history multi-período para proyecciones.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import type { CuratorResult, PresumedCostWarning } from '@/lib/preprocessing/curator-rules/types';

// ─── Status & severity ─────────────────────────────────────────────────────

export type PillarStatus = 'healthy' | 'watch' | 'warning' | 'critical';
export type PillarSeverity = 'success' | 'warning' | 'danger' | 'neutral';
export type PillarId = 'escudo' | 'valor' | 'verdad' | 'futuro';

// ─── KPI ────────────────────────────────────────────────────────────────────

export type KpiUnit = 'cop' | 'pct' | 'days' | 'months' | 'ratio' | 'count' | 'score';

export interface PillarKpi {
  /** Identificador estable para drill-down y tests. */
  key: string;
  /** Etiqueta es. */
  labelEs: string;
  /** Etiqueta en. */
  labelEn: string;
  /** Valor crudo del KPI. `null` cuando no se puede calcular. */
  value: number | null;
  /** Unidad para formateo en UI. */
  unit: KpiUnit;
  /** Target o umbral healthy de referencia (opcional). */
  target?: number;
  /** Score parcial 0-100 que aporta este KPI al pilar. */
  score: number;
  status: PillarStatus;
  severity: PillarSeverity;
  /** Descripción corta, accionable. */
  descriptionEs: string;
  descriptionEn: string;
}

// ─── Alertas dentro de un pilar ────────────────────────────────────────────

export interface PillarAlert {
  /** Código corto (e.g. 'SHIELD-LIQ-LOW'). */
  code: string;
  severity: PillarSeverity;
  titleEs: string;
  titleEn: string;
  messageEs: string;
  messageEn: string;
}

// ─── Métrica consolidada por pilar ─────────────────────────────────────────

export interface PillarMetrics {
  pillarId: PillarId;
  /** 0-100. */
  healthScore: number;
  status: PillarStatus;
  /** 3 KPIs maestros del pilar. */
  kpis: PillarKpi[];
  /** Alertas activas (pueden ser 0 si todo está sano). */
  alerts: PillarAlert[];
  /** Errores capturados durante el cómputo (no rompen el pilar). */
  errors?: Record<string, string>;
  generatedAt: string;
  /** Advertencia R7 (Curator) sobre costo de ventas posiblemente subestimado. */
  presumedCostWarning?: PresumedCostWarning;
  /** 4 tarjetas ejecutivas (sólo pilar Valor): EBITDA / Margen / Ratio / FCF. */
  executiveCards?: ValorExecutiveCards;
  /** 4 tarjetas ejecutivas (sólo pilar Escudo): Autonomía / Cobertura / Reserva Fiscal / Brecha. */
  escudoCards?: EscudoExecutiveCards;
  /** 4 tarjetas ejecutivas (sólo pilar Verdad): Ecuación Maestra / Consistencia / Anomalías / Salud. */
  verdadCards?: VerdadExecutiveCards;
  /** 4 tarjetas ejecutivas (sólo pilar Futuro): CAGR / Punto Quiebre / Prov. Tributaria / Capacidad Inv. */
  futuroCards?: FuturoExecutiveCards;
}

// ─── Tarjetas ejecutivas (Pilar Valor) ─────────────────────────────────────

export type ExecutiveCardColor = 'blue' | 'orange' | 'purple' | 'green';
export type ExecutiveCardKey =
  // Pilar Valor
  | 'ebitda' | 'waoo' | 'ratio' | 'fcf'
  // Pilar Escudo
  | 'autonomia' | 'cobertura_pasivos' | 'reserva_fiscal' | 'brecha_escudo'
  // Pilar Verdad
  | 'ecuacion_maestra' | 'consistencia' | 'anomalias' | 'salud_contable'
  // Pilar Futuro
  | 'cagr' | 'punto_quiebre' | 'provision_tributaria' | 'capacidad_inversion';

export interface ExecutiveCard {
  key: ExecutiveCardKey;
  labelEs: string;
  labelEn: string;
  /** Valor numérico crudo. `null` cuando no es calculable
   *  (ej. FCF sin periodo comparativo). */
  value: number | null;
  /** Unidad para formateo en UI:
   *  - cop: pesos colombianos abreviados ($1,2B / $1,2M).
   *  - pct: porcentaje (multiplica por 100, sufijo %).
   *  - ratio: número crudo (toFixed(2)).
   *  - count: entero sin decimales (errores, anomalías).
   *  - score: 0-100 sufijo /100.
   *  - months: meses (entero, sufijo "meses"/"months"). */
  unit: 'cop' | 'pct' | 'ratio' | 'count' | 'score' | 'months';
  color: ExecutiveCardColor;
  status: PillarStatus;
  /** Variación vs periodo anterior, mismo unit. `null` si no hay comparativo. */
  deltaVsComparative: number | null;
  descriptionEs: string;
  descriptionEn: string;
  /** Pasos del cálculo (texto humano para tooltip + auditor). */
  formulaEs: string;
  formulaEn: string;
}

export interface ValorExecutiveCardsAudit {
  /** Utilidad operacional NIIF: utilidadNeta + impuestosCuenta24. */
  utilidadOperacional: number;
  /** Suma cuentas Clase 5 con prefijo 5160 (Depreciaciones). */
  depreciaciones: number;
  /** Suma cuentas Clase 5 con prefijo 5165 (Amortizaciones). */
  amortizaciones: number;
  /** Total Clase 5 (Gastos Operacionales). */
  totalGastos: number;
  /** Total Clase 6 (Costos de Ventas). */
  totalCostos: number;
  /** Total Clase 4 (Ingresos). */
  totalIngresos: number;
  /** Var. PPE (Clase 15) — proxy de CapEx, del EFE indirecto NIC 7. */
  capex: number | null;
  /** Flujo operativo (operating.total del EFE). */
  operatingCashFlow: number | null;
}

export interface ValorExecutiveCards {
  ebitda: ExecutiveCard;
  /** Margen EBITDA (a.k.a. WAOO en el contrato visual). */
  waoo: ExecutiveCard;
  /** Ratio de eficiencia (Gastos+Costos)/Ingresos. */
  ratio: ExecutiveCard;
  /** Free Cash Flow = Operating − CapEx. */
  fcf: ExecutiveCard;
  audit: ValorExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Tarjetas ejecutivas (Pilar Escudo) ────────────────────────────────────

export interface EscudoExecutiveCardsAudit {
  /** Suma cuentas Clase 1 grupo 11 (Disponible / efectivo y equivalentes). */
  efectivoCuenta11: number;
  /** Suma cuentas Clase 1 grupo 12 (Inversiones temporales). */
  inversionesTemporales12: number;
  /** Total Clase 5+6+7 — gastos + costos del periodo. */
  totalEgresosPeriodo: number;
  /** Promedio mensual de egresos (totalEgresosPeriodo / 12 si anual,
   *  o promedio de los últimos N meses si multi-período). */
  promedioEgresosMensuales: number;
  /** Activo Corriente (clases 11 + 12 + 13). */
  activoCorriente: number;
  /** Pasivo Corriente (clases 21 + 22 + 23 + 24). */
  pasivoCorriente: number;
  /** Provisión registrada en cuenta 24 (Impuestos por Pagar). */
  provisionCuenta24: number;
  /** Renta teórica = utilidadNeta × 35% (Art. 240 E.T.). */
  rentaTeorica: number;
  /** Saldo de cuenta 2205 (Proveedores) — proxy de exigible 30 días. */
  proveedoresCuenta2205: number;
  /** Tasa de impuesto de renta aplicada (default 0.35). */
  tasaRenta: number;
  /** Cantidad de períodos usados para promedio (1 = anual, 3 = trimestre). */
  periodosUsados: number;
}

export interface EscudoExecutiveCards {
  /** Días de Autonomía Financiera = (caja + inversiones12) / promEgresosMes. */
  autonomia: ExecutiveCard;
  /** Cobertura de Pasivos = Activo Corriente / Pasivo Corriente. */
  cobertura_pasivos: ExecutiveCard;
  /** Reserva Fiscal = provisión24 − utilidadNeta×35% (negativo = déficit). */
  reserva_fiscal: ExecutiveCard;
  /** Brecha Escudo = Caja(11) − Proveedores(2205) en COP (negativo = riesgo). */
  brecha_escudo: ExecutiveCard;
  audit: EscudoExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Tarjetas ejecutivas (Pilar Verdad) ────────────────────────────────────

export interface VerdadExecutiveCardsAudit {
  /** Activo − Pasivo − Patrimonio (en COP, signo preservado). */
  equationGap: number;
  /** Cuentas Clase 1 (Activo) con saldo crédito (negativo). */
  saldosNegativosActivo: number;
  /** Cuentas Clase 2 (Pasivo) con saldo débito (positivo natural inverso). */
  saldosPositivosPasivo: number;
  /** Total de cuentas analizadas en la integridad de saldos. */
  totalCuentasAnalizadas: number;
  /** Reclasificaciones aplicadas por R1 (Curator). */
  reclasificacionesR1: number;
  /** Total de discrepancias del preprocessing. */
  discrepanciasPreprocessing: number;
  /** Findings 'critico' del Curator. */
  findingsCriticos: number;
  /** Findings 'alto' del Curator. */
  findingsAltos: number;
  /** Cuentas con variación absoluta >500% vs comparativo. */
  anomaliasVariacion: number;
  /** Margen bruto observado (Ingresos − Costos) / Ingresos. */
  margenBruto: number | null;
  /** Bandera margen bruto >95% (proxy de costos no registrados). */
  posibleOmisionCostos: boolean;
  /** Score forensic externo (si disponible). */
  forensicScore: number | null;
  /** % terceros con NIT válido (si disponible). */
  integridadTerceros: number | null;
}

export interface VerdadExecutiveCards {
  /** Ecuación Maestra = activo − pasivo − patrimonio (COP, 0 = sincronizado). */
  ecuacion_maestra: ExecutiveCard;
  /** Índice de Consistencia 0-100 (saldos signo + cuadratura + terceros). */
  consistencia: ExecutiveCard;
  /** # de Anomalías de Clasificación detectadas (count). */
  anomalias: ExecutiveCard;
  /** # de Errores de Salud Contable acumulados (count, lower-better). */
  salud_contable: ExecutiveCard;
  audit: VerdadExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Tarjetas ejecutivas (Pilar Futuro) ────────────────────────────────────

export interface FuturoExecutiveCardsAudit {
  /** Tasa CAGR de ingresos. Null si no hay periodo comparativo. */
  cagrIngresos: number | null;
  /** # períodos usados para el CAGR (2 si hay current+comparative; null si no). */
  periodosCagr: number | null;
  /** Ingresos del periodo actual. */
  ingresosActuales: number;
  /** Ingresos del periodo anterior (null si no hay comparative). */
  ingresosAnteriores: number | null;
  /** Mes donde el escenario conservador (factor 0.85) cruza 0 en caja proyectada
   *  a 36 meses. `null` si nunca cruza dentro del horizonte. */
  mesesAlQuiebreConservador: number | null;
  /** Mes donde el escenario base (factor 1.0) cruza 0. */
  mesesAlQuiebreBase: number | null;
  /** Utilidad neta anualizada proyectada al año siguiente (utilidadActual × (1+CAGR)). */
  utilidadProyectadaAnual: number;
  /** Provisión tributaria proyectada = utilidadProyectadaAnual × 35%. */
  provisionTributariaFutura: number;
  /** Capacidad de inversión actual = caja − provRenta − reserva60d. */
  capacidadInversion: number;
  /** Reserva 60 días de gastos en COP. */
  reserva60Dias: number;
  /** Caja proyectada al final del horizonte (escenario base). */
  cajaProyectada36mBase: number;
  /** Tasa de impuesto de renta (Art. 240 E.T.). */
  tasaRenta: number;
}

export interface FuturoExecutiveCards {
  /** CAGR de ingresos (proyección lineal, % anual). */
  cagr: ExecutiveCard;
  /** Mes hasta el punto de quiebre de caja (escenario conservador, lower-NOT-better visualmente). */
  punto_quiebre: ExecutiveCard;
  /** Provisión tributaria proyectada para el próximo año (COP). */
  provision_tributaria: ExecutiveCard;
  /** Capacidad de inversión: caja libre tras provisionar renta y reserva 60d (COP). */
  capacidad_inversion: ExecutiveCard;
  audit: FuturoExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Resultado consolidado de los 4 pilares ────────────────────────────────

export interface PillarsResult {
  escudo: PillarMetrics;
  valor: PillarMetrics;
  verdad: PillarMetrics;
  futuro: PillarMetrics;
  /** Promedio simple de los 4 health scores. */
  overallScore: number;
  /** Status agregado del overallScore. */
  overallStatus: PillarStatus;
  generatedAt: string;
}

// ─── Inputs auxiliares ─────────────────────────────────────────────────────

/** Mínimo subset de ForensicScanResult que el pilar Verdad necesita. */
export interface ForensicSummary {
  score: number;
  totalAnomalies: number;
  bySeverity: { low: number; medium: number; high: number };
}

/** Mínimo subset del estado de conciliación bancaria. */
export interface ConciliationSummary {
  /** Total de movimientos (facturas/pagos) considerados. */
  totalEntries: number;
  /** Cuántos están conciliados (cruzados con banco). */
  reconciledEntries: number;
}

export interface PillarsAggregateInput {
  /** Snapshot del periodo actual. Curator ya debe estar inyectado. */
  snapshot: PeriodSnapshot;
  /** Snapshot del periodo anterior, si está disponible. */
  comparative?: PeriodSnapshot | null;
  /** Forensic summary, si la última ejecución forense terminó. */
  forensic?: ForensicSummary | null;
  /** Estado de conciliación bancaria, si WS3 corrió. */
  conciliation?: ConciliationSummary | null;
  /** Curator result explícito (si el snapshot ya lo tiene como `curator`,
   *  este campo no es necesario — es para inyección manual en tests). */
  curator?: CuratorResult | null;
  /** Costo de oportunidad para EVA. Default 0.12 (TES Colombia + risk premium). */
  costoOportunidad?: number;
}

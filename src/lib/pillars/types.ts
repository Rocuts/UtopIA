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
}

// ─── Tarjetas ejecutivas (Pilar Valor) ─────────────────────────────────────

export type ExecutiveCardColor = 'blue' | 'orange' | 'purple' | 'green';
export type ExecutiveCardKey = 'ebitda' | 'waoo' | 'ratio' | 'fcf';

export interface ExecutiveCard {
  key: ExecutiveCardKey;
  labelEs: string;
  labelEn: string;
  /** Valor numérico crudo. `null` cuando no es calculable
   *  (ej. FCF sin periodo comparativo). */
  value: number | null;
  unit: 'cop' | 'pct' | 'ratio';
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

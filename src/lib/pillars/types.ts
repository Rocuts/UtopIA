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
import type { CuratorResult } from '@/lib/preprocessing/curator-rules/types';

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

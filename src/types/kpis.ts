/**
 * KPI type contract — shared between the 4 calculation engines (Agent D)
 * and their consumers (dashboard cards, "Escudo/Valor/Verdad/Futuro" windows).
 *
 * Design note: consumers own localization. The `label` field here carries a
 * Spanish fallback so engine output is self-describing in logs/exports, but
 * UI code is expected to override it with `t.elite.*` from the i18n dictionary.
 */

export type KpiSeverity = 'good' | 'neutral' | 'warn' | 'critical';
export type TrendDirection = 'up' | 'down' | 'flat';

export interface KpiBreakdown {
  /** Short human label ("EBITDA normalizado", "Tasa efectiva baseline", ...) */
  label: string;
  /** Raw numeric value — unit context is implied by the parent KPI */
  value: number;
  /** Pre-formatted display string ("$4.85B COP", "97/100", "22.4%"). Consumers should prefer this over formatting `value` themselves. */
  formatted?: string;
  /** Optional weight, used when the breakdown item is a component of a weighted score (e.g. compliance sub-scores) */
  weight?: number;
}

export interface KpiTrend {
  direction: TrendDirection;
  /** Percentage change vs previous period, e.g. 12.3 means +12.3%. Signed. */
  delta: number;
  /** Free-form period label for the UI, e.g. "vs último trimestre" */
  periodLabel?: string;
}

export interface KpiResult {
  kind: 'tef' | 'exit_value' | 'compliance' | 'roi_probabilistic';
  /** Raw numeric value. Unit defined by `unit` field. */
  value: number;
  /** User-facing display string ("22.4%", "$4.85B COP", "97/100") */
  formatted: string;
  unit: '%' | 'COP' | 'score' | 'ratio';
  /** Localized label fallback. UI may override with `t.elite.*`. */
  label: string;
  severity: KpiSeverity;
  trend?: KpiTrend;
  breakdown?: KpiBreakdown[];
  /** Supuestos usados en el cálculo (disclaimer surface) */
  assumptions?: string[];
  /** ISO timestamp of the calculation */
  calculatedAt: string;
  confidence?: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Inputs per KPI
// ---------------------------------------------------------------------------

export interface TefInput {
  /** Ingresos brutos anuales en COP */
  revenue: number;
  /** Base gravable SIN planeación fiscal (línea base) */
  taxableIncomeBaseline: number;
  /** Base gravable CON planeación fiscal aplicada */
  taxableIncomeOptimized: number;
  /** Tasa efectiva observada en el escenario baseline (0-1). Opcional: se infiere de taxRate si falta. */
  effectiveRateBaseline?: number;
  /** Tasa efectiva observada en el escenario optimizado (0-1). Opcional. */
  effectiveRateOptimized?: number;
  /** Tasa IR sociedades. Default 0.35 (Art. 240 ET Colombia 2026). */
  taxRate?: number;
  /** Datos del periodo anterior para calcular tendencia. */
  periodPrevious?: {
    taxableIncomeBaseline: number;
    taxableIncomeOptimized: number;
  };
}

export type ExitValueIndustry =
  | 'tech'
  | 'retail'
  | 'manufacturing'
  | 'services'
  | 'financial'
  | 'other';

export interface ExitValueInput {
  /** EBITDA anual COP normalizado (antes de ajustes) */
  ebitda: number;
  industry: ExitValueIndustry;
  /** Tasa de crecimiento esperada (0-1). Ej. 0.15 = 15%. */
  growthRate: number;
  /** WACC (0-1). Default 0.135 (13.5% CO típico 2026). Se usa para sanity-check/descuento. */
  wacc?: number;
  /** Deuda neta en COP. Se resta al EV para obtener Equity Value. Default 0. */
  netDebt?: number;
  /** Ajustes de EBITDA (add-backs, one-offs). Suma algebráica. */
  adjustments?: Array<{ label: string; amount: number }>;
  /** Permite override manual del múltiplo EBITDA. Omitir para usar la tabla por industria. */
  comparableMultiplesOverride?: number;
}

export type LastAuditOpinion =
  | 'favorable'
  | 'con_salvedades'
  | 'desfavorable'
  | 'abstension';

export interface ComplianceInput {
  /** Adherencia NIIF 0-100 */
  niifCompliance: number;
  /** Cumplimiento tributario (DIAN deadlines, declaraciones) 0-100 */
  taxCompliance: number;
  /** Cumplimiento legal / gobierno corporativo 0-100 */
  legalCompliance: number;
  /** Hallazgos de auditoría por severidad */
  auditFindingsCritical: number;
  auditFindingsHigh: number;
  auditFindingsMedium: number;
  /** Porcentaje de declaraciones presentadas a tiempo (0-100). Opcional, informativo. */
  declarationsOnTime?: number;
  /** Última opinión del revisor fiscal. Penaliza el score. */
  lastAuditOpinion?: LastAuditOpinion;
}

export interface RoiProbabilisticProject {
  name: string;
  /** Retorno esperado (0-1). TIR efectiva anual o NPV/Investment. */
  expectedReturn: number;
  /** Probabilidad de éxito (0-1) */
  probability: number;
  /** Inversión en COP */
  investment: number;
  /** Score de riesgo del proyecto (0-100). Opcional, puede reducir probability o informar breakdown. */
  riskScore?: number;
}

export interface RoiProbabilisticInput {
  projects: RoiProbabilisticProject[];
  /** Riesgo de mercado agregado (0-1). Default 0.25 (CO medio-alto). */
  marketRisk?: number;
  /** Tasa de descuento (0-1). Default 0.135. Informativa para el disclaimer; no se aplica por defecto al portfolio return (los proyectos ya traen TIR). */
  discountRate?: number;
}

// ---------------------------------------------------------------------------
// Registry type — consumers may type a plugin map against this
// ---------------------------------------------------------------------------

export interface KpiRegistry {
  tef: (input: TefInput) => KpiResult;
  exitValue: (input: ExitValueInput) => KpiResult;
  compliance: (input: ComplianceInput) => KpiResult;
  roiProbabilistic: (input: RoiProbabilisticInput) => KpiResult;
}

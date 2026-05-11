// ---------------------------------------------------------------------------
// Contrato JSON-strict del Agente 2 (Strategy Director)
// ---------------------------------------------------------------------------
// Output canónico del Strategy Director tras el refactor GPT-5.4 (Fase 2.A).
// Consumido, en orden:
//
//   1. El adapter LOCAL `toStrategicAnalysisResult(json)` dentro de
//      `agents/strategy-director.ts`, que sintetiza el struct legacy
//      `StrategicAnalysisResult` (Markdown) para mantener compatibilidad con
//      Governance Specialist, PDF Élite y Excel mientras dura la Fase 2.
//   2. En Fase 3 los renderers downstream se migran a consumir el JSON
//      directamente y el adapter se vuelve opcional.
//
// Decisiones de diseño:
//
// - Los KPIs financieros son arrays tipados con bandas de interpretación.
//   El validator determinístico puede revisar que ROE/ROA/Margen Neto estén
//   dentro de rangos razonables sin parsear Markdown.
// - El Flujo de Caja Proyectado es matricial: tabla de líneas con columnas
//   por escenario (conservador, base, agresivo) y por año (Año +1..+3).
// - Las recomendaciones estratégicas son estructuradas — cada una con
//   diagnóstico anclado, acción, impacto, prioridad y horizonte.
// - El callout R7 (advertencia de costos sub-registrados) es OPCIONAL y
//   `.nullable()` — strict json_schema friendly.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, NormaRef, StatementNoteSchema } from './base';

// ---------------------------------------------------------------------------
// KPI dashboard
// ---------------------------------------------------------------------------

export const KpiCategorySchema = z.enum([
  'profitability', // Margen Bruto / Operativo / Neto, EBITDA, ROE, ROA, DuPont
  'liquidity', // Razón Corriente, Prueba Ácida, Capital de Trabajo
  'solvency', // Endeudamiento, Apalancamiento, Cobertura de Intereses
  'efficiency', // Rotación de Activos, Ciclo Operativo, CCE
]);

export const KpiSchema = z.object({
  category: KpiCategorySchema,
  name: z.string().min(1).describe('Nombre legible. Ej: "Razón Corriente"'),
  formula: z.string().min(1).describe('Fórmula con números sustituidos. Ej: "(2.000M / 1.500M) = 1,33"'),
  /**
   * Resultado numérico crudo (sin formato) — string para evitar pérdida de
   * precisión cuando es un ratio (1,33) o un porcentaje (35,2). El renderer
   * formatea según `unit`.
   */
  resultPrimary: z.string().min(1),
  resultComparative: z.string().nullable(),
  unit: z.enum(['ratio', 'percent', 'days', 'times', 'cop']).describe('Unidad de presentación'),
  benchmarkBand: z.string().min(1).describe('Banda objetivo / interpretación. Ej: "> 1,5 saludable"'),
  diagnosis: z.string().min(1).describe('Diagnóstico contextual de 1-2 oraciones'),
  yoyVariation: z.string().nullable().describe('Variación YoY (puntos porcentuales o %). Null si single-period'),
});

export type KpiJson = z.infer<typeof KpiSchema>;

// ---------------------------------------------------------------------------
// Dashboard ejecutivo (cifras cardinales)
// ---------------------------------------------------------------------------

export const ExecutiveDashboardRowSchema = z.object({
  label: z.string().min(1).describe('Rubro. Ej: "Total Activo", "Utilidad Neta"'),
  primary: MoneyCop,
  comparative: MoneyCop.nullable(),
  variation: MoneyCop.nullable().describe('Variación absoluta (primary - comparative)'),
  variationPct: z.string().nullable().describe('Variación porcentual como string. Ej: "12,5"'),
  commentary: z.string().min(1).describe('Interpretación breve (1 oración)'),
});

export type ExecutiveDashboardRowJson = z.infer<typeof ExecutiveDashboardRowSchema>;

// ---------------------------------------------------------------------------
// Break-even (punto de equilibrio)
// ---------------------------------------------------------------------------

export const BreakEvenAnalysisSchema = z.object({
  fixedCostsCop: MoneyCop.describe('Costos fijos identificados (arriendos, nómina admin, depreciación, etc.)'),
  variableCostsCop: MoneyCop.describe('Costos variables identificados'),
  revenueCop: MoneyCop.describe('Ingresos operacionales del periodo'),
  breakEvenPointCop: MoneyCop.describe('PE = CF / (1 − CV/Ingresos)'),
  marginOfSafetyPct: z.string().describe('Margen de Seguridad = (Ventas − PE) / Ventas × 100. String decimal.'),
  classificationNote: z.string().min(1).describe('Cómo se clasificaron costos fijos vs variables; supuestos aplicados'),
});

// ---------------------------------------------------------------------------
// Proyección de flujo de caja (Big Four)
// ---------------------------------------------------------------------------

export const CashFlowScenarioSchema = z.enum(['conservative', 'base', 'aggressive']);

export const CashFlowProjectionLineSchema = z.object({
  concept: z.string().min(1).describe('Concepto. Ej: "Cobro Cartera (PUC 13 con DSO)"'),
  /** Año actual (cierre). MoneyCop con signo. */
  currentYear: MoneyCop,
  /** Año +1, Año +2, Año +3. MoneyCop con signo (negativo para salidas). */
  yearPlus1: MoneyCop,
  yearPlus2: MoneyCop,
  yearPlus3: MoneyCop,
  isSubtotal: z.boolean().describe('True para "Flujo de Caja Neto del Periodo" y "Saldo Final de Caja"'),
});

export const CashFlowScenarioProjectionSchema = z.object({
  scenario: CashFlowScenarioSchema,
  /** Supuestos del escenario (crecimiento de ingresos, inflación, etc.). */
  assumptions: z.string().min(1),
  lines: z.array(CashFlowProjectionLineSchema).min(1),
  finalCashBalanceYear3: MoneyCop.describe('Saldo final de caja en Año +3 — referencia rápida'),
});

export const LiquidityGateSchema = z.object({
  triggered: z.boolean().describe('True si AC < PC y la proyección se bloquea'),
  currentAssetsCop: MoneyCop,
  currentLiabilitiesCop: MoneyCop,
  gapCop: MoneyCop.describe('AC − PC (negativo si triggered)'),
  message: z.string().nullable().describe('Mensaje LITERAL de alerta cuando triggered=true; null en caso contrario'),
});

export const CashControlKpiSchema = z.object({
  name: z.enum(['net_cash_margin', 'days_of_autonomy', 'cumulative_return_on_flow']),
  unit: z.enum(['percent', 'days']),
  yearPlus1: z.string().min(1),
  yearPlus2: z.string().min(1),
  yearPlus3: z.string().min(1),
});

export const ProjectedCashFlowSchema = z.object({
  liquidityGate: LiquidityGateSchema,
  /** Saldo inicial = SOLO PUC 11 (Efectivo y Equivalentes). Citado del bindingTotals. */
  initialCashBalanceCop: MoneyCop,
  dsoDays: z.string().describe('Días de Cartera usados en la proyección (string decimal)'),
  inflationIndexPct: z.string().describe('% de inflación usado para indexar gastos fijos'),
  scenarios: z
    .array(CashFlowScenarioProjectionSchema)
    .describe('3 escenarios obligatorios cuando liquidityGate.triggered=false; vacío cuando triggered=true'),
  solvencyNarrative: z.string().describe('2-3 párrafos de análisis de solvencia y capacidad de inversión'),
  controlKpis: z.array(CashControlKpiSchema).describe('3 KPIs obligatorios cuando hay proyección; vacío si gate bloqueó'),
  assumptionsNote: z.string().describe('Sub-sección "Supuestos de la proyección" — DSO, indexación, % crecimiento, política dividendos, costo deuda'),
});

// ---------------------------------------------------------------------------
// Recomendaciones estratégicas
// ---------------------------------------------------------------------------

export const StrategicRecommendationSchema = z.object({
  title: z.string().min(1).describe('Título accionable, verbo en infinitivo'),
  diagnosis: z.string().min(1).describe('Qué muestran los datos — cita rubro + valor + periodo del Agente 1'),
  action: z.string().min(1).describe('Qué hacer concretamente — anclado a rubro del Balance/P&L'),
  expectedImpact: z.string().min(1).describe('Impacto esperado cuantificado cuando sea posible'),
  priority: z.enum(['high', 'medium', 'low']),
  horizon: z.enum(['immediate', 'short_term', 'medium_term']).describe('immediate: 0-30 días; short_term: 1-3 meses; medium_term: 3-12 meses'),
  normReference: NormaRef.nullable().describe('Cita normativa cuando la recomendación invoca una norma'),
});

// ---------------------------------------------------------------------------
// Callout R7 — Advertencia INTERNA de costos sub-registrados (no firmable)
// ---------------------------------------------------------------------------

export const PresumedCostWarningSchema = z.object({
  observedGrossMarginPct: z.string().describe('Margen bruto observado como string decimal. Ej: "85,4"'),
  costOfSalesCop: MoneyCop,
  revenueCop: MoneyCop,
  inventoryClosingCop: MoneyCop,
  sectorBenchmarkPct: z.string().describe('Benchmark del sector como string decimal'),
  recommendedActions: z.array(z.string().min(1)).min(1).describe('Lista de acciones de validación previas a firmar EEFF'),
  technicalCitation: NormaRef.describe('Cita técnica. Ej: "NIC 2 párr. 25 + Sección 13 PYMES"'),
});

// ---------------------------------------------------------------------------
// Output completo del Strategy Director
// ---------------------------------------------------------------------------

export const StrategyReportSchema = z.object({
  company: CompanyInfoSchema,

  // -- 1. Dashboard Ejecutivo ----------------------------------------------
  executiveDashboard: z.object({
    rows: z.array(ExecutiveDashboardRowSchema).min(1),
    executiveCommentary: z.string().min(1).describe('Comentario ejecutivo de 2-3 oraciones sobre el cierre'),
  }),

  // -- 2. KPIs financieros obligatorios ------------------------------------
  kpis: z.array(KpiSchema).min(1).describe('Profitability, Liquidity, Solvency, Efficiency — mínimo un KPI por categoría'),

  dupontAnalysis: z
    .object({
      roe: z.string().describe('ROE descompuesto como string decimal'),
      netMargin: z.string(),
      assetTurnover: z.string(),
      financialLeverage: z.string(),
      drivingFactor: z.string().min(1).describe('Cuál driver explica la variación del ROE'),
    })
    .nullable()
    .describe('Análisis DuPont — null si los datos no permiten descomposición'),

  // -- 3. Análisis de tendencias y break-even ------------------------------
  trends: z
    .object({
      yoyRevenue: z.string().nullable(),
      yoyEbitda: z.string().nullable(),
      yoyNetIncome: z.string().nullable(),
      yoyEquity: z.string().nullable(),
      marginDeltaPp: z.string().nullable().describe('Variación de margen en puntos porcentuales'),
      qualitativeCommentary: z.string().min(1),
    })
    .nullable()
    .describe('Null si no hay periodo comparativo'),

  breakEven: BreakEvenAnalysisSchema,

  // -- 4. Flujo de caja proyectado (Big Four) ------------------------------
  projectedCashFlow: ProjectedCashFlowSchema,

  // -- 5. Recomendaciones estratégicas -------------------------------------
  recommendations: z.array(StrategicRecommendationSchema).min(3).max(5),

  // -- 6. Callout R7 (opcional, no firmable) ------------------------------
  presumedCostWarning: PresumedCostWarningSchema.nullable(),

  // -- Notas del preparador (datos faltantes, supuestos) -------------------
  preparerNotes: z.array(StatementNoteSchema),
});

export type StrategyReportJson = z.infer<typeof StrategyReportSchema>;

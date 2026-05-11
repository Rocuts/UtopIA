// ---------------------------------------------------------------------------
// Contratos Zod — pipeline de Valoración Empresarial (NIIF 13 + Art. 90 ET)
// ---------------------------------------------------------------------------
//
// Pipeline híbrido: [DCF Modeler + Market Comparables] (paralelo) -> Valuation
// Synthesizer (secuencial). Estos schemas son el output canónico de los tres
// agentes tras el refactor GPT-5.4.
//
// Marco normativo modelado:
//   - NIIF 13 — Medición del Valor Razonable (jerarquía Niveles 1/2/3)
//   - NIC 36 — Deterioro del Valor de los Activos (value-in-use DCF)
//   - Art. 90 ET — Valor comercial para efectos fiscales (defensa DIAN)
//   - Superintendencia de Sociedades — Circular Externa 115-000011/2008
//   - Parámetros de mercado Colombia 2026: TES 10Y, EMBI Colombia, ERP emergentes
//
// Decisiones de diseño:
//
//  1. Las cifras de DCF (Enterprise/Equity Value, flujos proyectados, capex,
//     WC) se serializan como `MoneyCop` (centavos string) porque pueden
//     exceder fácilmente 2^53 (cualquier empresa mediana en COP).
//
//  2. Porcentajes (WACC, Ke, Kd, g, márgenes) son `z.number()` — la precisión
//     decimal de un porcentaje no excede el rango number JS y simplifica
//     fórmulas dentro del agente.
//
//  3. Multiplos comparables son `z.number()` con dos decimales esperados
//     (ej. EV/EBITDA = 8.5). El validator puede chequear ranges sectoriales.
//
//  4. La síntesis enforza la regla crítica: el rango final NO puede exceder
//     el máximo de ambas metodologías ni estar por debajo del mínimo de
//     ambas. Esto se valida post-LLM por el validator determinístico.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Schema Agente 1a — DCF Modeler
// ---------------------------------------------------------------------------

/** Una línea de proyección anual de Flujo de Caja Libre. */
export const FcfProjectionRowSchema = z.object({
  year: z.number().int().min(2000).max(2100).describe('Año de la proyección'),
  revenueCop: MoneyCop.describe('Ingresos en centavos COP'),
  ebitdaCop: MoneyCop,
  ebitCop: MoneyCop.describe('EBIT (Utilidad Operacional)'),
  taxCop: MoneyCop.describe('Impuestos sobre EBIT (35% Colombia 2026)'),
  depAmortCop: MoneyCop.describe('Depreciación y amortización'),
  capexCop: MoneyCop.describe('Inversiones en activos fijos'),
  workingCapitalChangeCop: MoneyCop.describe('Cambio en capital de trabajo neto'),
  fcfCop: MoneyCop.describe('Flujo de Caja Libre = EBIT*(1-t) + D&A - CAPEX - ΔWC'),
});

export type FcfProjectionRowJson = z.infer<typeof FcfProjectionRowSchema>;

/** Componentes del WACC con sus valores y la fórmula resultante. */
export const WaccBreakdownSchema = z.object({
  riskFreeRatePercent: z
    .number()
    .describe('Tasa libre de riesgo (TES 10Y Colombia ~12-13% nominal 2026)'),
  countryRiskPremiumPercent: z
    .number()
    .describe('EMBI Colombia (~2.0-3.0% en 2026)'),
  equityRiskPremiumPercent: z
    .number()
    .describe('Prima de riesgo de mercado emergentes (5-7%)'),
  beta: z.number().describe('Beta apalancado del sector'),
  sizePremiumPercent: z.number().describe('Size premium (0 si no aplica)'),
  costOfEquityPercent: z
    .number()
    .describe('Ke = Rf + Beta*(Rm-Rf) + CRP + SP (porcentaje)'),
  costOfDebtPercent: z.number().describe('Kd antes de impuestos (porcentaje)'),
  taxRatePercent: z
    .number()
    .describe('Tarifa de impuesto sobre la renta — 35% Colombia 2026 salvo regímenes especiales'),
  equityWeightPercent: z.number().describe('E/V en porcentaje'),
  debtWeightPercent: z.number().describe('D/V en porcentaje'),
  waccPercent: z
    .number()
    .describe('WACC = (E/V)*Ke + (D/V)*Kd*(1-t). Para empresa colombiana NO regulada típicamente > 10%.'),
  rationale: z.string().min(1).describe('Justificación de cada componente y fuente'),
});

/** Sensibilidad cruzada WACC vs g. */
export const SensitivityCellSchema = z.object({
  waccPercent: z.number(),
  growthPercent: z.number(),
  enterpriseValueCop: MoneyCop,
});

export const DcfModelReportSchema = z.object({
  company: CompanyInfoSchema,

  // -- 1. Proyección de FCF -------------------------------------------------
  projection: z.object({
    rows: z
      .array(FcfProjectionRowSchema)
      .min(3, 'Mínimo 3 años de proyección. Recomendado 5-10 (NIC 36 §33).'),
    keyAssumptions: z
      .array(z.string().min(1))
      .describe('Supuestos críticos: crecimiento, márgenes, capex como % de ingresos'),
  }),

  // -- 2. WACC --------------------------------------------------------------
  wacc: WaccBreakdownSchema,

  // -- 3. Valor terminal (Gordon Growth Model) ------------------------------
  terminalValue: z.object({
    nextYearFcfCop: MoneyCop.describe('FCF del primer año post-proyección (FCF_{n+1})'),
    perpetualGrowthPercent: z
      .number()
      .describe(
        'Tasa de crecimiento perpetuo g. NUNCA > 4% nominal (alineada con PIB Colombia largo plazo).',
      ),
    waccPercent: z.number().describe('WACC reusado del bloque anterior'),
    terminalValueCop: MoneyCop.describe('TV = FCF_{n+1} / (WACC - g)'),
    terminalValuePercentOfTotal: z
      .number()
      .describe('TV / Enterprise Value. Si > 75% señalar dependencia excesiva.'),
    rationale: z.string().min(1),
  }),

  // -- 4. Enterprise & Equity Value ----------------------------------------
  valuation: z.object({
    enterpriseValueCop: MoneyCop,
    netDebtCop: MoneyCop.describe('Deuda neta = Deuda financiera - Efectivo y equivalentes'),
    equityValueCop: MoneyCop.describe('Equity Value = EV - Deuda Neta + Caja'),
    pricePerShareCop: MoneyCop.nullable().describe('Precio por acción si hay número de acciones'),
  }),

  // -- 5. Sensibilidad ------------------------------------------------------
  sensitivity: z.object({
    cells: z
      .array(SensitivityCellSchema)
      .min(25, 'Tabla mínima 5x5 (5 WACC x 5 g). NIIF 13 jerarquía Nivel 3.'),
    baseCaseWaccPercent: z.number(),
    baseCaseGrowthPercent: z.number(),
  }),

  /** Notas de limitaciones: datos insuficientes, supuestos agresivos, etc. */
  limitations: z.array(z.string().min(1)),

  citations: z.array(NormaRef).describe('NIIF 13, NIC 36, Art. 90 ET, fuentes de mercado'),
});

export type DcfModelReportJson = z.infer<typeof DcfModelReportSchema>;

// ---------------------------------------------------------------------------
// Schema Agente 1b — Market Comparables
// ---------------------------------------------------------------------------

export const ValuationComparableSchema = z.object({
  name: z.string().min(1),
  country: z.string().min(1),
  source: z
    .string()
    .min(1)
    .describe('BVC, Bloomberg, Damodaran, SuperSociedades, Capital IQ'),
  revenueCop: MoneyCop.nullable(),
  ebitdaCop: MoneyCop.nullable(),
  evEbitda: z.number().nullable().describe('EV/EBITDA (ej. 8.5 = 8,5x)'),
  pe: z.number().nullable().describe('P/E (PER)'),
  pBv: z.number().nullable().describe('P/BV'),
  evRevenue: z.number().nullable().describe('EV/Revenue'),
  rationale: z.string().min(1).describe('Justificación de inclusión'),
});

export type ValuationComparableJson = z.infer<typeof ValuationComparableSchema>;

export const MultipleStatisticsSchema = z.object({
  multiple: z.enum(['ev_ebitda', 'pe', 'pbv', 'ev_revenue']),
  median: z.number(),
  mean: z.number(),
  min: z.number(),
  max: z.number(),
  count: z.number().int().min(1),
});

export const ColombianAdjustmentSchema = z.object({
  type: z.enum(['size_discount', 'illiquidity_discount', 'control_premium']),
  appliedPercent: z
    .number()
    .describe(
      'Magnitud aplicada. Convención: descuentos como porcentaje POSITIVO; el renderer formatea como (-X%).',
    ),
  rationale: z.string().min(1),
});

export const MarketComparablesReportSchema = z.object({
  company: CompanyInfoSchema,

  // -- 1. Selección de comparables -----------------------------------------
  comparableSelection: z.object({
    criteria: z.array(z.string().min(1)).describe('Criterios usados: CIIU, tamaño, geografía, etapa'),
    comparables: z
      .array(ValuationComparableSchema)
      .min(4, 'Mínimo 4-6 comparables recomendado (NIIF 13 Nivel 2)'),
    geographicNote: z.string().min(1).describe('Estrategia geográfica (Colombia/LatAm/global)'),
  }),

  // -- 2. Estadísticas de múltiplos -----------------------------------------
  multipleStatistics: z.array(MultipleStatisticsSchema),

  // -- 3. Valoración implícita ---------------------------------------------
  impliedValuation: z.object({
    targetRevenueCop: MoneyCop.nullable(),
    targetEbitdaCop: MoneyCop.nullable(),
    targetNetIncomeCop: MoneyCop.nullable(),
    targetBookValueCop: MoneyCop.nullable(),
    enterpriseValueMinCop: MoneyCop,
    enterpriseValueMedianCop: MoneyCop,
    enterpriseValueMaxCop: MoneyCop,
    equityValueMinCop: MoneyCop,
    equityValueMedianCop: MoneyCop,
    equityValueMaxCop: MoneyCop,
    primaryMultiple: z
      .enum(['ev_ebitda', 'pe', 'pbv', 'ev_revenue'])
      .describe('Múltiplo considerado más confiable para este caso'),
    primaryMultipleRationale: z.string().min(1),
  }),

  // -- 4. Ajustes colombianos ----------------------------------------------
  adjustments: z
    .array(ColombianAdjustmentSchema)
    .describe('Mínimo 1 ajuste salvo que la empresa cotice en BVC'),

  // -- 5. Rango final post-ajustes -----------------------------------------
  adjustedValueRange: z.object({
    conservativeCop: MoneyCop,
    baseCop: MoneyCop,
    optimisticCop: MoneyCop,
  }),

  limitations: z.array(z.string().min(1)),
  citations: z.array(NormaRef),
});

export type MarketComparablesReportJson = z.infer<typeof MarketComparablesReportSchema>;

// ---------------------------------------------------------------------------
// Schema Agente 2 — Valuation Synthesizer
// ---------------------------------------------------------------------------

export const MethodologyWeightSchema = z.object({
  method: z.enum(['dcf', 'market_comparables']),
  weightPercent: z
    .number()
    .min(0)
    .max(100)
    .describe('Peso asignado. La suma DCF+Comparables debe ser exactamente 100.'),
  rationale: z.string().min(1).describe('Justificación basada en calidad de datos y predictibilidad'),
});

export const ValuationSynthesisReportSchema = z.object({
  company: CompanyInfoSchema,
  purpose: z
    .string()
    .min(1)
    .describe('Propósito de la valoración (M&A, fiscal, interno, NIC 36)'),

  // -- 1. Ponderación de metodologías --------------------------------------
  methodologyWeights: z
    .array(MethodologyWeightSchema)
    .length(2, 'Exactamente 2: dcf + market_comparables'),

  // -- 2. Rango consolidado -------------------------------------------------
  consolidatedRange: z.object({
    conservativeCop: MoneyCop.describe('Piso: menor entre DCF sensibilidad baja y comparables con descuentos máximos'),
    baseCop: MoneyCop.describe('Punto medio: promedio ponderado'),
    optimisticCop: MoneyCop.describe('Techo: mayor entre DCF sensibilidad alta y comparables con descuentos mínimos'),
    confidenceLevel: z.enum(['alto', 'medio', 'bajo']).describe('Calidad de los datos subyacentes'),
    rationale: z.string().min(1),
  }),

  // -- 3. Reconciliación entre metodologías --------------------------------
  methodologyReconciliation: z.object({
    dcfMidpointCop: MoneyCop,
    comparablesMidpointCop: MoneyCop,
    divergencePercent: z.number().describe('|DCF - Comparables| / promedio (porcentaje)'),
    divergenceIsRedFlag: z
      .boolean()
      .describe('True si divergencia > 50% — debe explicarse en rationale'),
    rationale: z.string().min(1),
  }),

  // -- 4. Supuestos clave y sensibilidad ----------------------------------
  keyAssumptions: z.array(
    z.object({
      assumption: z.string().min(1),
      impactDescription: z.string().min(1),
    }),
  ),

  // -- 5. Implicaciones normativas -----------------------------------------
  regulatoryImplications: z.object({
    art90Et: z
      .string()
      .min(1)
      .describe('Implicaciones del Art. 90 E.T. — valor comercial frente a la DIAN'),
    nic36OrNiif3: z
      .string()
      .nullable()
      .describe('Comentario sobre NIC 36 (deterioro) o NIIF 3 (PPA) si aplica al propósito'),
    superSociedades: z
      .string()
      .nullable()
      .describe('Circular 115-000011/2008 si la valoración es para proceso societario'),
  }),

  // -- 6. Limitaciones ------------------------------------------------------
  limitations: z.array(z.string().min(1)),

  // -- 7. Opinión de valor + resumen ejecutivo -----------------------------
  valueOpinion: z.object({
    statement: z
      .string()
      .min(1)
      .describe(
        'Oración formal: "En nuestra opinión, el valor razonable de [empresa] se encuentra entre $X y $Y, con punto medio $Z."',
      ),
    executiveSummary: z.string().min(1).describe('Máximo 1 página conceptual, lenguaje directivo'),
  }),

  citations: z.array(NormaRef),
});

export type ValuationSynthesisReportJson = z.infer<typeof ValuationSynthesisReportSchema>;

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
//   - Parámetros de mercado: Rf en la moneda de los flujos (TES COP neto del
//     diferencial soberano, o UST USD + Fisher), ERP madura, CRP — con fuente
//     y fecha de corte (valoracion-07/18).
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
//     (ej. EV/EBITDA = 8.5).
//
//  4. Validación determinista post-LLM (valoracion-06/13/15): el LLM aporta
//     supuestos; el código recalcula y publica las cifras derivadas.
//       - DCF: `valuation/validators/dcf-validator.ts` recalcula Ke, WACC,
//         FCF por año, FCF(n+1), TV (Gordon, g < WACC obligatorio), factores
//         de descuento, EV, puente a patrimonio y la sensibilidad WACC × g.
//       - Múltiplos: `validators/comparables-validator.ts` recalcula
//         estadísticas, valor implícito y rango ajustado.
//       - Síntesis: `validators/synthesis-validator.ts` recalcula pesos
//         efectivos, punto medio, divergencia, bandera roja y acota el rango
//         a [mín, máx] de las metodologías disponibles.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Schema Agente 1a — DCF Modeler
// ---------------------------------------------------------------------------

/** Una línea de proyección anual de Flujo de Caja Libre. */
export const FcfProjectionRowSchema = z.object({
  year: z.number().int().min(2000).max(2100).describe('Año calendario de la proyección (consecutivos, ascendentes)'),
  revenueCop: MoneyCop.describe('Ingresos en centavos COP'),
  ebitdaCop: MoneyCop.describe('EBITDA = EBIT + D&A (el código lo recalcula)'),
  ebitCop: MoneyCop.describe('EBIT (Utilidad Operacional) — base del FCF'),
  taxCop: MoneyCop.describe('Impuesto operacional = t × EBIT si EBIT > 0; 0 si EBIT ≤ 0 (el código lo recalcula)'),
  depAmortCop: MoneyCop.describe('Depreciación y amortización (positiva)'),
  capexCop: MoneyCop.describe('Inversiones en activos fijos, como monto POSITIVO de salida de caja'),
  workingCapitalChangeCop: MoneyCop.describe('Aumento del capital de trabajo neto (positivo = salida de caja; negativo = liberación)'),
  fcfCop: MoneyCop.describe('FCF = EBIT − Impuesto operacional + D&A − CAPEX − ΔWC (el código lo recalcula)'),
});

export type FcfProjectionRowJson = z.infer<typeof FcfProjectionRowSchema>;

/**
 * Base de la tasa libre de riesgo (valoracion-07). El TES en COP ya incluye el
 * diferencial de incumplimiento soberano; sumarle además el CRP (EMBI) cuenta
 * dos veces el riesgo país. Dos construcciones coherentes:
 *   - `TES_COP_ex_default`: Rf = TES 10Y COP − diferencial soberano; Ke COP =
 *     Rf + β·ERP madura + CRP + SP.
 *   - `UST_USD_fisher`: Rf = UST 10Y USD; Ke USD = Rf + β·ERP madura + CRP + SP;
 *     Ke COP = (1 + Ke USD)·(1 + π COP)/(1 + π USD) − 1.
 */
export const RiskFreeBasisSchema = z.enum(['TES_COP_ex_default', 'UST_USD_fisher']);

export type RiskFreeBasis = z.infer<typeof RiskFreeBasisSchema>;

/** Componentes del WACC. El código recalcula Rf, Ke y WACC a partir de ellos. */
export const WaccBreakdownSchema = z.object({
  riskFreeBasis: RiskFreeBasisSchema.describe(
    'TES_COP_ex_default (Rf = TES COP − diferencial soberano) o UST_USD_fisher (Rf en USD + conversión Fisher a COP). Nunca TES completo + CRP.',
  ),
  sovereignYieldPercent: z
    .number()
    .nullable()
    .describe('Rendimiento TES 10Y COP bruto (base TES_COP_ex_default); null en base USD'),
  defaultSpreadPercent: z
    .number()
    .nullable()
    .describe('Diferencial de incumplimiento soberano restado al TES (base TES_COP_ex_default); null en base USD'),
  riskFreeRatePercent: z
    .number()
    .describe('Rf usado en CAPM: TES − diferencial (base COP) o UST 10Y (base USD)'),
  countryRiskPremiumPercent: z
    .number()
    .describe('Prima de riesgo país del patrimonio (CRP); 0 si no se aplica'),
  equityRiskPremiumPercent: z
    .number()
    .describe('Prima de riesgo de mercado MADURO (sin riesgo país; el riesgo país va sólo en CRP)'),
  beta: z.number().describe('Beta apalancado del sector'),
  sizePremiumPercent: z.number().describe('Size premium (0 si no aplica)'),
  copInflationPercent: z
    .number()
    .nullable()
    .describe('Inflación esperada COP para la conversión Fisher (base UST_USD_fisher); null en base COP'),
  usdInflationPercent: z
    .number()
    .nullable()
    .describe('Inflación esperada USD para la conversión Fisher (base UST_USD_fisher); null en base COP'),
  costOfEquityPercent: z
    .number()
    .describe('Ke nominal en COP (el código lo recalcula)'),
  costOfDebtPercent: z.number().describe('Kd antes de impuestos, en COP (porcentaje)'),
  taxRatePercent: z
    .number()
    .describe('Tarifa de impuesto sobre la renta — 35% Colombia 2026 salvo regímenes especiales'),
  equityWeightPercent: z.number().describe('E/V en porcentaje (E/V + D/V = 100)'),
  debtWeightPercent: z.number().describe('D/V en porcentaje (E/V + D/V = 100)'),
  waccPercent: z
    .number()
    .describe('WACC = (E/V)*Ke + (D/V)*Kd*(1-t) (el código lo recalcula)'),
  marketDataProvenance: z
    .string()
    .min(1)
    .describe(
      'Fuente y fecha de corte de TES/UST, diferencial soberano, CRP, ERP, beta e inflaciones. Si un valor no proviene de <macro_vigente> ni del usuario, rotúlalo "supuesto".',
    ),
  rationale: z.string().min(1).describe('Justificación de cada componente'),
});

export type WaccBreakdownJson = z.infer<typeof WaccBreakdownSchema>;

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
    nextYearFcfCop: MoneyCop.describe('FCF_{n+1} = FCF_n × (1 + g) (el código lo recalcula)'),
    perpetualGrowthPercent: z
      .number()
      .describe(
        'Tasa de crecimiento perpetuo g. NUNCA > 4% nominal (alineada con PIB Colombia largo plazo) y SIEMPRE < WACC.',
      ),
    waccPercent: z.number().describe('WACC reusado del bloque anterior'),
    terminalValueCop: MoneyCop.describe('TV = FCF_{n+1} / (WACC - g) (el código lo recalcula)'),
    terminalValuePercentOfTotal: z
      .number()
      .describe('VP(TV) / Enterprise Value en porcentaje (el código lo recalcula).'),
    rationale: z.string().min(1),
  }),

  // -- 4. Enterprise & Equity Value ----------------------------------------
  valuation: z.object({
    enterpriseValueCop: MoneyCop.describe('EV = Σ VP(FCF) + VP(TV) (el código lo recalcula)'),
    financialDebtCop: MoneyCop.nullable().describe(
      'Deuda financiera (obligaciones financieras CP + LP, arrendamientos financieros) a la fecha de valoración; null si no está en los datos',
    ),
    cashAndEquivalentsCop: MoneyCop.nullable().describe(
      'Efectivo y equivalentes a la fecha de valoración; null si no está en los datos',
    ),
    netDebtCop: MoneyCop.describe('Deuda neta = Deuda financiera − Efectivo y equivalentes'),
    otherBridgeAdjustmentsCop: MoneyCop.nullable().describe(
      'Ajustes netos del puente: + activos no operacionales − intereses minoritarios − contingencias; null si no aplica',
    ),
    equityValueCop: MoneyCop.describe(
      'Equity Value = EV − Deuda Neta (+ ajustes netos). La caja ya está restada dentro de la deuda neta: NO se suma otra vez.',
    ),
    sharesOutstanding: z
      .number()
      .int()
      .nullable()
      .describe('Número de acciones/cuotas en circulación; null si no está en los datos'),
    pricePerShareCop: MoneyCop.nullable().describe('Equity / acciones en circulación; null si no hay número de acciones'),
  }),

  // La sensibilidad WACC × g la calcula el código (valoracion-06): no se pide al LLM.

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
  sourceAsOf: z
    .string()
    .nullable()
    .describe('Fecha de corte del dato de la fuente (YYYY-MM o YYYY); null si no se conoce'),
  revenueCop: MoneyCop.nullable(),
  ebitdaCop: MoneyCop.nullable(),
  evEbitda: z.number().nullable().describe('EV/EBITDA (ej. 8.5 = 8,5x); null si no aplica (EBITDA ≤ 0)'),
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
      .describe(
        'Comparables con fuente verificable. Recomendado 4-6 (NIIF 13 Nivel 2); con menos, el código declara la limitación. Lista vacía si no hay datos reales.',
      ),
    geographicNote: z.string().min(1).describe('Estrategia geográfica (Colombia/LatAm/global)'),
  }),

  // -- 2. Estadísticas de múltiplos -----------------------------------------
  // El código las recalcula desde `comparables` (valoracion-13); lo emitido
  // por el LLM sólo se contrasta.
  multipleStatistics: z.array(MultipleStatisticsSchema),

  // -- 3. Valoración implícita ---------------------------------------------
  impliedValuation: z.object({
    targetRevenueCop: MoneyCop.nullable(),
    targetEbitdaCop: MoneyCop.nullable(),
    targetNetIncomeCop: MoneyCop.nullable(),
    targetBookValueCop: MoneyCop.nullable(),
    targetNetDebtCop: MoneyCop.nullable().describe(
      'Deuda neta del objetivo (deuda financiera − efectivo) para el puente EV → patrimonio; null si no está en los datos',
    ),
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
  // Valor del PATRIMONIO tras ajustes. El código lo recalcula como
  // patrimonio implícito (mín/mediana/máx) × Π(1 − descuento) × Π(1 + prima).
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
    .describe('Peso asignado. Métodos únicos; la suma de las metodologías disponibles debe ser exactamente 100.'),
  rationale: z.string().min(1).describe('Justificación basada en calidad de datos y predictibilidad'),
});

export const ValuationSynthesisReportSchema = z.object({
  company: CompanyInfoSchema,
  purpose: z
    .string()
    .min(1)
    .describe('Propósito de la valoración (M&A, fiscal, interno, NIC 36)'),

  // -- 1. Ponderación de metodologías --------------------------------------
  // valoracion-14: 1 elemento si sólo hay una metodología disponible; el
  // código fuerza peso 0 a la metodología caída y 100 a la única disponible.
  methodologyWeights: z
    .array(MethodologyWeightSchema)
    .min(1)
    .max(2)
    .describe('Una entrada por metodología disponible (dcf y/o market_comparables), sin duplicados'),

  // -- 2. Rango consolidado -------------------------------------------------
  // valoracion-15: el código recalcula la base (promedio ponderado de los
  // puntos medios) y acota conservador/optimista a [mín, máx] de las
  // metodologías disponibles, con conservador ≤ base ≤ optimista.
  consolidatedRange: z.object({
    conservativeCop: MoneyCop.describe('Piso del valor del patrimonio, dentro del rango de las metodologías disponibles'),
    baseCop: MoneyCop.describe('Punto medio: promedio ponderado de los puntos medios (el código lo recalcula)'),
    optimisticCop: MoneyCop.describe('Techo del valor del patrimonio, dentro del rango de las metodologías disponibles'),
    confidenceLevel: z.enum(['alto', 'medio', 'bajo']).describe('Calidad de los datos subyacentes'),
    rationale: z.string().min(1),
  }),

  // -- 3. Reconciliación entre metodologías --------------------------------
  // El código recalcula puntos medios, divergencia y bandera roja.
  methodologyReconciliation: z.object({
    dcfMidpointCop: MoneyCop.nullable().describe('Patrimonio DCF (caso base); null si el DCF no está disponible'),
    comparablesMidpointCop: MoneyCop.nullable().describe('Patrimonio por múltiplos (base ajustada); null si no está disponible'),
    divergencePercent: z
      .number()
      .nullable()
      .describe('|DCF - Comparables| / promedio (porcentaje); null con una sola metodología'),
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
      .describe(
        'Implicaciones del Art. 90 E.T. según el activo: acciones/cuotas no cotizadas (presunción valor intrínseco + 30%), bienes raíces (costo, avalúo catastral, autoavalúo), diferencia notoria > 15%',
      ),
    nic36OrNiif3: z
      .string()
      .nullable()
      .describe('Comentario sobre NIC 36 (deterioro) o NIIF 3 (PPA) si aplica al propósito'),
    superSociedades: z
      .string()
      .nullable()
      .describe(
        'Comentario sobre procesos societarios ante la Superintendencia de Sociedades (fusión, escisión) si aplica; sin citar circulares no verificadas',
      ),
  }),

  // -- 6. Limitaciones ------------------------------------------------------
  limitations: z.array(z.string().min(1)),

  // -- 7. Opinión de valor + resumen ejecutivo -----------------------------
  // La oración formal de la opinión de valor ("entre $X y $Y, con punto medio
  // $Z") la redacta el código con el rango validado (valoracion-15).
  valueOpinion: z.object({
    executiveSummary: z.string().min(1).describe('Máximo 1 página conceptual, lenguaje directivo'),
  }),

  citations: z.array(NormaRef),
});

export type ValuationSynthesisReportJson = z.infer<typeof ValuationSynthesisReportSchema>;

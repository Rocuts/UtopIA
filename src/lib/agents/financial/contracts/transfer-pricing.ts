// ---------------------------------------------------------------------------
// Contratos Zod — pipeline de Precios de Transferencia (Arts. 260-1 a 260-11 ET)
// ---------------------------------------------------------------------------
//
// Estos schemas son el output canónico de los 3 agentes del pipeline TP tras
// el refactor GPT-5.4. Los agentes emiten JSON estricto; un adapter local en
// cada `agents/*.ts` convierte a la estructura legacy `*Result` (campos
// markdown) que aún consumen el orchestrator y el renderer downstream.
//
// Marco normativo modelado:
//   - Arts. 260-1 a 260-11 ET (régimen completo de precios de transferencia)
//   - Decreto 2120/2017 (reglamentación técnica)
//   - Formato 1125 DIAN (declaración informativa)
//   - Guías OCDE 2022 (cap. I, II, III, VI, VII)
//
// Decisiones de diseño:
//
//  1. Strict Zod: opcionales se modelan con `.nullable()` (regla AI SDK v6 +
//     OpenAI strict json_schema). Nada de `.optional()` aquí.
//
//  2. Cifras monetarias se serializan como `MoneyCop` (centavos en string).
//     Razón: ver `contracts/base.ts`. Importante para evitar pérdida de
//     precisión en montos transados intragrupo (multinacionales colombianas
//     pueden exceder 2^53 centavos COP).
//
//  3. Métodos de TP modelados como enum tipado (PC/PR/CA/PU/MNT/OTROS) — el
//     validator determinístico puede mapear directo al código 1-6 del
//     Formato 1125 DIAN.
//
//  4. Comparables se modelan como arreglo estructurado, NO prosa. Permite al
//     validator chequear que el PLI de la tested party esté dentro del rango
//     intercuartil (Q1-Q3) sin parsear texto.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Primitivos del régimen
// ---------------------------------------------------------------------------

/**
 * Métodos del Art. 260-3 ET. Códigos Formato 1125:
 *   PC (1) = Precio Comparable no Controlado
 *   PR (2) = Precio de Reventa
 *   CA (3) = Costo Adicionado
 *   PU (4) = Participación en Utilidades
 *   MNT (5) = Margen Neto Transaccional
 *   OTROS (6) = Métodos para transacciones específicas (commodities, intangibles únicos)
 */
export const TpMethodSchema = z
  .enum(['PC', 'PR', 'CA', 'PU', 'MNT', 'OTROS'])
  .describe('Método del Art. 260-3 ET. Mapea 1:1 con códigos 1-6 del Formato 1125 DIAN.');

export type TpMethod = z.infer<typeof TpMethodSchema>;

/** Tipo de transacción controlada. */
export const ControlledTransactionTypeSchema = z.enum([
  'bienes',
  'servicios',
  'intangibles',
  'financieras',
  'costos_compartidos',
  'otros',
]);

/** Dirección del flujo en relación con el contribuyente colombiano. */
export const TransactionDirectionSchema = z.enum(['importacion', 'exportacion', 'doble_via']);

/**
 * Vinculado económico — parte relacionada con la que el contribuyente celebra
 * la transacción controlada (Art. 260-1 ET).
 */
export const RelatedPartySchema = z.object({
  name: z.string().min(1).describe('Razón social del vinculado'),
  taxId: z.string().min(1).describe('NIT o Tax ID extranjero'),
  jurisdiction: z.string().min(1).describe('País / jurisdicción del vinculado'),
  relationshipType: z
    .string()
    .nullable()
    .describe('Tipo de vinculación (Art. 260-1 numerales 1-12)'),
  isTaxHaven: z
    .boolean()
    .describe('True si la jurisdicción es paraíso fiscal (Art. 260-8 ET, Decreto 1966/2014)'),
});

export type RelatedPartyJson = z.infer<typeof RelatedPartySchema>;

/**
 * Transacción controlada — operación entre el contribuyente y un vinculado
 * económico, sujeta al principio de plena competencia (Art. 260-2 ET).
 */
export const ControlledTransactionSchema = z.object({
  description: z.string().min(1).describe('Descripción detallada de la operación'),
  type: ControlledTransactionTypeSchema,
  direction: TransactionDirectionSchema,
  amountCop: MoneyCop.describe('Monto en centavos COP (convertido si la operación original fue en otra moneda)'),
  relatedPartyName: z.string().min(1).describe('Razón social del vinculado contraparte'),
  contractualNotes: z
    .string()
    .nullable()
    .describe('Condiciones contractuales relevantes (incoterms, plazos, garantías)'),
});

export type ControlledTransactionJson = z.infer<typeof ControlledTransactionSchema>;

// ---------------------------------------------------------------------------
// Análisis funcional (FAR)
// ---------------------------------------------------------------------------

export const FunctionalAnalysisPartySchema = z.object({
  party: z
    .enum(['contribuyente', 'vinculado'])
    .describe('Parte cuyo perfil funcional se describe'),
  functions: z
    .array(z.string().min(1))
    .describe('Funciones desempeñadas (manufactura, I+D, distribución, etc.)'),
  assets: z
    .array(z.string().min(1))
    .describe('Activos empleados (tangibles, intangibles, financieros)'),
  risks: z
    .array(z.string().min(1))
    .describe('Riesgos asumidos (mercado, crédito, inventario, FX, IP, garantía)'),
});

export type FunctionalAnalysisPartyJson = z.infer<typeof FunctionalAnalysisPartySchema>;

// ---------------------------------------------------------------------------
// Schema Agente 1 — TP Analyst
// ---------------------------------------------------------------------------

export const TpAnalysisReportSchema = z.object({
  /** Eco de los datos de la empresa para trazabilidad. */
  company: CompanyInfoSchema,

  // -- 1. Evaluación de obligatoriedad (Art. 260-1 ET) -----------------------
  obligation: z.object({
    isObligated: z.boolean().describe('True si cumple umbrales del Art. 260-1 ET'),
    grossEquityCop: MoneyCop.describe('Patrimonio bruto del contribuyente en centavos COP'),
    grossEquityThresholdCop: MoneyCop.describe('Umbral 100.000 UVT en centavos COP (UVT 2026 = $52.374)'),
    grossEquityMeetsThreshold: z.boolean(),
    grossIncomeCop: MoneyCop.describe('Ingresos brutos del contribuyente en centavos COP'),
    grossIncomeThresholdCop: MoneyCop.describe('Umbral 61.000 UVT en centavos COP'),
    grossIncomeMeetsThreshold: z.boolean(),
    hasTaxHavenTransactions: z
      .boolean()
      .describe('True si hay operaciones con paraísos fiscales (Art. 260-8 ET)'),
    rationale: z.string().min(1).describe('Sustento normativo de la conclusión'),
  }),

  // -- 2. Vinculados y transacciones ----------------------------------------
  relatedParties: z.array(RelatedPartySchema).describe('Vinculados económicos identificados'),
  controlledTransactions: z
    .array(ControlledTransactionSchema)
    .describe('Transacciones controladas a analizar'),

  // -- 3. Análisis funcional (FAR) ------------------------------------------
  functionalAnalysis: z
    .array(FunctionalAnalysisPartySchema)
    .describe('Perfil FAR del contribuyente y del vinculado'),

  // -- 4. Selección del método (Art. 260-3 ET) -------------------------------
  methodSelection: z.object({
    selectedMethod: TpMethodSchema,
    testedParty: z
      .enum(['contribuyente', 'vinculado'])
      .describe('Parte analizada para el indicador de rentabilidad'),
    profitLevelIndicator: z
      .string()
      .min(1)
      .describe('PLI elegido: margen bruto, margen operacional, Berry ratio, MNT, etc.'),
    discardedMethods: z
      .array(z.object({ method: TpMethodSchema, reason: z.string().min(1) }))
      .describe('Métodos descartados con justificación'),
    justification: z.string().min(1).describe('Razón normativa y técnica de la elección'),
  }),

  // -- 5. Análisis preliminar de precios -----------------------------------
  preliminaryPricing: z.object({
    observedPliPercent: z
      .number()
      .nullable()
      .describe('PLI observado de la transacción controlada (porcentaje, ej. 8.5). Null si N/D.'),
    riskFlags: z
      .array(z.string().min(1))
      .describe('Banderas rojas: desvíos materiales, paraísos fiscales, perdidas sistemáticas'),
    requiresMedianAdjustment: z
      .boolean()
      .describe('True si el PLI observado parece estar fuera del rango (Art. 260-4 ET)'),
  }),

  /** Referencias normativas citadas en el análisis. */
  citations: z.array(NormaRef).describe('Lista de normas citadas (Art. X ET, Decreto Y, etc.)'),

  /** Notas técnicas adicionales (limitaciones de información, periodos faltantes). */
  technicalNotes: z.array(z.string().min(1)),
});

export type TpAnalysisReportJson = z.infer<typeof TpAnalysisReportSchema>;

// ---------------------------------------------------------------------------
// Schema Agente 2 — Comparable Analyst (Art. 260-4 ET)
// ---------------------------------------------------------------------------

export const ComparableEntrySchema = z.object({
  name: z.string().min(1).describe('Razón social del comparable'),
  jurisdiction: z.string().min(1),
  source: z
    .string()
    .min(1)
    .describe('Fuente: Orbis, RoyaltyStat, BVC, SuperSociedades, Damodaran, etc.'),
  activityDescription: z.string().min(1),
  pliPercent: z
    .number()
    .describe('Indicador de rentabilidad observado (porcentaje, ej. 7.5 para 7,5%)'),
  comparabilityQuality: z
    .enum(['alta', 'media', 'baja'])
    .describe('Calificación de calidad del comparable según los 5 factores OCDE'),
  adjustmentsApplied: z
    .array(z.string().min(1))
    .describe('Ajustes aplicados: capital de trabajo, contable, riesgo país, capacidad'),
  inclusionRationale: z.string().min(1).describe('Por qué se incluyó este comparable'),
  isSimulated: z
    .boolean()
    .describe('True si el comparable es ilustrativo por falta de acceso a base de datos real'),
});

export type ComparableEntryJson = z.infer<typeof ComparableEntrySchema>;

export const InterquartileRangeSchema = z.object({
  min: z.number().describe('Mínimo (P0) del conjunto de comparables en porcentaje'),
  q1: z.number().describe('Primer Cuartil (P25) en porcentaje'),
  median: z.number().describe('Mediana (P50) en porcentaje'),
  q3: z.number().describe('Tercer Cuartil (P75) en porcentaje'),
  max: z.number().describe('Máximo (P100) en porcentaje'),
  observedPliPercent: z
    .number()
    .nullable()
    .describe('PLI observado de la transacción controlada. Null si N/D.'),
  isWithinRange: z
    .boolean()
    .describe('True si Q1 ≤ observed ≤ Q3. Define cumplimiento del principio de plena competencia.'),
});

export type InterquartileRangeJson = z.infer<typeof InterquartileRangeSchema>;

export const ComparableAnalysisReportSchema = z.object({
  company: CompanyInfoSchema,

  // -- 1. Estrategia de búsqueda --------------------------------------------
  searchStrategy: z.object({
    sectorCodes: z
      .array(z.string().min(1))
      .describe('Códigos SIC/NAICS/CIIU usados para filtrar comparables'),
    geographicScope: z
      .array(z.string().min(1))
      .describe('Geografías priorizadas: Colombia, LatAm, emergentes globales'),
    timeWindow: z.string().min(1).describe('Ventana temporal (3-5 años centrados en el periodo)'),
    exclusionFilters: z
      .array(z.string().min(1))
      .describe('Empresas excluidas: pérdida sistemática, startups, reguladas, fusiones recientes'),
    rationale: z.string().min(1),
  }),

  // -- 2. Criterios OCDE de comparabilidad ----------------------------------
  comparabilityFactors: z
    .array(
      z.object({
        factor: z.enum([
          'caracteristicas_bienes_servicios',
          'analisis_funcional',
          'condiciones_contractuales',
          'circunstancias_economicas',
          'estrategias_empresariales',
        ]),
        description: z.string().min(1),
        materialDifferences: z.array(z.string().min(1)),
      }),
    )
    .describe('Los 5 factores OCDE de comparabilidad (cap. III)'),

  // -- 3. Comparables seleccionados ----------------------------------------
  selectedComparables: z
    .array(ComparableEntrySchema)
    .describe('Comparables que pasan el filtro tras aplicar criterios OCDE'),

  // -- 4. Rango intercuartil (Art. 260-4 ET) --------------------------------
  interquartileRange: InterquartileRangeSchema,

  // -- 5. Ajustes de comparabilidad ----------------------------------------
  adjustments: z
    .array(
      z.object({
        type: z.enum([
          'capital_trabajo',
          'contable',
          'riesgo_pais',
          'capacidad',
          'otro',
        ]),
        description: z.string().min(1),
        quantitativeImpactPercent: z
          .number()
          .nullable()
          .describe('Impacto cuantitativo en el PLI (puntos porcentuales). Null si N/D.'),
        rationale: z.string().min(1),
      }),
    )
    .describe('Ajustes de comparabilidad documentados'),

  // -- 6. Conclusión sobre plena competencia -------------------------------
  armLengthConclusion: z.object({
    complies: z
      .boolean()
      .describe('True si la transacción cumple plena competencia (Art. 260-4 ET)'),
    requiredAdjustmentCop: MoneyCop.describe(
      'Ajuste a la mediana requerido en centavos COP. "0" si cumple.',
    ),
    requiredAdjustmentPercent: z
      .number()
      .describe('Ajuste relativo al PLI observado (porcentaje). 0 si cumple.'),
    taxImpactNote: z
      .string()
      .nullable()
      .describe('Impacto fiscal estimado del ajuste (mayor renta gravable)'),
    rationale: z.string().min(1),
  }),

  citations: z.array(NormaRef),
  technicalNotes: z.array(z.string().min(1)),
});

export type ComparableAnalysisReportJson = z.infer<typeof ComparableAnalysisReportSchema>;

// ---------------------------------------------------------------------------
// Schema Agente 3 — TP Documentation Writer (Art. 260-5 ET + Decreto 2120/2017)
// ---------------------------------------------------------------------------

/** Sanción potencial por incumplimiento (Art. 260-11 ET). */
export const TpSanctionSchema = z.object({
  scenario: z
    .enum([
      'no_documentacion',
      'documentacion_con_errores',
      'no_declaracion_informativa',
      'declaracion_con_inconsistencias',
      'presentacion_extemporanea',
      'desconocimiento_costos',
    ])
    .describe('Escenario sancionatorio del Art. 260-11 ET'),
  maximumUvt: z.number().describe('Tope sancionatorio en UVT'),
  maximumCop: MoneyCop.describe('Tope sancionatorio en centavos COP (UVT 2026 = $52.374)'),
  description: z.string().min(1),
});

/** Fila de la guía para el Formato 1125 DIAN. */
export const Formato1125RowSchema = z.object({
  operationCode: z
    .string()
    .min(1)
    .describe('Código de operación DIAN (01-40+). Ej: "01 — Venta inventarios producidos"'),
  relatedPartyName: z.string().min(1),
  relatedPartyTaxId: z.string().min(1),
  countryCode: z.string().min(1).describe('Código país ISO o nombre normalizado'),
  amountCop: MoneyCop,
  methodCode: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
    .describe('1=PC, 2=PR, 3=CA, 4=PU, 5=MNT, 6=Otros — equivale a TpMethodSchema'),
  observedPliPercent: z.number().nullable(),
  q1Percent: z.number().nullable(),
  medianPercent: z.number().nullable(),
  q3Percent: z.number().nullable(),
  isWithinRange: z.boolean(),
  adjustmentCop: MoneyCop.describe('Ajuste aplicado en centavos COP. "0" si no aplica.'),
  remarks: z.string().nullable(),
});

export type Formato1125RowJson = z.infer<typeof Formato1125RowSchema>;

export const TpDocumentationReportSchema = z.object({
  company: CompanyInfoSchema,

  // -- 1. Resumen ejecutivo -------------------------------------------------
  executiveSummary: z.object({
    objective: z.string().min(1),
    period: z.string().min(1),
    transactionsOverview: z.string().min(1).describe('Resumen de transacciones controladas'),
    methodsApplied: z.array(TpMethodSchema),
    overallComplianceConclusion: z
      .enum(['cumple', 'no_cumple', 'cumple_con_ajustes'])
      .describe('Conclusión global sobre plena competencia'),
    keyRisks: z.array(z.string().min(1)),
    keyRecommendations: z.array(z.string().min(1)),
  }),

  // -- 2. Local File (documentación comprobatoria — Art. 260-5 ET) ---------
  localFile: z.object({
    taxpayerInfo: z.string().min(1).describe('Información del contribuyente y grupo empresarial'),
    industryDescription: z.string().min(1).describe('Contexto de la industria en Colombia y global'),
    transactionsDetail: z
      .string()
      .min(1)
      .describe('Detalle por operación: descripción, términos, monto, condiciones'),
    functionalAnalysisDetail: z.string().min(1).describe('FAR ampliado por operación'),
    economicAnalysisDetail: z
      .string()
      .min(1)
      .describe('Análisis económico: método, comparables, rango, ajustes'),
    conclusionsByOperation: z
      .array(
        z.object({
          transactionDescription: z.string().min(1),
          complies: z.boolean(),
          requiredAdjustmentCop: MoneyCop,
          fiscalImpactNote: z.string().nullable(),
        }),
      )
      .describe('Conclusión por operación con cuantificación'),
  }),

  // -- 3. Master File (Acción 13 BEPS — estructura) ------------------------
  masterFile: z.object({
    groupOrganizationalStructure: z.string().min(1),
    groupBusinessDescription: z.string().min(1),
    groupIntangibles: z.string().min(1),
    intercompanyFinancialActivities: z.string().min(1),
    groupFinancialAndTaxPositions: z.string().min(1),
  }),

  // -- 4. Guía Formato 1125 DIAN -------------------------------------------
  formato1125Rows: z
    .array(Formato1125RowSchema)
    .describe('Filas pre-calculadas para diligenciar el Formato 1125'),

  // -- 5. Sanciones potenciales (Art. 260-11 ET) ---------------------------
  potentialSanctions: z
    .array(TpSanctionSchema)
    .describe('Exposición sancionatoria si la documentación no se presenta o tiene errores'),

  // -- 6. Recomendaciones finales ------------------------------------------
  recommendations: z.array(
    z.object({
      title: z.string().min(1),
      detail: z.string().min(1),
      norm: NormaRef.nullable(),
    }),
  ),

  /** Defensa Art. 647 E.T. — diferencia de criterio frente a sanción por inexactitud. */
  art647Defense: z.object({
    applies: z
      .boolean()
      .describe('True cuando la posición se basa en interpretación razonable normativa'),
    rationale: z
      .string()
      .min(1)
      .describe('Sustento para invocar diferencia de criterio (Art. 647 E.T.)'),
  }),

  citations: z.array(NormaRef),
});

export type TpDocumentationReportJson = z.infer<typeof TpDocumentationReportSchema>;

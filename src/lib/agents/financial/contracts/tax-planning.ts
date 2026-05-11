// ---------------------------------------------------------------------------
// Contrato JSON-strict del pipeline Tax Planning (Fase 2.C — GPT-5.4)
// ---------------------------------------------------------------------------
// Tres agentes secuenciales:
//   1. Tax Optimizer   -> TaxOptimizationReportSchema (recomendaciones + ahorros)
//   2. NIIF Impact     -> NiifImpactReportSchema      (impacto contable NIC 12)
//   3. Compliance Val. -> ComplianceValidationReportSchema (risk + checklist)
//
// Reglas heredadas de `base.ts` y `niif-report.ts`:
//   - Cifras monetarias = MoneyCop (string en centavos COP).
//   - Opcionales = `.nullable()` (strict json_schema).
//   - Citas normativas = `NormaRef` (string libre validable).
//   - Taxonomías controladas con `z.enum` para mapeo determinista downstream.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Stage 1 — Tax Optimizer
// ---------------------------------------------------------------------------
// El optimizador produce el diagnóstico tributario actual, las estrategias
// rankeadas con ahorro proyectado en COP, la proyección consolidada y la hoja
// de ruta de implementación. El cálculo dual TMT (parág. 6 Art. 240 E.T.) es
// invariante crítico — vive en `currentDiagnosis.dualCalculation`.
// ---------------------------------------------------------------------------

/**
 * Régimen tributario evaluado. La taxonomía es cerrada para evitar que el LLM
 * proponga regímenes derogados (Megainversiones, Economía Naranja) como
 * vigentes. `derecho_adquirido` cubre el caso legítimo con contrato previo.
 */
export const TaxRegimeSchema = z.enum([
  'ordinario',
  'simple',
  'zona_franca',
  'zomac',
  'chc_holding',
  'rte_esal',
  'zese',
  'derecho_adquirido',
  'otro',
]);

/**
 * Cálculo dual Tarifa General 35% (Art. 240) vs Tarifa Mínima de Tributación
 * 15% (parág. 6 Art. 240 — Ley 2277/2022). El impuesto a cargo del periodo es
 * MAX(ordinaria, tmt). Si la entidad cae en una excepción (RTE, SIMPLE, ZESE,
 * ZOMAC), `tmtAplicable=false` y `tmtExemptionReason` debe citar la base.
 */
export const DualCalculationSchema = z.object({
  rentaOrdinaria35Cents: MoneyCop.describe('Renta líquida gravable × 35% (Art. 240 E.T.)'),
  tributacionMinima15Cents: MoneyCop.describe('Utilidad contable depurada × 15% (parág. 6 Art. 240 E.T.)'),
  impuestoACargoCents: MoneyCop.describe('MAX(ordinaria, TMT) — el mayor de los dos'),
  tmtAplicable: z.boolean().describe('false si la entidad cae en alguna excepción del parág. 6 Art. 240'),
  tmtExemptionReason: z
    .string()
    .nullable()
    .describe('Base legal de la excepción cuando tmtAplicable=false (Art. 19 RTE, Arts. 903-916 SIMPLE, Ley 1955/2019 Art. 268 ZESE, etc.)'),
});

export type DualCalculationJson = z.infer<typeof DualCalculationSchema>;

export const CurrentDiagnosisSchema = z.object({
  currentRegime: TaxRegimeSchema.describe('Régimen tributario actual identificado'),
  effectiveTaxRatePct: z
    .number()
    .describe('Tasa efectiva actual = Impuesto a cargo / UAI × 100. Usa null si UAI no es positiva.'),
  taxableIncomeCents: MoneyCop.describe('Renta líquida gravable depurada del periodo'),
  accountingProfitBeforeTaxCents: MoneyCop.describe('Utilidad contable antes de impuestos (UAI) — base de la TMT'),
  dualCalculation: DualCalculationSchema,
  currentBenefitsUsed: z
    .array(
      z.object({
        norma: NormaRef,
        descripcion: z.string().min(1),
        ahorroEstimadoCents: MoneyCop,
      }),
    )
    .describe('Beneficios tributarios actualmente aprovechados (deducciones, descuentos, exenciones)'),
  diagnosticNotes: z
    .string()
    .min(1)
    .describe('Narrativa ejecutiva del diagnóstico — limitaciones, datos faltantes, advertencias'),
});

export type CurrentDiagnosisJson = z.infer<typeof CurrentDiagnosisSchema>;

/**
 * Horizonte temporal de implementación de una estrategia.
 */
export const ImplementationHorizonSchema = z.enum(['corto', 'mediano', 'largo']);

/**
 * Una recomendación tributaria individual. Cada estrategia DEBE incluir su
 * artículo del E.T. (o ley/decreto) citado textualmente y el ahorro estimado
 * en MoneyCop. La estructura forza disciplina: el LLM no puede entregar
 * recomendaciones genéricas sin cifra.
 */
export const TaxRecommendationSchema = z.object({
  id: z.string().min(1).describe('ID corto e.g. "S1", "S2" para referencia cruzada'),
  title: z.string().min(1).describe('Título accionable, verbo en infinitivo'),
  norma: NormaRef.describe('Artículo E.T./ley/decreto que sustenta la estrategia'),
  regimeTarget: TaxRegimeSchema.nullable().describe('Régimen objetivo si la estrategia implica cambio (e.g. SIMPLE)'),
  rationale: z.string().min(1).describe('Diagnóstico: por qué aplica esta estrategia a esta empresa'),
  estimatedSavingsCents: MoneyCop.describe('Ahorro proyectado anual en centavos COP'),
  implementationCostCents: MoneyCop.describe('Costo de implementación en centavos COP (0 si no aplica)'),
  roiPct: z.number().nullable().describe('Retorno sobre la inversión fiscal — null si no es cuantificable'),
  horizon: ImplementationHorizonSchema,
  priority: z.enum(['alta', 'media', 'baja']),
  riskLevel: z.enum(['bajo', 'medio', 'alto']).describe('Riesgo regulatorio anti-abuso preliminar'),
  preconditions: z.array(z.string().min(1)).describe('Requisitos previos para activar el beneficio'),
});

export type TaxRecommendationJson = z.infer<typeof TaxRecommendationSchema>;

/**
 * Comparación escenario actual vs optimizado. Es una invariante: el ahorro
 * proyectado total debe coincidir con la suma de `estimatedSavingsCents` de
 * las recomendaciones (el orchestrator valida esto post-LLM).
 */
export const SavingsProjectionSchema = z.object({
  currentScenarioTaxCents: MoneyCop.describe('Impuesto a cargo actual estimado'),
  optimizedScenarioTaxCents: MoneyCop.describe('Impuesto a cargo proyectado tras estrategias'),
  totalAnnualSavingsCents: MoneyCop.describe('Suma de ahorros de las recomendaciones — invariante'),
  effectiveRateBeforePct: z.number().describe('Tasa efectiva ANTES de optimización'),
  effectiveRateAfterPct: z.number().describe('Tasa efectiva DESPUÉS de optimización'),
  assumptions: z.array(z.string().min(1)).describe('Supuestos del modelo de proyección (macro, sectoriales)'),
});

export type SavingsProjectionJson = z.infer<typeof SavingsProjectionSchema>;

/**
 * Una acción de la hoja de ruta. Cada paso amarrado a una recomendación por
 * `recommendationId` para trazabilidad. Plazos en días desde D0.
 */
export const RoadmapStepSchema = z.object({
  recommendationId: z.string().min(1).describe('Coincide con TaxRecommendation.id'),
  action: z.string().min(1).describe('Acción concreta (registro mercantil, calificación MinCiencias, etc.)'),
  owner: z.string().min(1).describe('Responsable interno o externo (CFO, Tributarista, MinCiencias, etc.)'),
  dueDaysFromKickoff: z.number().int().describe('Plazo en días corridos desde D0'),
  dependencies: z.array(z.string()).describe('IDs de pasos que deben completarse antes — vacío si no hay dependencias'),
});

export type RoadmapStepJson = z.infer<typeof RoadmapStepSchema>;

export const TaxOptimizationReportSchema = z.object({
  company: CompanyInfoSchema,
  currentDiagnosis: CurrentDiagnosisSchema,
  recommendations: z
    .array(TaxRecommendationSchema)
    .describe('Estrategias rankeadas por impacto (descendente por estimatedSavingsCents)'),
  savingsProjection: SavingsProjectionSchema,
  implementationRoadmap: z
    .array(RoadmapStepSchema)
    .describe('Acciones ordenadas por dueDaysFromKickoff ascendente'),
  preparerNotes: z
    .array(z.string().min(1))
    .describe('Datos faltantes, aproximaciones, limitaciones del análisis'),
});

export type TaxOptimizationReportJson = z.infer<typeof TaxOptimizationReportSchema>;

// ---------------------------------------------------------------------------
// Stage 2 — NIIF Impact Analyst
// ---------------------------------------------------------------------------
// Evalúa el impacto contable NIIF de cada estrategia. Reconocimiento, medición,
// presentación y revelación. Cuantifica la remedición de DTA/DTL cuando hay
// cambio de tarifa (NIC 12 §47) y los efectos en los estados financieros.
// ---------------------------------------------------------------------------

export const NiifImpactPerStrategySchema = z.object({
  recommendationId: z.string().min(1),
  affectedStandards: z
    .array(NormaRef)
    .describe('Normas NIIF afectadas (NIC 12, NIC 37, NIIF 10, NIC 27, NIC 8, NIIF 3, NIIF 15, NIIF 16)'),
  impactType: z.enum(['reconocimiento', 'medicion', 'presentacion', 'revelacion']),
  magnitude: z.enum(['alto', 'medio', 'bajo']),
  detail: z.string().min(1).describe('Descripción del impacto contable específico'),
  /**
   * Diferimiento del impuesto que surge de la estrategia. Si la estrategia no
   * genera nueva diferencia temporaria, ambas cifras son "0".
   */
  newDtaCents: MoneyCop.describe('Nuevo Activo por Impuesto Diferido generado'),
  newDtlCents: MoneyCop.describe('Nuevo Pasivo por Impuesto Diferido generado'),
});

export type NiifImpactPerStrategyJson = z.infer<typeof NiifImpactPerStrategySchema>;

/**
 * Remedición de DTA/DTL existente por cambio de tarifa (NIC 12 §47).
 * Aplica cuando una estrategia migra el régimen (ej. Ordinario 35% -> Zona
 * Franca 20% para exportaciones). El efecto se reconoce en resultados (o en
 * ORI si la diferencia temporaria original tenía ese origen).
 */
export const DeferredTaxRemeasurementSchema = z.object({
  originalRatePct: z.number().describe('Tarifa original (e.g. 35)'),
  newRatePct: z.number().describe('Nueva tarifa aplicable (e.g. 20 Zona Franca exportadora)'),
  affectedDtaCents: MoneyCop.describe('DTA existente a remedir'),
  affectedDtlCents: MoneyCop.describe('DTL existente a remedir'),
  pnlEffectCents: MoneyCop.describe('Efecto neto en resultados — signo según cargo/abono'),
  oriEffectCents: MoneyCop.describe('Efecto neto en ORI — signo según origen de la diferencia'),
});

export type DeferredTaxRemeasurementJson = z.infer<typeof DeferredTaxRemeasurementSchema>;

export const DisclosureRequirementSchema = z.object({
  norma: NormaRef.describe('Párrafo NIIF/NIC que exige la revelación (e.g. "NIC 12 §79-88")'),
  noteTitle: z.string().min(1).describe('Título sugerido para la nota a los EEFF'),
  noteBody: z.string().min(1).describe('Contenido sugerido de la revelación'),
});

export type DisclosureRequirementJson = z.infer<typeof DisclosureRequirementSchema>;

/**
 * Efectos cuantitativos en los estados financieros tras la implementación
 * agregada de TODAS las estrategias. Las cifras son MoneyCop. Sin agregación
 * monetaria global la revisión Gerencial no puede aprobar el plan.
 */
export const FinancialStatementEffectsSchema = z.object({
  balanceAssetsImpactCents: MoneyCop.describe('Efecto neto en Total Activo'),
  balanceLiabilitiesImpactCents: MoneyCop.describe('Efecto neto en Total Pasivo'),
  balanceEquityImpactCents: MoneyCop.describe('Efecto neto en Total Patrimonio'),
  pnlNetIncomeImpactCents: MoneyCop.describe('Efecto neto en Utilidad Neta del periodo'),
  oriImpactCents: MoneyCop.describe('Efecto neto en Otro Resultado Integral'),
  cashFlowOperatingImpactCents: MoneyCop.describe('Efecto en flujo de operación'),
  keyRatiosCommentary: z
    .string()
    .min(1)
    .describe('Análisis cualitativo de cambios en ROE, endeudamiento, etc.'),
});

export type FinancialStatementEffectsJson = z.infer<typeof FinancialStatementEffectsSchema>;

export const NiifImpactReportSchema = z.object({
  company: CompanyInfoSchema,
  impactPerStrategy: z.array(NiifImpactPerStrategySchema),
  deferredTaxRemeasurement: DeferredTaxRemeasurementSchema.nullable().describe(
    'Solo si alguna estrategia cambia la tarifa aplicable. Null en otros casos.',
  ),
  disclosureRequirements: z.array(DisclosureRequirementSchema),
  financialStatementEffects: FinancialStatementEffectsSchema,
  preparerNotes: z.array(z.string().min(1)),
});

export type NiifImpactReportJson = z.infer<typeof NiifImpactReportSchema>;

// ---------------------------------------------------------------------------
// Stage 3 — Compliance Validator
// ---------------------------------------------------------------------------
// Filtro de seguridad regulatorio. Valida cada estrategia contra GAAR
// (Art. 869 E.T.), sustancia económica (Art. 12-1, 20-2 E.T.), thin cap
// (Art. 118-1), precios de transferencia (Arts. 260-1..11) y exógena
// (Art. 631). Emite checklist + banderas rojas + dictamen final.
// ---------------------------------------------------------------------------

export const ComplianceCheckItemSchema = z.object({
  question: z.string().min(1).describe('Pregunta verificable del checklist'),
  passes: z.boolean().describe('true si la estrategia cumple, false si tiene gap'),
  evidence: z
    .string()
    .nullable()
    .describe('Evidencia o sustento documental que respalda el sí (null si passes=false)'),
  gapAction: z
    .string()
    .nullable()
    .describe('Acción correctiva si passes=false (null si passes=true)'),
});

export type ComplianceCheckItemJson = z.infer<typeof ComplianceCheckItemSchema>;

export const RegulatoryRiskAssessmentSchema = z.object({
  recommendationId: z.string().min(1),
  riskLevel: z.enum(['bajo', 'medio', 'alto']),
  potentialNormas: z
    .array(NormaRef)
    .describe('Normas que la DIAN podría invocar para cuestionar la estrategia (Art. 869, 118-1, etc.)'),
  businessPurposeTestPasses: z
    .boolean()
    .describe('true si supera el test de propósito comercial razonable del Art. 869 E.T.'),
  rationale: z.string().min(1).describe('Argumento que sustenta el nivel de riesgo'),
  /**
   * Defensa Art. 647 E.T. — diferencia de criterio. Si la estrategia se
   * cuestiona por la DIAN, este es el argumento para anular la sanción de
   * inexactitud (100%). DEBE invocarse cuando hay base doctrinal o
   * jurisprudencial razonable.
   */
  art647DefenseAvailable: z
    .boolean()
    .describe('true si la diferencia de criterio (Art. 647 E.T.) es invocable en caso de requerimiento'),
  art647DefenseRationale: z
    .string()
    .nullable()
    .describe('Sustento doctrinal/jurisprudencial para la diferencia de criterio. Null si no aplica.'),
  checklist: z.array(ComplianceCheckItemSchema),
});

export type RegulatoryRiskAssessmentJson = z.infer<typeof RegulatoryRiskAssessmentSchema>;

export const RegulatoryRedFlagSchema = z.object({
  flag: z.string().min(1).describe('Descripción de la bandera roja'),
  affectedRecommendations: z.array(z.string()).describe('IDs de recomendaciones afectadas'),
  norma: NormaRef.describe('Norma de la que deriva la bandera'),
  severity: z.enum(['informativa', 'advertencia', 'bloqueante']),
  mitigation: z.string().min(1).describe('Acción de mitigación recomendada'),
});

export type RegulatoryRedFlagJson = z.infer<typeof RegulatoryRedFlagSchema>;

export const DocumentationRequirementSchema = z.object({
  recommendationId: z.string().min(1),
  documents: z
    .array(
      z.object({
        document: z.string().min(1).describe('Nombre del documento (acta, concepto jurídico, etc.)'),
        norma: NormaRef.nullable().describe('Norma que lo exige (si aplica)'),
        mandatory: z.boolean(),
      }),
    )
    .min(1),
});

export type DocumentationRequirementJson = z.infer<typeof DocumentationRequirementSchema>;

/**
 * Dictamen final del Compliance Validator: blockers detiene la implementación,
 * con_salvedades permite implementar con condiciones, favorable aprueba el plan.
 */
export const ComplianceVerdictSchema = z.enum(['favorable', 'con_salvedades', 'desfavorable']);

export const ComplianceValidationReportSchema = z.object({
  company: CompanyInfoSchema,
  riskAssessments: z.array(RegulatoryRiskAssessmentSchema),
  documentationRequirements: z.array(DocumentationRequirementSchema),
  redFlags: z.array(RegulatoryRedFlagSchema),
  /**
   * Lista de blockers — estrategias con riesgo alto Y test de propósito comercial
   * fallido. Cada uno detiene la implementación de esa estrategia hasta resolverse.
   */
  blockers: z
    .array(
      z.object({
        recommendationId: z.string().min(1),
        reason: z.string().min(1),
        norma: NormaRef,
      }),
    )
    .describe('Estrategias bloqueadas — vacío si ninguna tiene riesgo terminal'),
  overallVerdict: ComplianceVerdictSchema,
  verdictRationale: z.string().min(1).describe('Justificación del dictamen consolidado'),
  preparerNotes: z.array(z.string().min(1)),
});

export type ComplianceValidationReportJson = z.infer<typeof ComplianceValidationReportSchema>;

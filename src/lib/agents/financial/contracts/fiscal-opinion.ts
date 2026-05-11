// ---------------------------------------------------------------------------
// Contratos JSON-strict — Pipeline Dictamen de Revisoria Fiscal
// ---------------------------------------------------------------------------
// Cuatro agentes:
//   1. Going Concern Auditor   (NIA 570)
//   2. Misstatement Reviewer   (NIA 315/320/330/450/500, NIC 8, NIC 37, NIIF 15)
//   3. Compliance Checker      (Art. 207-209 C.Co., Ley 43/1990, Ley 222/1995)
//   4. Opinion Drafter         (NIA 700/701/705/706/720)
//
// Strict mode Zod: `.nullable()` para opcionales (jamás `.optional()`), excepto
// donde un campo es genuinamente opcional sin participar en el strict json_schema
// de OpenAI (los wrappers `experimental_output` aceptan ambos en este SDK pero
// nullable es el contrato canónico).
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { NormaRef } from './base';

// ---------------------------------------------------------------------------
// 1. Going Concern Auditor (NIA 570)
// ---------------------------------------------------------------------------

export const GoingConcernAssessmentSchema = z.enum(['pass', 'caution', 'doubt']);

export const GoingConcernConclusionSchema = z.enum([
  'sin_incertidumbre',
  'incertidumbre_material',
  'base_inadecuada',
]);

export const GoingConcernIndicatorCategorySchema = z.enum([
  'financiero',
  'operacional',
  'regulatorio',
]);

export const GoingConcernIndicatorSeveritySchema = z.enum(['alto', 'medio', 'bajo']);

export const GoingConcernIndicatorSchema = z.object({
  category: GoingConcernIndicatorCategorySchema,
  description: z.string().min(1).describe('Descripcion del indicador detectado'),
  severity: GoingConcernIndicatorSeveritySchema,
  normReference: NormaRef.describe(
    'Norma exacta. Ej: "NIA 570 par. 10", "Art. 457 C.Co.", "Ley 1116/2006 art. 9"',
  ),
});

export type GoingConcernIndicatorJson = z.infer<typeof GoingConcernIndicatorSchema>;

export const GoingConcernReportSchema = z.object({
  assessment: GoingConcernAssessmentSchema.describe(
    'pass = hipótesis adecuada / caution = revisar / doubt = duda significativa',
  ),
  conclusion: GoingConcernConclusionSchema.describe('Conclusión formal NIA 570 par. 18-20'),
  indicators: z
    .array(GoingConcernIndicatorSchema)
    .describe('Indicadores que sustentan la conclusión; vacío si assessment=pass'),
  recommendedDisclosures: z
    .array(z.string().min(1))
    .describe('Revelaciones a incluir en las notas si conclusion != sin_incertidumbre'),
  analysis: z.string().min(1).describe('Narrativa del análisis con cálculos cuantificados'),
});

export type GoingConcernReportJson = z.infer<typeof GoingConcernReportSchema>;

// ---------------------------------------------------------------------------
// 2. Misstatement Reviewer (NIA 320 / NIA 450)
// ---------------------------------------------------------------------------

export const MisstatementTypeSchema = z.enum(['factual', 'judgmental', 'projected']);

export const MaterialityCalculationSchema = z.object({
  benchmark: z
    .string()
    .min(1)
    .describe('Benchmark utilizado. Ej: "5% utilidad antes de impuestos"'),
  baseAmount: z.number().describe('Monto base del benchmark en COP (no centavos — flujo legacy)'),
  materialityThreshold: z.number().describe('Materialidad global en COP'),
  performanceMateriality: z.number().describe('Materialidad de ejecución (50-75% global)'),
  trivialThreshold: z.number().describe('Umbral de trivialidad (5% de la global)'),
});

export type MaterialityCalculationJson = z.infer<typeof MaterialityCalculationSchema>;

export const IdentifiedMisstatementSchema = z.object({
  code: z.string().min(1).describe('Código único. Ej: "MIS-001"'),
  type: MisstatementTypeSchema,
  description: z.string().min(1),
  amount: z.number().describe('Efecto cuantificado en COP; 0 si no cuantificable'),
  corrected: z.boolean().describe('Si la administración corrigió la incorrección'),
  affectedArea: z.string().min(1).describe('Línea afectada del estado financiero'),
  normReference: NormaRef,
});

export type IdentifiedMisstatementJson = z.infer<typeof IdentifiedMisstatementSchema>;

export const MisstatementAssessmentSchema = z.enum([
  'material',
  'immaterial',
  'pervasive',
]);

export const MisstatementReviewReportSchema = z.object({
  materiality: MaterialityCalculationSchema,
  misstatements: z.array(IdentifiedMisstatementSchema),
  totalUncorrected: z
    .number()
    .describe('Suma de incorrecciones no corregidas en COP — el caller revalida'),
  materialInAggregate: z.boolean().describe('NIA 450 par. 11: efecto agregado material'),
  assessment: MisstatementAssessmentSchema.describe(
    'material = afecta opinion / immaterial = no afecta / pervasive = generalizado',
  ),
  analysis: z.string().min(1).describe('Narrativa con cálculos paso a paso'),
});

export type MisstatementReviewReportJson = z.infer<typeof MisstatementReviewReportSchema>;

// ---------------------------------------------------------------------------
// 3. Compliance Checker (Art. 207 C.Co. + regulatorio)
// ---------------------------------------------------------------------------

export const ComplianceStatusSchema = z.enum([
  'cumple',
  'cumple_parcial',
  'no_cumple',
  'no_evaluado',
]);

export const StatutoryFunctionSchema = z.object({
  number: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe('Función 1-10 del Art. 207 C.Co.'),
  description: z.string().min(1),
  status: ComplianceStatusSchema,
  observations: z.string().describe('Observaciones; vacío si no aplica'),
});

export type StatutoryFunctionJson = z.infer<typeof StatutoryFunctionSchema>;

export const ComplianceItemSchema = z.object({
  code: z.string().min(1).describe('Código único. Ej: "COMP-001", "INC-001"'),
  area: z
    .string()
    .min(1)
    .describe('Área: SAGRILAFT, tributario, societario, gobierno_corporativo'),
  requirement: z.string().min(1),
  status: ComplianceStatusSchema,
  normReference: NormaRef,
  observation: z.string().describe('Detalle de la observación o hallazgo'),
});

export type ComplianceItemJson = z.infer<typeof ComplianceItemSchema>;

export const ComplianceCheckReportSchema = z.object({
  statutoryFunctions: z
    .array(StatutoryFunctionSchema)
    .describe('Las 10 funciones Art. 207 C.Co. — emitir todas, no_evaluado si falta info'),
  regulatoryItems: z.array(ComplianceItemSchema).describe('Cumplimiento regulatorio'),
  independenceAssessment: z
    .string()
    .min(1)
    .describe('Evaluación de independencia (Ley 43/1990 art. 8, 37)'),
  nonComplianceItems: z
    .array(ComplianceItemSchema)
    .describe('Items con status no_cumple — replican entradas de regulatoryItems si aplica'),
  complianceScore: z
    .number()
    .min(0)
    .max(100)
    .describe('Score 0-100 ponderado por las 10 funciones + regulatorio'),
  analysis: z.string().min(1).describe('Narrativa completa del análisis'),
});

export type ComplianceCheckReportJson = z.infer<typeof ComplianceCheckReportSchema>;

// ---------------------------------------------------------------------------
// 4. Opinion Drafter (NIA 700/701/705/706)
// ---------------------------------------------------------------------------

export const OpinionTypeSchema = z.enum([
  'limpia',
  'con_salvedades',
  'adversa',
  'abstencion',
]);

export const KeyAuditMatterSchema = z.object({
  title: z.string().min(1).describe('Título del asunto clave (NIA 701)'),
  description: z.string().min(1).describe('Por qué se considera significativo'),
  auditResponse: z.string().min(1).describe('Cómo fue abordado en la auditoría'),
});

export type KeyAuditMatterJson = z.infer<typeof KeyAuditMatterSchema>;

export const FiscalOpinionDraftSchema = z.object({
  opinionType: OpinionTypeSchema,
  dictamenText: z
    .string()
    .min(1)
    .describe(
      'Texto formal completo del dictamen en formato colombiano (incluye TODAS las secciones obligatorias)',
    ),
  keyAuditMatters: z
    .array(KeyAuditMatterSchema)
    .describe('Asuntos clave NIA 701 — mínimo 1, máximo 3'),
  emphasisParagraphs: z
    .array(z.string().min(1))
    .describe('Párrafos de énfasis NIA 706 par. 6-7; vacío si no aplica'),
  otherMatterParagraphs: z
    .array(z.string().min(1))
    .describe('Párrafos de otras cuestiones NIA 706 par. 8-9; vacío si no aplica'),
  managementLetter: z
    .string()
    .min(1)
    .describe(
      'Carta de Gerencia con recomendaciones priorizadas (alta/media/baja); formato carta',
    ),
});

export type FiscalOpinionDraftJson = z.infer<typeof FiscalOpinionDraftSchema>;

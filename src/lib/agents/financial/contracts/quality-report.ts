// ---------------------------------------------------------------------------
// Contrato JSON-strict del Meta-Auditor de Calidad y Best Practices 2026
// ---------------------------------------------------------------------------
//
// Output canonico del Quality Meta-Auditor. Evalua el pipeline completo (3
// agentes + 4 auditores) contra:
//
//   - IASB Conceptual Framework (caracteristicas cualitativas)
//   - IFRS 18 (efectiva 1 enero 2027)
//   - ISO/IEC 25012 (data quality)
//   - ISO/IEC 42001 (AI governance)
//   - CTCP Colombia + Decreto 2420/2496
//
// Diseno:
//
// - 14 dimensiones (D1..D14) — el meta-auditor produce un score por dimension
//   con hallazgos y recomendaciones. El array es de longitud variable
//   (idealmente 14, pero se permite parcial cuando no hay datos para una D).
// - 5 dimensiones de calidad de datos (ISO 25012) — todas obligatorias.
// - 4 dimensiones de gobernanza IA (ISO 42001) — todas obligatorias.
// - IFRS 18 readiness — boolean + score + lista de brechas.
// - Recomendaciones prioritarias — top-5 ordenadas por impacto.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Grade — A+ a F (escala discreta)
// ---------------------------------------------------------------------------

export const QualityGradeEnum = z.enum(['A+', 'A', 'B', 'C', 'D', 'F']);
export type QualityGradeJson = z.infer<typeof QualityGradeEnum>;

// ---------------------------------------------------------------------------
// Quality dimension — espejo de `QualityDimension` legacy
// ---------------------------------------------------------------------------

export const QualityDimensionSchema = z.object({
  name: z.string().min(1).describe('Nombre de la dimension. Ej: "D1 Completitud", "D14 Multiperiodo"'),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Score 0-100 para esta dimension'),
  framework: z
    .string()
    .min(1)
    .describe('Marco de referencia. Ej: "ISO 25012", "IFRS Conceptual Framework", "NIC 1 par. 38"'),
  findings: z
    .array(z.string())
    .describe('Hallazgos especificos en esta dimension. Vacio si no hay.'),
  recommendations: z
    .array(z.string())
    .describe('Recomendaciones para mejorar esta dimension. Vacio si no hay.'),
});
export type QualityDimensionJson = z.infer<typeof QualityDimensionSchema>;

// ---------------------------------------------------------------------------
// Sub-secciones obligatorias
// ---------------------------------------------------------------------------

export const DataQualityMetricsSchema = z.object({
  completeness: z.number().int().min(0).max(100).describe('Completitud (ISO 25012)'),
  accuracy: z.number().int().min(0).max(100).describe('Exactitud (ISO 25012)'),
  consistency: z.number().int().min(0).max(100).describe('Consistencia (ISO 25012)'),
  timeliness: z.number().int().min(0).max(100).describe('Actualidad (ISO 25012)'),
  validity: z.number().int().min(0).max(100).describe('Validez (ISO 25012)'),
});
export type DataQualityMetricsJson = z.infer<typeof DataQualityMetricsSchema>;

export const AIGovernanceMetricsSchema = z.object({
  traceability: z.number().int().min(0).max(100).describe('Trazabilidad de la informacion (ISO 42001)'),
  explainability: z.number().int().min(0).max(100).describe('Explicabilidad de decisiones IA'),
  antiHallucination: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Anti-alucinacion: cifras y normas verificables'),
  humanOversight: z.number().int().min(0).max(100).describe('Supervision humana y disclaimers'),
});
export type AIGovernanceMetricsJson = z.infer<typeof AIGovernanceMetricsSchema>;

export const IFRS18ReadinessSchema = z.object({
  ready: z.boolean().describe('True si los EEFF ya son compatibles con NIIF 18'),
  score: z.number().int().min(0).max(100).describe('Score 0-100 de preparacion IFRS 18'),
  gaps: z.array(z.string()).describe('Brechas identificadas para cumplir NIIF 18'),
});
export type IFRS18ReadinessJson = z.infer<typeof IFRS18ReadinessSchema>;

// ---------------------------------------------------------------------------
// Recomendacion prioritaria
// ---------------------------------------------------------------------------

export const PriorityRecommendationSchema = z.object({
  action: z.string().min(1).describe('Accion concreta y accionable'),
  framework: z.string().min(1).describe('Marco de referencia o norma que la sustenta'),
  priority: z
    .enum(['alta', 'media', 'baja'])
    .describe('Prioridad relativa de la recomendacion'),
});
export type PriorityRecommendationJson = z.infer<typeof PriorityRecommendationSchema>;

// ---------------------------------------------------------------------------
// Output completo del Quality Meta-Auditor
// ---------------------------------------------------------------------------

export const QualityReportSchema = z.object({
  overallScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Score global 0-100 ponderando todas las dimensiones'),
  grade: QualityGradeEnum,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo de 3-4 parrafos sobre la calidad del reporte'),
  dimensions: z
    .array(QualityDimensionSchema)
    .describe('14 dimensiones (D1..D14) con score y findings/recommendations'),
  dataQuality: DataQualityMetricsSchema,
  aiGovernance: AIGovernanceMetricsSchema,
  ifrs18Readiness: IFRS18ReadinessSchema,
  priorityRecommendations: z
    .array(PriorityRecommendationSchema)
    .describe('Top-5 recomendaciones ordenadas por impacto'),
  conclusion: z.string().min(1).describe('Parrafo final con vision holistica de la calidad'),
});
export type QualityReportJson = z.infer<typeof QualityReportSchema>;

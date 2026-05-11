// ---------------------------------------------------------------------------
// Contratos JSON-strict de los 4 auditores especializados (post-GPT-5.4)
// ---------------------------------------------------------------------------
//
// Cada auditor (NIIF, Tributario, Legal, Revisoria Fiscal) emite un reporte
// estructurado validado por Zod strict. El runtime `callFinancialAgent` (ver
// `agents/runtime.ts`) lo enforza via `experimental_output: Output.object(...)`
// — los prompts NUNCA describen el schema en prosa.
//
// Diseno:
//
// - `AuditFindingSchema` espeja al `AuditFinding` legacy (audit/types.ts) con
//   campos opcionales convertidos a `.nullable()` (strict mode OpenAI).
// - Cada auditor agrega un schema dedicado (`NiifAuditReportSchema`, ...) con
//   campos especificos. El Fiscal Reviewer ademas devuelve `opinionType` y
//   `dictamen`.
// - Los `code` siguen un prefijo por dominio (NIIF-XXX, TRIB-XXX, LEG-XXX,
//   RF-XXX) — el Zod valida el prefijo de forma laxa via regex.
// - El `period` es nullable (los hallazgos no-periodo-especificos lo omiten).
// - El `impactCop` es opcional (`MoneyCop.nullable()`) para hallazgos
//   tributarios con exposicion calculable en pesos. El resto lo deja en null.
//
// Estos schemas viven en `contracts/audit-report.ts` y se exportan por barrel
// (`contracts/index.ts`) — el barrel lo edita Johan al final del refactor.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Enums compartidos — espejo de `audit/types.ts` (legacy TS)
// ---------------------------------------------------------------------------

export const FindingSeverityEnum = z.enum(['critico', 'alto', 'medio', 'bajo', 'informativo']);
export type FindingSeverityJson = z.infer<typeof FindingSeverityEnum>;

export const AuditDomainEnum = z.enum(['niif', 'tributario', 'legal', 'revisoria']);
export type AuditDomainJson = z.infer<typeof AuditDomainEnum>;

export const AuditOpinionTypeEnum = z.enum([
  'favorable',
  'con_salvedades',
  'desfavorable',
  'abstension',
]);
export type AuditOpinionTypeJson = z.infer<typeof AuditOpinionTypeEnum>;

// ---------------------------------------------------------------------------
// AuditFindingSchema — base compartida por los 4 auditores
// ---------------------------------------------------------------------------

export const AuditFindingSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe('Codigo unico del hallazgo. Prefijo por dominio: NIIF-XXX, TRIB-XXX, LEG-XXX, RF-XXX'),
  severity: FindingSeverityEnum,
  title: z.string().min(1).describe('Titulo breve y descriptivo del hallazgo'),
  description: z.string().min(1).describe('Descripcion detallada del problema o riesgo identificado'),
  normReference: NormaRef.describe('Referencia normativa exacta — articulo, parrafo o seccion'),
  recommendation: z.string().min(1).describe('Accion correctiva especifica y accionable'),
  impact: z.string().min(1).describe('Consecuencia de no corregir: sancion, salvedad, exposicion'),
  /**
   * Periodo aplicable al hallazgo:
   * - Periodo unico: "2025"
   * - Inter-periodo: "2024 → 2025"
   * - No periodo-especifico: null (el adapter pone el primario)
   */
  period: z.string().nullable().describe('Periodo al que aplica el hallazgo o null si no aplica'),
  /**
   * Exposicion en COP (centavos) cuando el auditor pueda calcularla — usado
   * principalmente por el Auditor Tributario. Null cuando no es cuantificable.
   */
  impactCop: MoneyCop.nullable().describe('Exposicion estimada en centavos COP cuando es calculable'),
});

export type AuditFindingJson = z.infer<typeof AuditFindingSchema>;

// ---------------------------------------------------------------------------
// Score bandera estable — 0..100 entero
// ---------------------------------------------------------------------------

const ComplianceScore = z
  .number()
  .int()
  .min(0)
  .max(100)
  .describe('Score de cumplimiento del dominio. 0 = incumplimiento total, 100 = ejemplar');

// ---------------------------------------------------------------------------
// Per-auditor reports
// ---------------------------------------------------------------------------

export const NiifAuditReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo de 2-3 parrafos con hallazgos principales'),
  findings: z.array(AuditFindingSchema).describe('Lista de hallazgos contables/NIIF'),
  conclusion: z
    .string()
    .min(1)
    .describe('Parrafo final sobre la calidad de los estados financieros'),
});
export type NiifAuditReportJson = z.infer<typeof NiifAuditReportSchema>;

export const TaxAuditReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo con hallazgos principales y exposicion fiscal estimada'),
  findings: z.array(AuditFindingSchema).describe('Lista de hallazgos tributarios (E.T. + DIAN)'),
  /**
   * Exposicion fiscal total estimada en centavos COP — suma de los impactCop
   * cuantificables. Null cuando ningun hallazgo es cuantificable.
   */
  totalFiscalExposureCop: MoneyCop
    .nullable()
    .describe('Suma de exposiciones fiscales cuantificables en centavos. Null si ninguna lo es.'),
  conclusion: z.string().min(1).describe('Parrafo final con opinion sobre el riesgo tributario global'),
});
export type TaxAuditReportJson = z.infer<typeof TaxAuditReportSchema>;

export const LegalAuditReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo con hallazgos legales principales'),
  findings: z.array(AuditFindingSchema).describe('Lista de hallazgos legales/societarios'),
  conclusion: z
    .string()
    .min(1)
    .describe('Parrafo final sobre la solidez juridica de los documentos'),
});
export type LegalAuditReportJson = z.infer<typeof LegalAuditReportSchema>;

// ---------------------------------------------------------------------------
// Fiscal Reviewer — agrega opinionType + materialidad + going concern
// ---------------------------------------------------------------------------

export const FiscalReviewMaterialitySchema = z.object({
  benchmarkLabel: z
    .string()
    .min(1)
    .describe('Etiqueta del benchmark usado. Ej: "5% utilidad antes de impuestos", "1% ingresos"'),
  materialityAmountCop: MoneyCop.describe('Materialidad calculada en centavos COP'),
  performanceMateriality: MoneyCop.describe('Materialidad de ejecucion (50-75% de la materialidad)'),
  comment: z
    .string()
    .min(1)
    .describe('Comentario de 1-2 frases sobre la suficiencia de la materialidad establecida'),
});
export type FiscalReviewMaterialityJson = z.infer<typeof FiscalReviewMaterialitySchema>;

export const FiscalReviewGoingConcernSchema = z.object({
  hasMaterialUncertainty: z
    .boolean()
    .describe('True si existe incertidumbre material sobre empresa en funcionamiento'),
  indicatorsFound: z
    .array(z.string())
    .describe('Indicadores observados (financieros, operacionales, legales). Vacio si no hay duda.'),
  conclusion: z
    .string()
    .min(1)
    .describe('Conclusion clara sobre el supuesto de empresa en funcionamiento (NIA 570)'),
});
export type FiscalReviewGoingConcernJson = z.infer<typeof FiscalReviewGoingConcernSchema>;

export const FiscalReviewReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Evaluacion general de razonabilidad de los EEFF (2-3 parrafos)'),
  materiality: FiscalReviewMaterialitySchema,
  goingConcern: FiscalReviewGoingConcernSchema,
  findings: z.array(AuditFindingSchema).describe('Hallazgos de aseguramiento (NIA/ISA + Ley 43/1990)'),
  opinionType: AuditOpinionTypeEnum.describe('Tipo de opinion conforme a NIA 700-706'),
  dictamen: z
    .string()
    .min(1)
    .describe('Dictamen formal del Revisor Fiscal con bloque de firma literal al cierre'),
});
export type FiscalReviewReportJson = z.infer<typeof FiscalReviewReportSchema>;

// ---------------------------------------------------------------------------
// Contrato JSON-strict del Agente 3 (Governance Specialist)
// ---------------------------------------------------------------------------
// Output canónico del Governance Specialist tras el refactor GPT-5.4 (Fase 2.A).
// Cubre las dos piezas legales que produce este agente:
//
//   - DOCUMENTO 1: Notas a los Estados Financieros (NIC 1 §112-138 / Sec. 8 PYMES).
//   - DOCUMENTO 2: Acta de Asamblea/Junta Ordinaria.
//
// Consumido por:
//   1. El adapter LOCAL `toGovernanceResult(json)` dentro de
//      `agents/governance-specialist.ts`, que sintetiza el struct legacy
//      `GovernanceResult` (Markdown) para mantener compatibilidad con PDF
//      Élite y validators v1.
//   2. En Fase 3 los renderers se migran a consumir el JSON directamente.
//
// Decisiones de diseño:
//
// - Las 14 notas a los EEFF son una lista tipada con número fijo (1..14) +
//   título + cuerpo + cita normativa opcional. El renderer reconstruye los
//   encabezados Markdown.
// - El Acta es matricial: orden del día (lista), desarrollo de cada punto
//   (lista de objetos), bloque de firmas (estructurado), dictamen RF opcional.
// - Las firmas usan la estructura canónica de `SignatoriesSchema` definida en
//   `base.ts`, no strings sueltos — evita que el LLM invente T.P.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import {
  CompanyInfoSchema,
  MoneyCop,
  NormaRef,
  SignatoriesSchema,
  StatementNoteSchema,
} from './base';

// ---------------------------------------------------------------------------
// Notas a los Estados Financieros (NIC 1 / Sec. 8 PYMES)
// ---------------------------------------------------------------------------

export const FinancialNoteNumberSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
  z.literal(11),
  z.literal(12),
  z.literal(13),
  z.literal(14),
]);

export const FinancialNoteSchema = z.object({
  number: FinancialNoteNumberSchema.describe('Número fijo 1..14 — Entidad, Políticas, Efectivo, Deudores, Inventarios, PPE, Obligaciones Financieras, CxP, Impuestos, Pasivos Laborales, Patrimonio, Ingresos, Contingencias, IFRS 18'),
  title: z.string().min(1).describe('Título de la nota'),
  body: z.string().min(1).describe('Cuerpo en prosa profesional — cifras con formato COP'),
  normReference: NormaRef.nullable().describe('Cita normativa principal cuando aplique'),
  materiality: z.enum(['material', 'immaterial', 'omitted']).describe('Si la nota es material, immaterial o se omitió por no aplicar'),
});

// ---------------------------------------------------------------------------
// Acta de Asamblea / Junta Ordinaria
// ---------------------------------------------------------------------------

export const AgendaItemSchema = z.object({
  number: z.number().int().min(1).describe('Ordinal del punto'),
  topic: z.string().min(1).describe('Descripción del punto. Ej: "Aprobación de los estados financieros del periodo 2025"'),
});

export const AgendaDevelopmentSchema = z.object({
  itemNumber: z.number().int().min(1).describe('Referencia al punto del orden del día'),
  body: z.string().min(1).describe('Desarrollo del punto en prosa formal'),
});

export const ResultDistributionLineSchema = z.object({
  label: z.string().min(1).describe('Concepto. Ej: "10% — Reserva LEGAL"'),
  amountCop: MoneyCop,
  normReference: NormaRef.describe('Cita normativa LEGALMENTE TIPIFICADA. Ej: "Art. 452 C.Co."'),
});

export const ResultDistributionSchema = z.object({
  netIncomeCop: MoneyCop.describe('Utilidad Neta del Ejercicio — copia LITERAL del bindingTotals'),
  applies: z.boolean().describe('True si se propone distribución; false si la entidad no constituye reserva legal por régimen SAS sin habilitación estatutaria'),
  lines: z.array(ResultDistributionLineSchema).describe('Líneas de la propuesta (legal/ocasional/distribuible). Vacío si applies=false'),
  neutralProposalText: z.string().nullable().describe('Texto neutral cuando applies=false: "Los accionistas decidirán la destinación..." Null cuando applies=true'),
});

export const CapitalizationProposalSchema = z.object({
  applies: z.boolean().describe('True cuando hay utilidades retenidas materiales que justifiquen capitalizar 40%'),
  retainedEarningsBaseCop: MoneyCop.describe('Saldo acumulado de utilidades retenidas (PUC 36)'),
  capitalizationAmountCop: MoneyCop.describe('40% × retainedEarningsBaseCop'),
  legalReference: NormaRef.describe('Cita LITERAL. Ej: "Ley 1258/2008 art. 5 (SAS) + E.T. art. 36-3"'),
  body: z.string().min(1).describe('Texto LITERAL de la proposición — palabras exactas para el acta'),
});

export const SignatureBlockEntrySchema = z.object({
  role: z.enum([
    'presidente_asamblea',
    'secretario_asamblea',
    'representante_legal',
    'revisor_fiscal',
    'contador_publico',
  ]),
  name: z.string().nullable().describe('Nombre del firmante. Null si pendiente — el renderer pone placeholder visible'),
  identification: z.string().nullable().describe('C.C. del Representante Legal o T.P. del RF/Contador (formato "12345-T"). Null si no aplica'),
});

export const FiscalReviewerOpinionSchema = z.object({
  applies: z.boolean().describe('True si la entidad tiene Revisor Fiscal obligado (Art. 203 C.Co. + Ley 43/1990 art. 13)'),
  reviewerName: z.string().nullable(),
  reviewerTp: z.string().nullable().describe('Formato "12345-T"'),
  opinionType: z.enum(['favorable', 'con_salvedades', 'desfavorable', 'abstension']).nullable(),
  opinionBody: z.string().nullable().describe('Síntesis del dictamen — NIA 700/705/706 + Art. 207-209 C.Co.'),
  exemptionReason: z.string().nullable().describe('Justificación cuando applies=false. Ej: "Entidad no obligada por umbral Art. 203 C.Co."'),
});

export const ShareholderMinutesSchema = z.object({
  assemblyType: z.enum(['Asamblea General de Accionistas', 'Junta de Socios']),
  entityRegimeCitation: NormaRef.describe('Régimen societario aplicable. Ej: "Ley 1258 de 2008 (SAS)"'),
  city: z.string().nullable().describe('Ciudad de la reunión. Null si no se conoce'),
  meetingDate: z.string().nullable().describe('Fecha de la reunión (libre formato). Null si no se conoce'),
  quorumStatement: z.string().min(1).describe('Afirmación de quorum — sin porcentajes inventados'),
  agenda: z.array(AgendaItemSchema).min(5).describe('Orden del día — mínimo 5 puntos canónicos'),
  developments: z.array(AgendaDevelopmentSchema).describe('Desarrollo de cada punto del orden del día'),
  resultDistribution: ResultDistributionSchema,
  capitalizationProposal: CapitalizationProposalSchema,
  signatures: z.array(SignatureBlockEntrySchema).min(3).describe('Bloque de firmas — mínimo Presidente, Secretario, Representante Legal'),
  fiscalReviewerOpinion: FiscalReviewerOpinionSchema,
  closingStatement: z.string().min(1).describe('Texto formal de cierre del acta'),
});

// ---------------------------------------------------------------------------
// Output completo del Governance Specialist
// ---------------------------------------------------------------------------

export const GovernanceReportSchema = z.object({
  company: CompanyInfoSchema,
  /**
   * Firmantes estructurados. Espejo de `CompanyInfo.signatories` — el agente
   * los repite para que el renderer Markdown pueda armar el bloque de firmas
   * sin re-leer `company`.
   */
  signatories: SignatoriesSchema.nullable(),
  // -- DOCUMENTO 1: Notas a los Estados Financieros ------------------------
  financialNotes: z.array(FinancialNoteSchema).min(1).describe('Notas 1..14 — material/immaterial/omitted'),
  // -- DOCUMENTO 2: Acta de Asamblea ---------------------------------------
  shareholderMinutes: ShareholderMinutesSchema,
  // -- Notas del preparador (datos faltantes) ------------------------------
  preparerNotes: z.array(StatementNoteSchema),
});

export type GovernanceReportJson = z.infer<typeof GovernanceReportSchema>;

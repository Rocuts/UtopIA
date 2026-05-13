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
//
// ---------------------------------------------------------------------------
// FRONTERAS DE RESPONSABILIDAD (Wave 4.A3 audit gaps #5/#9/#10)
// ---------------------------------------------------------------------------
//
// Governance NO produce metadatos Slide 12 (hash del documento, fecha de
// extracción, fecha de emisión, % cobertura de cuentas). Esos metadatos son
// responsabilidad del Editor Jefe HTML downstream, que los genera sobre su
// propio output final.
//
// Governance NO produce el disclaimer reformulado positivo de §5 Slide 12
// ("Este reporte fue generado con..."). Ese disclaimer lo emite el Editor
// Jefe HTML en el momento de componer el documento final de entrega.
//
// El §11 checklist de emisión de la spec v8.1 lo ejecuta el Editor Jefe HTML
// sobre su propio output — NO el Governance Specialist. El campo
// `complianceChecklist` de este schema es el checklist normativo de la entidad
// (DECRETO 2420, C.Co., DIAN exógena, etc.); no es el §11 checklist de emisión.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import {
  CompanyInfoSchema,
  ConfidenceLevelSchema,
  MoneyCop,
  NormaRef,
  ReportModeSchema,
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
  // Why: NIC 24 §13-22 / Sec. 33 PYMES — revelar transacciones con partes
  // vinculadas y personal clave directivo. Omitir esta nota es no-conformidad
  // material según CTCP doctrina 2022.
  z.literal(15),
  // Why: NIC 10 §17 / Sec. 32.9 PYMES — fecha de autorización para publicación
  // y órgano que la autoriza. Requisito explícito de la norma.
  z.literal(16),
]);

export const FinancialNoteSchema = z.object({
  number: FinancialNoteNumberSchema.describe('Número fijo 1..16 — Entidad, Políticas, Efectivo, Deudores, Inventarios, PPE, Obligaciones Financieras, CxP, Impuestos, Pasivos Laborales, Patrimonio, Ingresos, Contingencias, IFRS 18, Partes Vinculadas (NIC 24), Autorización Publicación (NIC 10 §17)'),
  title: z.string().min(1).describe('Título de la nota'),
  body: z.string().min(1).describe('Cuerpo en prosa profesional — cifras con formato COP'),
  normReference: NormaRef.nullable().describe('Cita normativa principal cuando aplique'),
  materiality: z.enum(['material', 'immaterial', 'omitted']).describe('Si la nota es material, immaterial o se omitió por no aplicar'),
  // Why: el Editor Jefe HTML downstream renderiza un dot visual junto al
  // número de la nota cuando confidence != 'high' (`.conf.medium` ámbar,
  // `.conf.low` rojo). `null` es equivalente a 'high' — sin dot, sin ruido.
  confidence: ConfidenceLevelSchema.nullable().describe('Nivel de confianza de la cifra / contenido de la nota. Null equivale a high (sin dot visual). medium y low activan el dot del Editor Jefe HTML.'),
});

// ---------------------------------------------------------------------------
// Checklist de Cumplimiento Normativo (Parte III §3 spec v2.0)
// ---------------------------------------------------------------------------
// Why: el spec exige cerrar el documento de Gobierno con un checklist tipado
// que evidencie qué normas se aplicaron, qué falta y qué no aplica. Hasta
// ahora vivía como prosa libre dentro de las notas — sin estructura no era
// auditable. Schema estructurado permite: (a) auditor team valida coverage,
// (b) PDF Élite lo renderiza como tabla, (c) downstream pipelines pueden
// activarse según `status='pendiente'`.

export const ComplianceChecklistItemSchema = z.object({
  topic: z.string().min(1).describe('Área normativa: ej "NIIF PYMES", "Distribución Utilidades"'),
  norma: z.string().min(1).describe('Cita normativa: ej "Decreto 2420/2015", "C.Co. Art. 446"'),
  status: z.enum(['cumplido', 'parcial', 'pendiente', 'no_aplica']),
  evidencia: z.string().min(1).describe('Evidencia o referencia al hecho que sustenta el status'),
  accionRequerida: z.string().nullable().describe('Si status != "cumplido", qué falta'),
});

export type ComplianceChecklistItemJson = z.infer<typeof ComplianceChecklistItemSchema>;

// ---------------------------------------------------------------------------
// Disclaimers Automáticos (Parte 9 spec v2.0)
// ---------------------------------------------------------------------------
// Why: los 6 disclaimers de la Parte 9 son entidades estructuradas con
// texto LITERAL fijado por spec — no pueden emitirse como prosa libre porque
// el detector regex evasivo del agente las confundía con frases prohibidas.
// Modelarlos con `code` enumerado + texto literal LES da estatus de primera
// clase: el detector las exonera por contrato (viven en campo dedicado, no
// en `body` libre).

export const DisclaimerSchema = z.object({
  code: z.enum([
    'laboral_sin_detalle',
    'costo_insuficiente',
    'impuesto_no_reconciliable',
    'sin_comparativo',
    'ajuste_3605',
    'inversiones_negativas',
  ]),
  texto: z.string().min(1).describe('Texto literal del disclaimer (Parte 9 spec v2.0)'),
  trigger: z.string().min(1).describe('Condición observada que activa el disclaimer'),
});

export type DisclaimerJson = z.infer<typeof DisclaimerSchema>;

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
  // Why: Art. 424 C.Co. — sin verificación de convocatoria documentada, la
  // asamblea es impugnable por defecto de convocatoria. Schema estructurado
  // obliga al LLM a declarar modalidad + antelación, sin lo cual el acta no
  // tiene valor probatorio.
  convocationStatement: z.string().min(1).describe('Declaración LITERAL de verificación de convocatoria (Art. 424 C.Co.) — modalidad y antelación con que se citó'),
  quorumStatement: z.string().min(1).describe('Afirmación de quorum — sin porcentajes inventados'),
  // Why: orden del día canónico Art. 187 Ley 222/1995 — 8 puntos mínimos
  // incluyendo gestión administradores (§3), designación cargos (§4) y
  // verificación convocatoria (Art. 424 C.Co.). El min anterior (5) permitía
  // omitir puntos legalmente obligatorios.
  agenda: z.array(AgendaItemSchema).min(8).describe('Orden del día — mínimo 8 puntos canónicos (Art. 187 Ley 222/1995): convocatoria, quorum, aprobación EEFF, informe gestión, aprobación gestión administradores §3, distribución/reservas, designación cargos §4, varios+cierre'),
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
   * Echo del modo en que se procesó el reporte (v8.1 §1.5 / §2).
   * Recibe el valor derivado por `deriveReportMode()` en el preprocessor y lo
   * devuelve intacto — el renderer downstream lo usa para anclar el tono
   * narrativo del documento (verbos LINEA_BASE vs COMPARATIVO_COMPLETO).
   * Governance NO lo deriva: lo recibe del orchestrator como input vinculante.
   */
  reportMode: ReportModeSchema,
  /**
   * Firmantes estructurados. Espejo de `CompanyInfo.signatories` — el agente
   * los repite para que el renderer Markdown pueda armar el bloque de firmas
   * sin re-leer `company`.
   */
  signatories: SignatoriesSchema.nullable(),
  // -- DOCUMENTO 1: Notas a los Estados Financieros ------------------------
  financialNotes: z.array(FinancialNoteSchema).min(1).describe('Notas 1..16 — material/immaterial/omitted'),
  // -- DOCUMENTO 2: Acta de Asamblea ---------------------------------------
  shareholderMinutes: ShareholderMinutesSchema,
  // -- DOCUMENTO 3: Checklist de Cumplimiento Normativo (Parte III §3) -----
  // Why: el spec exige checklist tipado al cierre del documento de Gobierno.
  // Mínimo 8 ítems para garantizar coverage de las áreas críticas (NIIF,
  // distribución utilidades, reserva legal, RF, libros, IGS, partes
  // vinculadas, autorización publicación).
  complianceChecklist: z.array(ComplianceChecklistItemSchema).min(8).describe('Checklist de cumplimiento normativo (Parte III §3 spec v2.0) — mínimo 8 ítems'),
  // -- DOCUMENTO 4: Disclaimers automáticos (Parte 9) ----------------------
  // Why: 6 disclaimers literales del spec viven aquí como entidades tipadas
  // con `code` enumerado para que el detector regex evasivo los exonere.
  // Array puede ser vacío si ninguna condición aplica.
  disclaimers: z.array(DisclaimerSchema).describe('Disclaimers automáticos (Parte 9 spec v2.0) — vacío si ninguna condición aplica'),
  // -- Notas del preparador (datos faltantes) ------------------------------
  preparerNotes: z.array(StatementNoteSchema),
});

export type GovernanceReportJson = z.infer<typeof GovernanceReportSchema>;

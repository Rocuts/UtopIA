import { z } from 'zod';

/**
 * Tamaño maximo (en caracteres) que se acepta para texto crudo de balance/
 * documentos contables en los endpoints financieros. Se eleva a 500K para
 * absorber balances multiperiodo (varias hojas Excel concatenadas con
 * etiquetas `[period=YYYY]`). Cualquier schema que valide longitud de
 * texto crudo (rawData, financialData, projectData, documentContext) lo
 * importa de aqui.
 */
export const DOCUMENT_MAX_CHARS = 500_000;

// ---- Chat route ----
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(10_000, 'Message content too long'),
});

export const chatRequestSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1, 'At least one message required')
    .max(50, 'Too many messages in conversation'),
  language: z.enum(['es', 'en']).default('es'),
  useCase: z
    .enum([
      'dian-defense',
      'tax-refund',
      'due-diligence',
      'financial-intelligence',
      'financial-report',
      'tax-planning',
      'transfer-pricing',
      'business-valuation',
      'fiscal-audit-opinion',
      'tax-reconciliation',
      'feasibility-study',
      'general',
      '',
    ])
    .default(''),
  /** Optional full document text passed from the upload flow for direct analysis. */
  documentContext: z.string().max(DOCUMENT_MAX_CHARS).optional(),
  /** ERP provider names the user has connected — credentials are looked up server-side. */
  erpProviders: z.array(z.string().min(1).max(64)).max(20).optional(),
});

// ---- RAG route ----
export const ragRequestSchema = z.object({
  query: z.string().min(1, 'Query is required').max(2_000, 'Query too long'),
});

// ---- Web search route ----
export const webSearchRequestSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1_000, 'Query too long'),
});

// ---- Tax calendar route ----
export const taxCalendarRequestSchema = z.object({
  nitLastDigit: z.number().int().min(0).max(9),
  year: z.number().int().min(2020).max(2099),
  taxpayerType: z.enum(['persona_juridica', 'persona_natural', 'gran_contribuyente']),
  city: z.string().min(1).max(120).optional(),
});

// ---- Sanction calculator route ----
export const sanctionRequestSchema = z.object({
  type: z.enum(['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios']),
  taxDue: z.number().nonnegative().optional(),
  grossIncome: z.number().nonnegative().optional(),
  difference: z.number().nonnegative().optional(),
  delayMonths: z.number().int().nonnegative().max(240).optional(),
  /** Sólo para correccion: voluntaria (10%) vs provocada (20%). */
  isVoluntary: z.boolean().optional(),
  /** Sólo para inexactitud: reducciones Arts. 640 y 709 ET. */
  inexactitudReduction: z.enum(['none', 'art_709_half', 'art_709_quarter', 'art_640_50', 'art_640_75']).optional(),
  principal: z.number().nonnegative().optional(),
  /** Tasa efectiva anual (%): tasa de usura vigente - 2 pp. Art. 635 ET. */
  annualRate: z.number().min(0).max(100).optional(),
  days: z.number().int().nonnegative().max(3_650).optional(),
});

// ---- Upload route (metadata only, file validated separately) ----
export const uploadContextSchema = z
  .string()
  .max(200, 'Context label too long')
  .transform((val) => val.replace(/[<>"'`;]/g, ''));

// ---- Allowed upload extensions ----
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.pdf',
  '.xlsx', '.xls',
  '.doc', '.docx',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.heic',
]);

// Con Vercel Blob el archivo sube DIRECTO al store via `@vercel/blob/client`
// `upload()` — el body de la Function nunca recibe el binario, asi que el
// limite de plataforma de 4.5MB ya no aplica. 100MB es el tope de producto.
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

// ---- Blob upload route (body JSON de POST /api/upload, camino Vercel Blob) ----
// Este schema NO viaja al LLM — la regla strict-mode 2026 no aplica.
// Sigue el estilo del resto del archivo: `.optional()` para campos no obligatorios.
export const blobUploadSchema = z.object({
  /** URL del blob ya subido a Vercel Blob — validada contra host *.vercel-storage.com. */
  blobUrl: z.string().url('blobUrl debe ser una URL valida'),
  /** Etiqueta de contexto opcional (origen del documento). */
  context: z.string().max(200).optional(),
  /** Nombre original del archivo; si falta se deriva del pathname del blob. */
  filename: z.string().max(300).optional(),
});

// ---- Financial report route ----
export const companyInfoSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  nit: z.string().min(1, 'NIT is required').max(20),
  entityType: z.string().max(50).optional(),
  sector: z.string().max(100).optional(),
  niifGroup: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  fiscalPeriod: z.string().min(1, 'Fiscal period is required').max(20),
  comparativePeriod: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  legalRepresentative: z.string().max(200).optional(),
  /** ITEM 5 ORDEN DE CIERRE — C.C. del Representante Legal (sin DV). */
  legalRepresentativeId: z.string().max(30).optional(),
  fiscalAuditor: z.string().max(200).optional(),
  /** ITEM 5 ORDEN DE CIERRE — T.P. del Revisor Fiscal (formato '12345-T'). */
  fiscalAuditorTp: z.string().max(20).optional(),
  accountant: z.string().max(200).optional(),
  /** ITEM 5 ORDEN DE CIERRE — T.P. del Contador Público (formato '12345-T'). */
  accountantTp: z.string().max(20).optional(),
  /** Períodos detectados en el archivo subido (e.g. ["2024","2025"]). */
  detectedPeriods: z.array(z.string().max(20)).max(10).optional(),
});

export const financialReportRequestSchema = z.object({
  rawData: z.string().min(1, 'Raw accounting data is required').max(DOCUMENT_MAX_CHARS, 'Data too large'),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
  /**
   * Periodos detectados en el archivo subido. Permite que el endpoint
   * de financial-report propague la lista al pipeline sin re-detectar.
   */
  detectedPeriods: z.array(z.string().max(20)).max(10).optional(),
});

// ---- Financial report split endpoints (Wave 3.F1) ----
// `/api/financial-report/strategy` and `/api/financial-report/governance` son
// stateless por diseño: el caller envia el output del agente anterior + los
// totales vinculantes pre-calculados. El shape de `niifResult` / `preprocessed`
// se valida con un `z.object({}).passthrough()` permisivo + cast en el handler
// (mismo patron que `financialAuditRequestSchema`) porque los schemas Zod
// recursivos completos de NiifAnalysisResult / PreprocessedBalance son
// prohibitivamente caros y la informacion de tipos vive en el codigo TS.

/**
 * Body para POST /api/financial-report/strategy. El caller envia el
 * `niifResult` ya generado por /niif, el bloque `bindingTotals` que /niif
 * pre-calculo, y opcionalmente el `preprocessed` completo (recomendado para
 * activar modo comparativo + elite context).
 */
export const strategyPhaseRequestSchema = z.object({
  niifResult: z.object({ fullContent: z.string().min(1) }).passthrough(),
  bindingTotals: z.string().min(1, 'bindingTotals (pre-calculados por phase 1) is required'),
  preprocessed: z.unknown().optional(),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

/**
 * Body para POST /api/financial-report/governance. Igual a strategy pero
 * incluye tambien el `strategyResult`.
 */
export const governancePhaseRequestSchema = z.object({
  niifResult: z.object({ fullContent: z.string().min(1) }).passthrough(),
  strategyResult: z.object({ fullContent: z.string().min(1) }).passthrough(),
  bindingTotals: z.string().min(1, 'bindingTotals (pre-calculados por phase 1) is required'),
  preprocessed: z.unknown().optional(),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

/**
 * Output format hint for `/api/financial-report/export`.
 *
 * - `excel` (default, legacy) — multi-tab .xlsx via ExcelJS.
 * - `pdf` (deprecated) — legacy jsPDF dump.
 * - `pdf-elite` — editorial PDF rendered via `@react-pdf/renderer`.
 */
export const exportFormatSchema = z.enum(['excel', 'pdf', 'pdf-elite']).default('excel');

/**
 * Extended financial-report request that adds the `format` field. Used by the
 * export route to dispatch between Excel / legacy PDF / editorial PDF.
 */
export const financialExportRequestSchema = financialReportRequestSchema.extend({
  format: exportFormatSchema,
});

// ---- Tax planning route ----
export const taxPlanningRequestSchema = z.object({
  rawData: z.string().min(1, 'Financial data is required').max(DOCUMENT_MAX_CHARS, 'Data too large'),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
  currentRegime: z
    .enum(['ordinario', 'simple', 'zona_franca', 'zomac', 'economia_naranja'])
    .optional(),
  grossRevenue: z.number().nonnegative().optional(),
  employeeCount: z.number().int().nonnegative().optional(),
});

// ---- Business valuation route ----
export const businessValuationRequestSchema = z.object({
  financialData: z.string().min(1, 'Financial data is required').max(DOCUMENT_MAX_CHARS, 'Data too large'),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
  purpose: z.string().max(500).optional(),
});

// ---- Transfer pricing route ----
export const transferPricingPartySchema = z.object({
  name: z.string().min(1).max(200),
  taxId: z.string().min(1).max(30),
  jurisdiction: z.string().min(1).max(100),
  relationshipType: z.string().max(200).optional(),
  isTaxHaven: z.boolean().optional(),
});

export const controlledTransactionSchema = z.object({
  description: z.string().min(1).max(500),
  type: z.enum(['bienes', 'servicios', 'intangibles', 'financieras', 'otros']),
  amount: z.number().nonnegative(),
  relatedParty: z.string().min(1).max(200),
  direction: z.enum(['importacion', 'exportacion']),
});

export const transferPricingRequestSchema = z.object({
  rawData: z.string().min(1, 'Intercompany transaction data is required').max(DOCUMENT_MAX_CHARS, 'Data too large'),
  company: companyInfoSchema,
  relatedParties: z.array(transferPricingPartySchema).max(50).optional(),
  controlledTransactions: z.array(controlledTransactionSchema).max(100).optional(),
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

// ---- Tax reconciliation route ----
export const taxReconciliationRequestSchema = z.object({
  rawData: z.string().min(1, 'Raw accounting data is required').max(DOCUMENT_MAX_CHARS, 'Data too large'),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

// ---- Feasibility study route ----
export const projectInfoSchema = z.object({
  projectName: z.string().min(1, 'Project name is required').max(200),
  description: z.string().min(1, 'Project description is required').max(5_000),
  sector: z.string().min(1, 'Sector is required').max(100),
  ciiu: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  estimatedInvestment: z.number().nonnegative().optional(),
  evaluationHorizon: z.number().int().min(1).max(30).optional(),
  companySize: z.enum(['micro', 'pequena', 'mediana', 'grande']).optional(),
  promoterName: z.string().max(200).optional(),
  nit: z.string().max(20).optional(),
  isZomac: z.boolean().optional(),
  isZonaFranca: z.boolean().optional(),
  isEconomiaNaranja: z.boolean().optional(),
});

export const feasibilityStudyRequestSchema = z.object({
  projectData: z.string().min(1, 'Project description is required').max(DOCUMENT_MAX_CHARS, 'Data too large'),
  project: projectInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

// ---- Financial audit route ----
export const financialAuditRequestSchema = z.object({
  report: z.object({
    company: companyInfoSchema,
    niifAnalysis: z.object({ fullContent: z.string() }),
    strategicAnalysis: z.object({ fullContent: z.string() }),
    governance: z.object({ fullContent: z.string() }),
    consolidatedReport: z.string().min(1, 'Consolidated report is required'),
    generatedAt: z.string(),
  }),
  language: z.enum(['es', 'en']).default('es'),
  auditFocus: z.string().max(2_000).optional(),
});

// ---- Fiscal audit opinion (Dictamen del Revisor Fiscal) route ----
export const fiscalAuditOpinionRequestSchema = z.object({
  report: z.object({
    company: companyInfoSchema,
    niifAnalysis: z.object({ fullContent: z.string() }),
    strategicAnalysis: z.object({ fullContent: z.string() }),
    governance: z.object({ fullContent: z.string() }),
    consolidatedReport: z.string().min(1, 'Consolidated report is required'),
    generatedAt: z.string(),
  }),
  auditReport: z.object({
    consolidatedReport: z.string(),
    overallScore: z.number(),
    opinionType: z.string(),
  }).optional(),
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

// ---- Escudo Survival (Modo Supervivencia Elite) route ----
export const escudoSurvivalRequestSchema = z.object({
  rawData: z.string().min(1, 'Financial data is required').max(2_000_000, 'Data too large'),
  company: z
    .object({
      name: z.string().optional(),
      nit: z.string().optional(),
      sector: z.string().optional(),
      ciiu: z.string().optional(),
    })
    .optional(),
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(5_000).optional(),
});

// ---- Escudo Capa 4 — Agente Fiscal route ----
// Schema del request a `/api/escudo/fiscal`. NO viaja al LLM (es validación
// del transporte HTTP) — por eso puede usar `.optional()` y `.default()`.
// Los schemas que sí viajan al LLM viven en
// `src/lib/agents/financial/escudo-survival/fiscal-agent/schemas.ts` y
// siguen el strict mode (`.nullable()`).
export const fiscalAgentRequestSchema = z.object({
  rawData: z
    .string()
    .min(1, 'Financial data is required')
    .max(2_000_000, 'Data too large'),
  company: z
    .object({
      name: z.string().max(200).optional(),
      nit: z.string().max(20).optional(),
      sector: z.string().max(100).optional(),
      ciiu: z.string().max(10).optional(),
    })
    .optional(),
  language: z.enum(['es', 'en']).default('es'),
  mode: z
    .enum(['quick', 'full', 'supervivencia', 'defensa_dian', 'devolucion'])
    .default('full'),
  instructions: z.string().max(5_000).optional(),
  /** Módulo 5 — texto del requerimiento DIAN. */
  dianRequirementText: z.string().max(20_000).optional(),
  /** Módulo 5 — tipo de requerimiento si el caller ya lo conoce. */
  dianRequirementKind: z
    .enum([
      'requerimiento_ordinario',
      'emplazamiento_corregir',
      'emplazamiento_no_declarar',
      'pliego_cargos',
      'liquidacion_oficial_revision',
      'desconocido',
    ])
    .optional(),
});

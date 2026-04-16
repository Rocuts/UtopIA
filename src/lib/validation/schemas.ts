import { z } from 'zod';

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
    .enum(['dian-defense', 'tax-refund', 'due-diligence', 'financial-intelligence', 'financial-report', ''])
    .default(''),
  /** Optional full document text passed from the upload flow for direct analysis. */
  documentContext: z.string().max(100_000).optional(),
  /** Connected ERP integrations — provider + credentials only (no UI metadata). */
  erpConnections: z.array(z.object({
    provider: z.string(),
    credentials: z.record(z.string(), z.string()),
  })).optional(),
});

// ---- RAG route ----
export const ragRequestSchema = z.object({
  query: z.string().min(1, 'Query is required').max(2_000, 'Query too long'),
});

// ---- Web search route ----
export const webSearchRequestSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1_000, 'Query too long'),
});

// ---- Sanction calculator route ----
export const sanctionRequestSchema = z.object({
  type: z.enum(['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios']),
  taxDue: z.number().nonnegative().optional(),
  grossIncome: z.number().nonnegative().optional(),
  difference: z.number().nonnegative().optional(),
  delayMonths: z.number().int().nonnegative().max(240).optional(),
  isVoluntary: z.boolean().optional(),
  principal: z.number().nonnegative().optional(),
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

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB

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
  fiscalAuditor: z.string().max(200).optional(),
  accountant: z.string().max(200).optional(),
});

export const financialReportRequestSchema = z.object({
  rawData: z.string().min(1, 'Raw accounting data is required').max(200_000, 'Data too large'),
  company: companyInfoSchema,
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

// ---- Tax planning route ----
export const taxPlanningRequestSchema = z.object({
  rawData: z.string().min(1, 'Financial data is required').max(200_000, 'Data too large'),
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
  financialData: z.string().min(1, 'Financial data is required').max(200_000, 'Data too large'),
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
  rawData: z.string().min(1, 'Intercompany transaction data is required').max(200_000, 'Data too large'),
  company: companyInfoSchema,
  relatedParties: z.array(transferPricingPartySchema).max(50).optional(),
  controlledTransactions: z.array(controlledTransactionSchema).max(100).optional(),
  language: z.enum(['es', 'en']).default('es'),
  instructions: z.string().max(2_000).optional(),
});

// ---- Tax reconciliation route ----
export const taxReconciliationRequestSchema = z.object({
  rawData: z.string().min(1, 'Raw accounting data is required').max(200_000, 'Data too large'),
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
  projectData: z.string().min(1, 'Project description is required').max(200_000, 'Data too large'),
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

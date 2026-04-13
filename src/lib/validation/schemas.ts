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
    .enum(['dian-defense', 'tax-refund', 'due-diligence', 'financial-intelligence', ''])
    .default(''),
  /** Optional full document text passed from the upload flow for direct analysis. */
  documentContext: z.string().max(100_000).optional(),
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

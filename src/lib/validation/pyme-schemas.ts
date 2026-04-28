import { z } from 'zod';

// ---------------------------------------------------------------------------
// Validacion del modulo "Contabilidad Pyme".
// ---------------------------------------------------------------------------
// Schemas Zod consumidos por las route handlers en `src/app/api/pyme/*`.
// Forma exacta del §2 AGENT-API del spec.
// `z.coerce.number()` se usa en query params (URLSearchParams.get devuelve
// string, asi se convierte y valida en una sola pasada).
// ---------------------------------------------------------------------------

// ─── Books ──────────────────────────────────────────────────────────────────

export const createBookBodySchema = z.object({
  name: z.string().min(1).max(120),
  // Normalizamos a mayusculas para que `cop`, `Cop`, `COP` sean equivalentes
  // (ISO 4217 declara codigos en mayusculas; aceptar variantes previene errores
  // de input UI sin perder validacion de longitud exacta).
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toUpperCase())
    .default('COP'),
});

// ─── Entries ────────────────────────────────────────────────────────────────

export const listEntriesQuerySchema = z.object({
  bookId: z.string().uuid(),
  status: z.enum(['draft', 'confirmed']).optional(),
  kind: z.enum(['ingreso', 'egreso']).optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createEntryBodySchema = z.object({
  bookId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  kind: z.enum(['ingreso', 'egreso']),
  amount: z.number().positive(),
  category: z.string().max(120).optional(),
  pucHint: z.string().max(20).optional(),
  status: z.enum(['draft', 'confirmed']).default('confirmed'),
});

// PATCH no requiere ningun campo, omite bookId (un entry no se mueve de libro).
//
// IMPORTANTE: NO derivamos de `createEntryBodySchema.partial()` porque el
// `default('confirmed')` del status base se preserva tras `.partial()`, lo
// que provoca auto-confirmacion silenciosa de drafts cuando un PATCH parcial
// no envia status. Construimos el schema explicito sin defaults.
export const patchEntryBodySchema = z.object({
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  description: z.string().min(1).max(500).optional(),
  kind: z.enum(['ingreso', 'egreso']).optional(),
  amount: z.number().positive().optional(),
  category: z.string().max(120).optional(),
  pucHint: z.string().max(20).optional(),
  status: z.enum(['draft', 'confirmed']).optional(),
});

// ─── Reports ────────────────────────────────────────────────────────────────

export const monthlyReportBodySchema = z.object({
  bookId: z.string().uuid(),
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
  language: z.enum(['es', 'en']).default('es'),
});

// ─── Tipos derivados ────────────────────────────────────────────────────────

export type CreateBookBody = z.infer<typeof createBookBodySchema>;
export type ListEntriesQuery = z.infer<typeof listEntriesQuerySchema>;
export type CreateEntryBody = z.infer<typeof createEntryBodySchema>;
export type PatchEntryBody = z.infer<typeof patchEntryBodySchema>;
export type MonthlyReportBody = z.infer<typeof monthlyReportBodySchema>;

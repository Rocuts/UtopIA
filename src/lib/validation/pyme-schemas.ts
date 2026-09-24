import { z } from 'zod';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

/** Salario integral mínimo — CST art. 132 (10 SMMLV + 30 % factor prestacional). */
const SALARIO_INTEGRAL_MIN = 13 * SMMLV_2026;

/**
 * Reglas de salario del empleado (auditoría contab-nomina-19): jornada
 * completa ≥ SMMLV (el módulo no modela tiempo parcial) y salario integral
 * ≥ 13 SMMLV sólo para empleados. Se reutiliza en POST y en el PATCH ya
 * combinado con el registro existente.
 */
export function empleadoSalaryIssues(e: {
  tipo: string;
  salarioCop: number;
  salarioIntegral?: boolean | null;
}): string[] {
  const issues: string[] = [];
  if (e.tipo === 'empleado' && e.salarioCop < SMMLV_2026) {
    issues.push(
      `El salario mensual de un empleado de jornada completa no puede ser inferior al SMMLV (${SMMLV_2026}); tiempo parcial no soportado.`,
    );
  }
  if (e.salarioIntegral) {
    if (e.tipo !== 'empleado') issues.push('El salario integral sólo aplica a empleados.');
    if (e.salarioCop < SALARIO_INTEGRAL_MIN) {
      issues.push(`El salario integral no puede ser inferior a 13 SMMLV (${SALARIO_INTEGRAL_MIN}).`);
    }
  }
  return issues;
}

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

// ─── Empleados (nómina simple — Ola 8) ──────────────────────────────────────

export const createEmpleadoBodySchema = z
  .object({
    nombre: z.string().min(1).max(160),
    tipo: z.enum(['empleado', 'dueno']).default('empleado'),
    cargo: z.string().max(120).optional(),
    tipoContrato: z.enum(['fijo', 'indefinido', 'obra_labor']).optional(),
    /** Salario mensual (empleado) o ingreso mensual estimado (dueño), COP. */
    salarioCop: z.number().positive().max(1_000_000_000),
    /** Salario integral (CST art. 132). */
    salarioIntegral: z.boolean().default(false),
    eps: z.string().max(120).optional(),
    afp: z.string().max(120).optional(),
    arl: z.string().max(120).optional(),
    arlClase: z.number().int().min(1).max(5).default(1),
  })
  .superRefine((v, ctx) => {
    for (const message of empleadoSalaryIssues(v)) {
      ctx.addIssue({ code: 'custom', path: ['salarioCop'], message });
    }
  });

// PATCH explícito sin defaults (mismo razonamiento que updateEntryBodySchema:
// .partial() preservaría los .default() y sobre-escribiría campos no enviados).
export const updateEmpleadoBodySchema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  tipo: z.enum(['empleado', 'dueno']).optional(),
  cargo: z.string().max(120).nullable().optional(),
  tipoContrato: z.enum(['fijo', 'indefinido', 'obra_labor']).nullable().optional(),
  salarioCop: z.number().positive().max(1_000_000_000).optional(),
  salarioIntegral: z.boolean().optional(),
  eps: z.string().max(120).nullable().optional(),
  afp: z.string().max(120).nullable().optional(),
  arl: z.string().max(120).nullable().optional(),
  arlClase: z.number().int().min(1).max(5).optional(),
});

// ─── Calculadora RST/Ordinario (historial — Ola 8) ──────────────────────────

export const saveTaxCalculationBodySchema = z.object({
  annualSalesCop: z.number().positive().max(1_000_000_000_000),
  rstGroup: z.enum(['tiendas', 'servicios']),
  rstCop: z.number().nonnegative(),
  ordinarioCop: z.number().nonnegative(),
  recommended: z.enum(['RST', 'Ordinario']),
  savingsCop: z.number().nonnegative(),
  semaforoLevel: z.enum(['verde', 'amarillo', 'rojo']),
});

// ─── Summary ────────────────────────────────────────────────────────────────

export const summaryQuerySchema = z.object({
  bookId: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2035),
  month: z.coerce.number().int().min(1).max(12),
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

// ─── Bulk operations ────────────────────────────────────────────────────────

export const bulkConfirmBodySchema = z.object({
  bookId: z.string().uuid(),
  // Restringe la confirmación a los drafts de UN upload (flujo PhotoUploader).
  // Sin uploadId se confirman todos los drafts del libro (flujo EntryReview).
  uploadId: z.string().uuid().optional(),
});

// ─── Tipos derivados ────────────────────────────────────────────────────────

export type CreateBookBody = z.infer<typeof createBookBodySchema>;
export type ListEntriesQuery = z.infer<typeof listEntriesQuerySchema>;
export type CreateEntryBody = z.infer<typeof createEntryBodySchema>;
export type PatchEntryBody = z.infer<typeof patchEntryBodySchema>;
export type MonthlyReportBody = z.infer<typeof monthlyReportBodySchema>;
export type BulkConfirmBody = z.infer<typeof bulkConfirmBodySchema>;

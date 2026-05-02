// ---------------------------------------------------------------------------
// Zod schemas for /api/accounting/* route handlers.
//
// Decisions:
// - Monetary fields are strings (not numbers). The double-entry validator
//   parses them as BigInt-on-centavos. Allowing `number` here would invite
//   precision loss the moment someone sends 1234567.89 (which JSON sometimes
//   serializes as 1234567.8900000001).
// - We deliberately accept "0" or "0.00" for the inactive side of a line; the
//   service-level validator enforces "exactly one side > 0" with a clearer
//   error message than Zod can produce.
// - UUIDs validated with `z.string().uuid()`.
// - Dates accepted as ISO strings; transformed to Date for the service.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// Match: optional sign-free decimal "0", "0.00", "1234.56", ".5", etc.
// We forbid scientific notation and signs at the schema layer; the
// validator double-checks at the service layer.
const NUMERIC_RE = /^\d+(\.\d{1,8})?$|^\.\d{1,8}$/;
const UNSIGNED_NUMERIC = z
  .string()
  .min(1, 'amount required')
  .max(28, 'amount too long')
  .regex(NUMERIC_RE, 'amount must be a non-negative decimal');

const EXCHANGE_RATE = z
  .string()
  .regex(NUMERIC_RE, 'exchange rate must be a non-negative decimal')
  .max(28)
  .optional();

// ---------------------------------------------------------------------------
// Journal entry — line + create + post + reverse
// ---------------------------------------------------------------------------

export const journalLineInputSchema = z.object({
  accountId: z.string().uuid(),
  thirdPartyId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  debit: UNSIGNED_NUMERIC,
  credit: UNSIGNED_NUMERIC,
  currency: z
    .string()
    .length(3)
    .default('COP')
    .optional(),
  exchangeRate: EXCHANGE_RATE,
  description: z.string().max(500).nullable().optional(),
  dimensions: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const sourceTypeSchema = z.enum([
  'manual',
  'import',
  'invoice',
  'payment',
  'depreciation',
  'adjustment',
  'closing',
  'reversal',
  'ai_generated',
  'opening',
]);

export const createEntryBodySchema = z.object({
  periodId: z.string().uuid(),
  entryDate: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'entryDate invalid'),
  description: z.string().min(1).max(2_000),
  sourceType: sourceTypeSchema.optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceRef: z.string().max(200).nullable().optional(),
  status: z.enum(['draft', 'posted']).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  lines: z
    .array(journalLineInputSchema)
    .min(2, 'Asiento requiere al menos 2 lineas')
    .max(500, 'Demasiadas lineas en un solo asiento'),
});

export const postEntryBodySchema = z.object({
  entryId: z.string().uuid(),
});

export const reverseEntryBodySchema = z.object({
  originalEntryId: z.string().uuid(),
  reason: z.string().min(1).max(2_000),
  entryDate: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'entryDate invalid')
    .optional(),
});

export const voidDraftBodySchema = z.object({
  entryId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Period schemas
// ---------------------------------------------------------------------------

export const createPeriodBodySchema = z
  .object({
    year: z.number().int().min(2000).max(2099),
    month: z.number().int().min(1).max(13),
    // Optional explicit boundaries — if absent, computed from year/month.
    startsAt: z
      .string()
      .min(1)
      .refine((s) => !Number.isNaN(Date.parse(s)), 'startsAt invalid')
      .optional(),
    endsAt: z
      .string()
      .min(1)
      .refine((s) => !Number.isNaN(Date.parse(s)), 'endsAt invalid')
      .optional(),
  })
  .refine(
    (v) => {
      // If both are provided, ensure ordering.
      if (v.startsAt && v.endsAt) return Date.parse(v.startsAt) <= Date.parse(v.endsAt);
      return true;
    },
    { message: 'startsAt must be <= endsAt' },
  );

export const periodActionBodySchema = z.object({
  periodId: z.string().uuid(),
});

export const listEntriesQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  status: z.enum(['draft', 'posted', 'reversed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Chart of Accounts (PUC) — schemas para /api/accounting/accounts.
// ---------------------------------------------------------------------------
//
// Decisiones:
// - `code` es string de 1..16 dígitos (varchar(16) en DB). Numeric regex
//   para coincidir con la regla de `mutations.assertCodeFormat`.
// - `parentCode` puede ser null/undefined (clase raíz) o string numérico.
// - `type` debe coincidir con la clase del primer dígito; la coherencia se
//   reverifica en el servicio (errores con field-level info).
// - PATCH (`updateAccountBodySchema`) NO permite cambiar `code`, `type`,
//   `parentCode` ni `level` — eso rompería integridad jerárquica. Esos
//   campos requieren delete + recreate.
// - Booleans `isPostable`, `requiresThirdParty`, `requiresCostCenter`,
//   `active` son opcionales y conservan los defaults del schema DB.
// ---------------------------------------------------------------------------

const ACCOUNT_CODE_RE = /^\d{1,16}$/;

const accountCodeSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(ACCOUNT_CODE_RE, 'code must be 1-16 digits');

const accountTypeEnumSchema = z.enum([
  'ACTIVO',
  'PASIVO',
  'PATRIMONIO',
  'INGRESO',
  'GASTO',
  'COSTO',
  'ORDEN_DEUDORA',
  'ORDEN_ACREEDORA',
]);

export const createAccountBodySchema = z.object({
  code: accountCodeSchema,
  name: z.string().min(1).max(200),
  parentCode: accountCodeSchema.nullable().optional(),
  type: accountTypeEnumSchema,
  isPostable: z.boolean().optional(),
  requiresThirdParty: z.boolean().optional(),
  requiresCostCenter: z.boolean().optional(),
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toUpperCase())
    .optional(),
});

export const updateAccountBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    requiresThirdParty: z.boolean().optional(),
    requiresCostCenter: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.requiresThirdParty !== undefined ||
      v.requiresCostCenter !== undefined ||
      v.active !== undefined,
    { message: 'patch must change at least one field' },
  );

export const listAccountsQuerySchema = z.object({
  /** `1` ⇒ árbol jerárquico; default: lista plana. */
  tree: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  /** `1` ⇒ solo `is_postable=true` (auxiliares). */
  postable: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  /** Filtra por tipo NIIF. */
  type: accountTypeEnumSchema.optional(),
  /** Búsqueda por código (prefix) o nombre (ilike). */
  search: z.string().min(1).max(120).optional(),
  /** `0` ⇒ incluye desactivadas. Default: solo activas. */
  active: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

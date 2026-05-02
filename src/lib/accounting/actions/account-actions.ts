'use server';
// ---------------------------------------------------------------------------
// Server Actions — Plan Único de Cuentas / PUC (Ola 1.F)
// ---------------------------------------------------------------------------
// Wrap los servicios de `@/lib/accounting/chart-of-accounts/mutations` para
// uso desde Client Components (formularios del Catalogo de Cuentas, wizard
// de inicializacion, ABM de auxiliares). Cada accion:
//
//   1. Deriva `workspaceId` del cookie (NUNCA del input).
//   2. Valida el input con Zod.
//   3. Llama al servicio puro (createAccount / updateAccount / deactivate
//      Account / seedPucForWorkspace).
//   4. Emite `updateTag(\`puc:${workspaceId}\`)` — invalida tanto el arbol
//      cacheado como las queries planas (autocomplete, filtros).
//
// Errores tipados de las mutaciones (`AccountValidationError`,
// `AccountConflictError`, `AccountNotFoundError`) se mapean a codigos
// serializables: VALIDATION (400-equivalente), CONFLICT (409), NOT_FOUND (404).
// ---------------------------------------------------------------------------

import { updateTag } from 'next/cache';
import { z } from 'zod';

import {
  AccountConflictError,
  AccountNotFoundError,
  AccountValidationError,
  createAccount,
  deactivateAccount,
  seedPucForWorkspace,
  updateAccount,
  type CreateAccountInput,
  type UpdateAccountInput,
  type SeedPucResult,
} from '@/lib/accounting/chart-of-accounts/mutations';
import type { ChartOfAccountsRow } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ACCOUNT_TYPE = z.enum([
  'ACTIVO',
  'PASIVO',
  'PATRIMONIO',
  'INGRESO',
  'GASTO',
  'COSTO',
  'ORDEN_DEUDORA',
  'ORDEN_ACREEDORA',
]);

const createAccountSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(16)
    .regex(/^\d+$/, 'code debe ser numerico'),
  name: z.string().min(1).max(200),
  parentCode: z
    .string()
    .max(16)
    .regex(/^\d+$/, 'parentCode debe ser numerico')
    .nullable()
    .optional(),
  type: ACCOUNT_TYPE,
  isPostable: z.boolean().optional(),
  requiresThirdParty: z.boolean().optional(),
  requiresCostCenter: z.boolean().optional(),
  currency: z.string().length(3).optional(),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  requiresThirdParty: z.boolean().optional(),
  requiresCostCenter: z.boolean().optional(),
  active: z.boolean().optional(),
});

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AccountActionError = {
  ok: false;
  code: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL';
  message: string;
  /** Campo del input que fallo (cuando viene de AccountValidationError). */
  field?: string;
  issues?: Array<{ path: string; message: string }>;
};

export type CreateAccountResult =
  | { ok: true; account: ChartOfAccountsRow }
  | AccountActionError;

export type UpdateAccountResult =
  | { ok: true; account: ChartOfAccountsRow }
  | AccountActionError;

export type DeactivateAccountResult =
  | { ok: true; account: ChartOfAccountsRow }
  | AccountActionError;

export type SeedPucActionResult =
  | { ok: true; result: SeedPucResult }
  | AccountActionError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodToActionError(error: z.ZodError): AccountActionError {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    message: 'Datos de la cuenta invalidos.',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

function toSerializableError(err: unknown): AccountActionError {
  if (err instanceof AccountValidationError) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: err.message,
      field: err.field,
    };
  }
  if (err instanceof AccountConflictError) {
    return { ok: false, code: 'CONFLICT', message: err.message };
  }
  if (err instanceof AccountNotFoundError) {
    return { ok: false, code: 'NOT_FOUND', message: err.message };
  }
  // node-postgres SQLSTATE.
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code ?? '');
    if (code === '23505') {
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'Ya existe una cuenta con ese codigo en este workspace.',
      };
    }
  }
  console.error('[accounting/actions/account]', err);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Error interno al procesar la cuenta.',
  };
}

// ---------------------------------------------------------------------------
// createAccountAction
// ---------------------------------------------------------------------------

export async function createAccountAction(
  rawInput: unknown,
): Promise<CreateAccountResult> {
  const parsed = createAccountSchema.safeParse(rawInput);
  if (!parsed.success) return zodToActionError(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const input: CreateAccountInput = {
      workspaceId: ws.id,
      code: parsed.data.code,
      name: parsed.data.name,
      parentCode: parsed.data.parentCode ?? null,
      type: parsed.data.type,
      isPostable: parsed.data.isPostable,
      requiresThirdParty: parsed.data.requiresThirdParty,
      requiresCostCenter: parsed.data.requiresCostCenter,
      currency: parsed.data.currency,
    };
    const account = await createAccount(input);

    updateTag(`puc:${ws.id}`);

    return { ok: true, account };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// updateAccountAction
//
// `id` se valida como UUID. Si el patch incluye `active: false`, el servicio
// rechaza con AccountConflictError si la cuenta tiene movimientos.
// ---------------------------------------------------------------------------

export async function updateAccountAction(
  id: string,
  rawPatch: unknown,
): Promise<UpdateAccountResult> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'id debe ser un UUID valido.',
    };
  }
  const parsed = updateAccountSchema.safeParse(rawPatch);
  if (!parsed.success) return zodToActionError(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const patch: UpdateAccountInput = parsed.data;
    const account = await updateAccount(ws.id, idResult.data, patch);

    updateTag(`puc:${ws.id}`);

    return { ok: true, account };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// deactivateAccountAction (soft-delete)
// ---------------------------------------------------------------------------

export async function deactivateAccountAction(
  id: string,
): Promise<DeactivateAccountResult> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'id debe ser un UUID valido.',
    };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const account = await deactivateAccount(ws.id, idResult.data);

    updateTag(`puc:${ws.id}`);

    return { ok: true, account };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// seedPucAction
//
// Inicializa el PUC PYMES (Decreto 2706/2012 + 2420/2015 Anexo 2) para el
// workspace actual. Idempotente: ON CONFLICT DO NOTHING. Devuelve metricas
// (inserted/skipped/total) que la UI puede mostrar como "X cuentas creadas,
// Y ya existian".
// ---------------------------------------------------------------------------

export async function seedPucAction(): Promise<SeedPucActionResult> {
  try {
    const ws = await getOrCreateWorkspace();
    const result = await seedPucForWorkspace(ws.id);

    updateTag(`puc:${ws.id}`);

    return { ok: true, result };
  } catch (err) {
    return toSerializableError(err);
  }
}

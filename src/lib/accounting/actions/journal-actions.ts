'use server';
// ---------------------------------------------------------------------------
// Server Actions — Journal entries (Ola 1.F)
// ---------------------------------------------------------------------------
// Wrap los servicios `@/lib/accounting/double-entry` para que los Client
// Components (formularios) los invoquen via `useTransition` o `<form action>`
// sin pagar el costo de un Route Handler HTTP. Cada accion:
//
//   1. Deriva `workspaceId` del COOKIE (NUNCA del input — vector de IDOR).
//   2. Valida el input con Zod (mismo schema que /api/accounting/*).
//   3. Llama al servicio puro (createEntry / postEntry / reverseEntry / voidDraft).
//   4. Emite `updateTag(...)` por cada cache tag que el cambio invalida —
//      Next.js 16: `updateTag` (estable) garantiza "read-your-writes" en la
//      proxima request al mismo tag.
//   5. Devuelve un objeto serializable: { ok: true, ... } | { ok: false, code, message }.
//      NUNCA devuelve `Error` (no es serializable) ni stack traces.
//
// Cache tags emitidos:
//   - `libro-mayor:${workspaceId}:${periodId}`  -> ledger del periodo
//   - `asientos:${workspaceId}`                 -> lista global de asientos
//   - `asiento:${workspaceId}:${entryId}`       -> detalle de un asiento
//
// Dependencias:
//   - `next/cache.updateTag`: stable en Next 16. Valido SOLO en Server Actions
//     y Route Handlers; no en Server Components.
//   - `revalidatePath` queda disponible como fallback para casos sin tag pero
//     no se usa por defecto — preferimos tags por su read-your-writes garantizado.
//
// Limites: Server Actions tienen ~4.5MB de form data. Para uploads grandes
// (csv del balance de apertura) seguimos enviando al Route Handler dedicado
// (/api/accounting/opening-balance/upload).
// ---------------------------------------------------------------------------

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';

import {
  createEntry,
  postEntry,
  reverseEntry,
  voidDraft,
} from '@/lib/accounting/double-entry';
import {
  DoubleEntryError,
  type SourceType,
} from '@/lib/accounting/types';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

// ---------------------------------------------------------------------------
// Schemas (mirror de /lib/validation/accounting-schemas.ts pero independientes
// para que las actions sirvan como fuente de verdad cuando el caller es un
// Client Component que no tiene visibilidad sobre las route schemas).
// ---------------------------------------------------------------------------

const NUMERIC_RE = /^\d+(\.\d{1,8})?$|^\.\d{1,8}$/;
const UNSIGNED_NUMERIC = z
  .string()
  .min(1, 'amount required')
  .max(28, 'amount too long')
  .regex(NUMERIC_RE, 'amount must be a non-negative decimal');

const lineSchema = z.object({
  accountId: z.string().uuid(),
  thirdPartyId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  debit: UNSIGNED_NUMERIC,
  credit: UNSIGNED_NUMERIC,
  currency: z.string().length(3).default('COP').optional(),
  exchangeRate: z
    .string()
    .regex(NUMERIC_RE, 'exchange rate must be a non-negative decimal')
    .max(28)
    .optional(),
  description: z.string().max(500).nullable().optional(),
  dimensions: z.record(z.string(), z.unknown()).nullable().optional(),
});

const createEntrySchema = z.object({
  periodId: z.string().uuid(),
  entryDate: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'entryDate invalid'),
  description: z.string().min(1).max(2_000),
  sourceType: z
    .enum([
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
    ])
    .optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceRef: z.string().max(200).nullable().optional(),
  status: z.enum(['draft', 'posted']).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  lines: z
    .array(lineSchema)
    .min(2, 'Asiento requiere al menos 2 lineas')
    .max(500, 'Demasiadas lineas en un solo asiento'),
});

const reverseEntrySchema = z.object({
  originalEntryId: z.string().uuid(),
  reason: z.string().min(1).max(2_000),
  entryDate: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'entryDate invalid')
    .optional(),
});

// ---------------------------------------------------------------------------
// Types: shape serializable de cada action.
// ---------------------------------------------------------------------------

export type ActionError = {
  ok: false;
  code: string;
  message: string;
  /** Issues de Zod si el error vino de la validacion previa al servicio. */
  issues?: Array<{ path: string; message: string }>;
};

export type CreateJournalEntryResult =
  | { ok: true; entryId: string; entryNumber: number; status: 'draft' | 'posted' }
  | ActionError;

export type PostJournalEntryResult = { ok: true } | ActionError;

export type ReverseJournalEntryResult =
  | { ok: true; reversalEntryId: string; reversalEntryNumber: number }
  | ActionError;

export type VoidDraftEntryResult = { ok: true } | ActionError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSerializableError(err: unknown): ActionError {
  if (err instanceof DoubleEntryError) {
    return {
      ok: false,
      code: err.code,
      message: err.message,
    };
  }
  // node-postgres SQLSTATE: serialization conflict despues de retries.
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code ?? '');
    if (code === '40001' || code === '40P01') {
      return {
        ok: false,
        code: 'CONCURRENCY',
        message: 'Conflicto de concurrencia, reintenta',
      };
    }
    if (code === '23505') {
      return { ok: false, code: 'UNIQUE_VIOLATION', message: 'Registro duplicado' };
    }
    if (code === '23503') {
      return { ok: false, code: 'FK_VIOLATION', message: 'Referencia invalida' };
    }
  }
  // Fallback: log al server, devolver mensaje generico al cliente (no leakear stack).
  console.error('[accounting/actions/journal]', err);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Error interno al procesar el asiento.',
  };
}

function zodToActionError(error: z.ZodError): ActionError {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    message: 'Datos del asiento invalidos.',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

// ---------------------------------------------------------------------------
// createJournalEntryAction
//
// Crea un asiento (`status` = 'draft' por defecto). Si el caller pasa
// `status: 'posted'`, se postea en la misma TX (atomico). NO acepta
// `workspaceId` del input — siempre se deriva del cookie.
// ---------------------------------------------------------------------------

export async function createJournalEntryAction(
  rawInput: unknown,
): Promise<CreateJournalEntryResult> {
  const parsed = createEntrySchema.safeParse(rawInput);
  if (!parsed.success) return zodToActionError(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await createEntry({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      entryDate: new Date(parsed.data.entryDate),
      description: parsed.data.description,
      sourceType: parsed.data.sourceType as SourceType | undefined,
      sourceId: parsed.data.sourceId ?? null,
      sourceRef: parsed.data.sourceRef ?? null,
      status: parsed.data.status,
      metadata: parsed.data.metadata ?? null,
      lines: parsed.data.lines.map((l) => ({
        accountId: l.accountId,
        thirdPartyId: l.thirdPartyId ?? null,
        costCenterId: l.costCenterId ?? null,
        debit: l.debit,
        credit: l.credit,
        currency: l.currency,
        exchangeRate: l.exchangeRate,
        description: l.description ?? null,
        dimensions: l.dimensions ?? null,
      })),
    });

    // Cache invalidation. Si el asiento nacio posted, tambien invalida el
    // detalle (su tag concreto incluye el id ya conocido).
    updateTag(`asientos:${ws.id}`);
    updateTag(`libro-mayor:${ws.id}:${parsed.data.periodId}`);
    updateTag(`asiento:${ws.id}:${result.entry.id}`);

    return {
      ok: true,
      entryId: result.entry.id,
      entryNumber: result.entry.entryNumber,
      status: result.entry.status as 'draft' | 'posted',
    };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// postJournalEntryAction
//
// Flip draft -> posted. Inmutable a partir de aqui. Si el periodo se cerro
// entre el draft y el post, falla con PERIOD_NOT_OPEN.
// ---------------------------------------------------------------------------

export async function postJournalEntryAction(
  entryId: string,
): Promise<PostJournalEntryResult> {
  if (typeof entryId !== 'string' || entryId.length === 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'entryId requerido.',
    };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const result = await postEntry({ entryId, workspaceId: ws.id });

    updateTag(`asientos:${ws.id}`);
    updateTag(`asiento:${ws.id}:${entryId}`);
    updateTag(`libro-mayor:${ws.id}:${result.entry.periodId}`);

    return { ok: true };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// reverseJournalEntryAction
//
// Crea el asiento espejo (sourceType='reversal') y marca el original como
// 'reversed'. Ambos invalidan ledger y lista; la entrada original tambien
// recibe su tag puntual.
// ---------------------------------------------------------------------------

export async function reverseJournalEntryAction(
  rawInput: unknown,
): Promise<ReverseJournalEntryResult> {
  const parsed = reverseEntrySchema.safeParse(rawInput);
  if (!parsed.success) return zodToActionError(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await reverseEntry({
      originalEntryId: parsed.data.originalEntryId,
      workspaceId: ws.id,
      reason: parsed.data.reason,
      entryDate: parsed.data.entryDate
        ? new Date(parsed.data.entryDate)
        : new Date(),
    });

    updateTag(`asientos:${ws.id}`);
    updateTag(`asiento:${ws.id}:${parsed.data.originalEntryId}`);
    updateTag(`asiento:${ws.id}:${result.entry.id}`);
    updateTag(`libro-mayor:${ws.id}:${result.entry.periodId}`);

    return {
      ok: true,
      reversalEntryId: result.entry.id,
      reversalEntryNumber: result.entry.entryNumber,
    };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// voidDraftEntryAction
//
// Borrado fisico de un draft (lines se borran cascadeando manual). Imposible
// despues de postear — para eso se usa reverseJournalEntryAction.
// ---------------------------------------------------------------------------

export async function voidDraftEntryAction(
  entryId: string,
): Promise<VoidDraftEntryResult> {
  if (typeof entryId !== 'string' || entryId.length === 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'entryId requerido.',
    };
  }

  try {
    const ws = await getOrCreateWorkspace();
    await voidDraft({ entryId, workspaceId: ws.id });

    // No conocemos periodId del draft borrado sin cargarlo primero. El listado
    // se invalida con `asientos:`; el detalle por si quedo cacheado tambien.
    updateTag(`asientos:${ws.id}`);
    updateTag(`asiento:${ws.id}:${entryId}`);
    // Fallback: revalida la pagina del libro mayor para forzar recarga del
    // listado en la UI, ya que `asientos:` puede no estar referenciado por
    // todas las queries cacheadas.
    revalidatePath('/workspace/contabilidad');

    return { ok: true };
  } catch (err) {
    return toSerializableError(err);
  }
}

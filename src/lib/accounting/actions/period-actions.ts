'use server';
// ---------------------------------------------------------------------------
// Server Actions — Periodos contables (Ola 1.F)
// ---------------------------------------------------------------------------
// Equivalentes a los Route Handlers en /api/accounting/periods/{,close,lock,
// reopen} pero invocables desde Client Components sin pagar el round-trip
// HTTP. Cada accion:
//
//   1. Deriva `workspaceId` del cookie.
//   2. Valida input con Zod.
//   3. Ejecuta la mutacion en una TX serializable (mismo enfoque que los routes).
//   4. Emite `updateTag(\`periodos:${workspaceId}:${year}\`)` y un tag global
//      `periodos:${workspaceId}` para invalidar listados sin filtro de anio.
//
// El tag por anio existe para que la UI pueda cachear "periodos del 2026" sin
// invalidarse cuando se crea/cierra uno del 2025 (caso del cierre de fin de
// anio cuando ya estamos posteando enero).
//
// Estados:
//   - createPeriodAction: nuevo (status='open').
//   - closePeriodAction:   open -> closed.
//   - reopenPeriodAction:  closed -> open. Limpia closedAt.
//   - lockPeriodAction:    closed -> locked. IRREVERSIBLE.
// ---------------------------------------------------------------------------

import { updateTag } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '@/lib/db/client';
import { accountingPeriods, type AccountingPeriodRow } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createPeriodSchema = z
  .object({
    year: z.number().int().min(2000).max(2099),
    month: z.number().int().min(1).max(13),
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
      if (v.startsAt && v.endsAt) {
        return Date.parse(v.startsAt) <= Date.parse(v.endsAt);
      }
      return true;
    },
    { message: 'startsAt must be <= endsAt' },
  );

const periodIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type PeriodActionError = {
  ok: false;
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
};

export type CreatePeriodResult =
  | { ok: true; period: AccountingPeriodRow }
  | PeriodActionError;

export type PeriodTransitionResult =
  | {
      ok: true;
      period: AccountingPeriodRow;
      /** true si la operacion fue idempotente (ya estaba en ese estado). */
      noop?: boolean;
    }
  | PeriodActionError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodToActionError(error: z.ZodError): PeriodActionError {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    message: 'Datos del periodo invalidos.',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

function toSerializableError(err: unknown): PeriodActionError {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code ?? '');
    if (code === '23505') {
      return {
        ok: false,
        code: 'UNIQUE_VIOLATION',
        message: 'Ya existe un periodo con ese (anio, mes) en este workspace.',
      };
    }
    if (code === '40001' || code === '40P01') {
      return {
        ok: false,
        code: 'CONCURRENCY',
        message: 'Conflicto de concurrencia, reintenta',
      };
    }
  }
  console.error('[accounting/actions/period]', err);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Error interno al procesar el periodo.',
  };
}

/**
 * Calcula `startsAt` / `endsAt` para (year, month). El mes 13 es el
 * "ajustes de cierre" (post-diciembre) — startsAt y endsAt = 31 dic 23:59.
 * Se mantiene en sincronia con `_shared.computePeriodBoundaries` del route
 * handler para que el comportamiento sea identico.
 */
function computeBoundaries(
  year: number,
  month: number,
): { startsAt: Date; endsAt: Date } {
  if (month === 13) {
    const ts = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    return { startsAt: ts, endsAt: ts };
  }
  const startsAt = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endsAt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startsAt, endsAt };
}

// ---------------------------------------------------------------------------
// createPeriodAction
//
// Inserta un nuevo periodo en estado 'open'. Si (year, month) ya existe,
// retorna UNIQUE_VIOLATION (caller espera 409-equivalente).
// ---------------------------------------------------------------------------

export async function createPeriodAction(
  rawInput: unknown,
): Promise<CreatePeriodResult> {
  const parsed = createPeriodSchema.safeParse(rawInput);
  if (!parsed.success) return zodToActionError(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const explicitStart = parsed.data.startsAt
      ? new Date(parsed.data.startsAt)
      : null;
    const explicitEnd = parsed.data.endsAt
      ? new Date(parsed.data.endsAt)
      : null;
    const computed = computeBoundaries(parsed.data.year, parsed.data.month);

    const startsAt = explicitStart ?? computed.startsAt;
    const endsAt = explicitEnd ?? computed.endsAt;

    const [created] = await db
      .insert(accountingPeriods)
      .values({
        workspaceId: ws.id,
        year: parsed.data.year,
        month: parsed.data.month,
        startsAt,
        endsAt,
        status: 'open',
      })
      .returning();

    updateTag(`periodos:${ws.id}`);
    updateTag(`periodos:${ws.id}:${parsed.data.year}`);

    return { ok: true, period: created };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// closePeriodAction — open -> closed
// ---------------------------------------------------------------------------

export async function closePeriodAction(
  periodId: string,
): Promise<PeriodTransitionResult> {
  const parsed = periodIdSchema.safeParse(periodId);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'periodId debe ser un UUID valido.',
    };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const result = await db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.id, parsed.data),
              eq(accountingPeriods.workspaceId, ws.id),
            ),
          )
          .for('update');
        const period = rows[0];
        if (!period) return { kind: 'not_found' as const };
        if (period.status === 'locked') {
          return { kind: 'locked' as const, period };
        }
        if (period.status === 'closed') {
          return { kind: 'already_closed' as const, period };
        }
        const [updated] = await tx
          .update(accountingPeriods)
          .set({ status: 'closed', closedAt: new Date() })
          .where(eq(accountingPeriods.id, period.id))
          .returning();
        return { kind: 'closed' as const, period: updated };
      },
      { isolationLevel: 'serializable' },
    );

    if (result.kind === 'not_found') {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Periodo no encontrado.',
      };
    }
    if (result.kind === 'locked') {
      return {
        ok: false,
        code: 'PERIOD_LOCKED',
        message: 'El periodo esta bloqueado y no puede cerrarse de nuevo.',
      };
    }

    updateTag(`periodos:${ws.id}`);
    updateTag(`periodos:${ws.id}:${result.period.year}`);
    // Cerrar un periodo invalida el ledger del periodo: no se podran agregar
    // mas asientos, asi que las queries que muestran "periodo abierto?" tienen
    // que recargar.
    updateTag(`libro-mayor:${ws.id}:${result.period.id}`);

    return {
      ok: true,
      period: result.period,
      noop: result.kind === 'already_closed',
    };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// reopenPeriodAction — closed -> open
// ---------------------------------------------------------------------------

export async function reopenPeriodAction(
  periodId: string,
): Promise<PeriodTransitionResult> {
  const parsed = periodIdSchema.safeParse(periodId);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'periodId debe ser un UUID valido.',
    };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const result = await db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.id, parsed.data),
              eq(accountingPeriods.workspaceId, ws.id),
            ),
          )
          .for('update');
        const period = rows[0];
        if (!period) return { kind: 'not_found' as const };
        if (period.status === 'locked') {
          return { kind: 'locked' as const, period };
        }
        if (period.status === 'open') {
          return { kind: 'already_open' as const, period };
        }
        const [updated] = await tx
          .update(accountingPeriods)
          .set({ status: 'open', closedAt: null })
          .where(eq(accountingPeriods.id, period.id))
          .returning();
        return { kind: 'reopened' as const, period: updated };
      },
      { isolationLevel: 'serializable' },
    );

    if (result.kind === 'not_found') {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Periodo no encontrado.',
      };
    }
    if (result.kind === 'locked') {
      return {
        ok: false,
        code: 'PERIOD_LOCKED',
        message: 'Periodo bloqueado: no se puede reabrir.',
      };
    }

    updateTag(`periodos:${ws.id}`);
    updateTag(`periodos:${ws.id}:${result.period.year}`);
    updateTag(`libro-mayor:${ws.id}:${result.period.id}`);

    return {
      ok: true,
      period: result.period,
      noop: result.kind === 'already_open',
    };
  } catch (err) {
    return toSerializableError(err);
  }
}

// ---------------------------------------------------------------------------
// lockPeriodAction — closed -> locked. IRREVERSIBLE.
// ---------------------------------------------------------------------------

export async function lockPeriodAction(
  periodId: string,
): Promise<PeriodTransitionResult> {
  const parsed = periodIdSchema.safeParse(periodId);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'periodId debe ser un UUID valido.',
    };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const result = await db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.id, parsed.data),
              eq(accountingPeriods.workspaceId, ws.id),
            ),
          )
          .for('update');
        const period = rows[0];
        if (!period) return { kind: 'not_found' as const };
        if (period.status === 'open') {
          return { kind: 'must_close_first' as const, period };
        }
        if (period.status === 'locked') {
          return { kind: 'already_locked' as const, period };
        }
        const [updated] = await tx
          .update(accountingPeriods)
          .set({ status: 'locked', lockedAt: new Date() })
          .where(eq(accountingPeriods.id, period.id))
          .returning();
        return { kind: 'locked' as const, period: updated };
      },
      { isolationLevel: 'serializable' },
    );

    if (result.kind === 'not_found') {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Periodo no encontrado.',
      };
    }
    if (result.kind === 'must_close_first') {
      return {
        ok: false,
        code: 'PERIOD_MUST_BE_CLOSED_FIRST',
        message:
          'El periodo esta abierto. Debe cerrarse antes de bloquearse.',
      };
    }

    updateTag(`periodos:${ws.id}`);
    updateTag(`periodos:${ws.id}:${result.period.year}`);
    updateTag(`libro-mayor:${ws.id}:${result.period.id}`);

    return {
      ok: true,
      period: result.period,
      noop: result.kind === 'already_locked',
    };
  } catch (err) {
    return toSerializableError(err);
  }
}

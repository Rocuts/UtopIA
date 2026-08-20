// ---------------------------------------------------------------------------
// Idempotency-Key del API v1 — semántica Stripe con códigos del draft IETF.
//
// - replay: misma respuesta guardada + header `Idempotent-Replayed: true`
// - mismo key + payload distinto → 422 idempotency_payload_mismatch
// - solicitud concurrente en vuelo → 409 idempotency_key_in_use
// - TTL 24 h: filas viejas se reclaman como nuevas
// - los 5xx NO se persisten (el retry del cliente re-ejecuta)
//
// La lógica (runIdempotent) se testea contra un store en memoria; el store
// real es Postgres vía INSERT ... ON CONFLICT DO NOTHING (una sola carrera
// posible, la resuelve el unique index api_idem_scope_idx).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { and, eq, lt, sql } from 'drizzle-orm';

import { apiIdempotencyKeys } from '@/lib/db/schema';
import type { getDb } from '@/lib/db/client';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyScope {
  workspaceId: string;
  endpoint: string;
  key: string;
  fingerprint: string;
}

export type IdempotencyBegin =
  | { kind: 'new' }
  | { kind: 'processing' }
  | { kind: 'mismatch' }
  | { kind: 'completed'; status: number; body: unknown };

export interface IdempotencyStore {
  begin(scope: IdempotencyScope): Promise<IdempotencyBegin>;
  complete(scope: IdempotencyScope, status: number, body: unknown): Promise<void>;
  abandon(scope: IdempotencyScope): Promise<void>;
}

/** sha256 hex del body crudo — detecta reuso del key con payload distinto. */
export function fingerprintBody(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export type IdempotentOutcome =
  | { status: number; body: unknown; replayed: boolean }
  | { conflict: 'in_use' | 'mismatch' };

/**
 * Ejecuta `exec` bajo el contrato de idempotencia. `scope` null = el request
 * no trae Idempotency-Key y se ejecuta directo.
 */
export async function runIdempotent(
  store: IdempotencyStore,
  scope: IdempotencyScope | null,
  exec: () => Promise<{ status: number; body: unknown }>,
): Promise<IdempotentOutcome> {
  if (!scope) {
    const direct = await exec();
    return { ...direct, replayed: false };
  }

  const begin = await store.begin(scope);
  if (begin.kind === 'mismatch') return { conflict: 'mismatch' };
  if (begin.kind === 'processing') return { conflict: 'in_use' };
  if (begin.kind === 'completed') {
    return { status: begin.status, body: begin.body, replayed: true };
  }

  let result: { status: number; body: unknown };
  try {
    result = await exec();
  } catch (err) {
    // Liberar la reclamación para que el retry del cliente pueda ejecutar.
    await store.abandon(scope);
    throw err;
  }

  if (result.status < 500) {
    await store.complete(scope, result.status, result.body);
  } else {
    await store.abandon(scope);
  }
  return { ...result, replayed: false };
}

// ---------------------------------------------------------------------------
// Store Postgres (Drizzle) — thin: la semántica vive en runIdempotent.
// ---------------------------------------------------------------------------

type DbClient = ReturnType<typeof getDb>;

export function createDrizzleIdempotencyStore(db: DbClient): IdempotencyStore {
  const scopeWhere = (scope: IdempotencyScope) =>
    and(
      eq(apiIdempotencyKeys.workspaceId, scope.workspaceId),
      eq(apiIdempotencyKeys.endpoint, scope.endpoint),
      eq(apiIdempotencyKeys.idemKey, scope.key),
    );

  return {
    async begin(scope) {
      const inserted = await db
        .insert(apiIdempotencyKeys)
        .values({
          workspaceId: scope.workspaceId,
          endpoint: scope.endpoint,
          idemKey: scope.key,
          requestFingerprint: scope.fingerprint,
          status: 'processing',
        })
        .onConflictDoNothing({
          target: [
            apiIdempotencyKeys.workspaceId,
            apiIdempotencyKeys.endpoint,
            apiIdempotencyKeys.idemKey,
          ],
        })
        .returning({ id: apiIdempotencyKeys.id });

      if (inserted.length > 0) return { kind: 'new' };

      // TTL 24 h: reclamar la fila expirada como nueva (Stripe poda a las 24 h).
      const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
      const reclaimed = await db
        .update(apiIdempotencyKeys)
        .set({
          requestFingerprint: scope.fingerprint,
          status: 'processing',
          responseStatus: null,
          responseBody: null,
          createdAt: sql`now()`,
        })
        .where(and(scopeWhere(scope), lt(apiIdempotencyKeys.createdAt, cutoff)))
        .returning({ id: apiIdempotencyKeys.id });

      if (reclaimed.length > 0) return { kind: 'new' };

      const rows = await db
        .select()
        .from(apiIdempotencyKeys)
        .where(scopeWhere(scope))
        .limit(1);
      const row = rows[0];
      // Carrera extrema (fila borrada entre insert y select): tratar como en
      // vuelo — el retry del cliente resolverá.
      if (!row) return { kind: 'processing' };

      if (row.requestFingerprint !== scope.fingerprint) return { kind: 'mismatch' };
      if (row.status === 'processing') return { kind: 'processing' };
      return {
        kind: 'completed',
        status: row.responseStatus ?? 200,
        body: row.responseBody,
      };
    },

    async complete(scope, status, body) {
      await db
        .update(apiIdempotencyKeys)
        .set({ status: 'completed', responseStatus: status, responseBody: body })
        .where(scopeWhere(scope));
    },

    async abandon(scope) {
      await db
        .delete(apiIdempotencyKeys)
        .where(and(scopeWhere(scope), eq(apiIdempotencyKeys.status, 'processing')));
    },
  };
}

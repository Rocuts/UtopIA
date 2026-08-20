// ---------------------------------------------------------------------------
// Autenticación del API v1 — Bearer utop_sk_* (máquina-a-máquina).
//
// OWASP API2: las API keys autentican CLIENTES, nunca usuarios humanos.
// Orden de validación: pepper configurado → header → checksum offline (sin
// tocar DB) → HMAC + lookup por índice único → estado. Todo fallo de
// credencial responde el MISMO 401 opaco (no distinguir "no existe" de
// "revocada" — evita oráculos).
// ---------------------------------------------------------------------------

import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { apiKeys } from '@/lib/db/schema';
import type { getDb } from '@/lib/db/client';

import { hashApiKeyToken, isApiKeyPepperConfigured, verifyApiKeyChecksum } from './keys';

export const API_SCOPES = [
  'trial_balances:read',
  'trial_balances:write',
  'webhooks:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export interface AuthenticatedKey {
  id: string;
  workspaceId: string;
  name: string;
  scopes: string[];
  rpmRead: number;
  rpmWrite: number;
  /** Derivado del prefix ('utop_sk_live_' | 'utop_sk_test_'). */
  mode?: 'live' | 'test';
}

export interface AuthDeps {
  findActiveKeyByHash(hash: string): Promise<AuthenticatedKey | null>;
  /** Fire-and-forget con throttle — jamás bloquea ni rompe el request. */
  touchLastUsed(keyId: string): void;
}

export type AuthFailureCode = 'missing_api_key' | 'invalid_api_key' | 'api_disabled';

export async function authenticateApiRequest(
  req: Request,
  deps: AuthDeps,
): Promise<{ ok: true; key: AuthenticatedKey } | { ok: false; code: AuthFailureCode }> {
  if (!isApiKeyPepperConfigured()) {
    return { ok: false, code: 'api_disabled' };
  }

  const header = req.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, code: 'missing_api_key' };
  }

  const token = header.slice('bearer '.length).trim();
  // Checksum CRC32 offline: descarta tokens corruptos/inventados sin lookup.
  if (!verifyApiKeyChecksum(token)) {
    return { ok: false, code: 'invalid_api_key' };
  }

  const key = await deps.findActiveKeyByHash(hashApiKeyToken(token));
  if (!key) {
    return { ok: false, code: 'invalid_api_key' };
  }

  deps.touchLastUsed(key.id);
  return { ok: true, key };
}

export function hasScopes(key: AuthenticatedKey, required: string[]): boolean {
  return required.every((scope) => key.scopes.includes(scope));
}

// ---------------------------------------------------------------------------
// Deps reales (Drizzle) — el lookup filtra revocación y expiración en SQL.
// ---------------------------------------------------------------------------

type DbClient = ReturnType<typeof getDb>;

// Throttle de last_used_at: máx. 1 UPDATE por llave por minuto.
const LAST_USED_THROTTLE_MS = 60_000;
const lastTouched = new Map<string, number>();

export function createDrizzleAuthDeps(db: DbClient): AuthDeps {
  return {
    async findActiveKeyByHash(hash) {
      const rows = await db
        .select({
          id: apiKeys.id,
          workspaceId: apiKeys.workspaceId,
          name: apiKeys.name,
          scopes: apiKeys.scopes,
          rpmRead: apiKeys.rpmRead,
          rpmWrite: apiKeys.rpmWrite,
          prefix: apiKeys.prefix,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.keyHash, hash),
            isNull(apiKeys.revokedAt),
            or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const { prefix, ...key } = row;
      return { ...key, mode: prefix.includes('_test_') ? 'test' : 'live' };
    },

    touchLastUsed(keyId) {
      const now = Date.now();
      const last = lastTouched.get(keyId) ?? 0;
      if (now - last < LAST_USED_THROTTLE_MS) return;
      lastTouched.set(keyId, now);
      db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyId))
        .then(
          () => undefined,
          (err) => console.error('[api-v1] touchLastUsed falló:', err),
        );
    },
  };
}

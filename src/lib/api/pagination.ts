// ---------------------------------------------------------------------------
// Paginación por cursor del API v1 (consenso 2026: cursor > offset).
//
// El cursor es OPACO y a prueba de manipulación: base64url de
// `${createdAtMs}.${uuid}.${hmac16}` firmado con DB_HMAC_KEY (la misma clave
// HMAC de búsquedas cifradas del repo — ya es requerida en el entorno).
// AIP-158: "base64 de un token transparente no es ofuscación suficiente";
// la firma evita que el cliente fabrique posiciones arbitrarias.
// Keyset sobre (created_at, id) — estable ante inserts concurrentes.
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hmacKey(): Buffer {
  const key = process.env.DB_HMAC_KEY;
  if (!key) {
    throw new Error('encodeCursor: DB_HMAC_KEY no está configurado');
  }
  return Buffer.from(key, 'base64');
}

function sign(payload: string): string {
  return createHmac('sha256', hmacKey()).update(payload).digest('hex').slice(0, 16);
}

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  const payload = `${createdAt.getTime()}.${id}`;
  return Buffer.from(`${payload}.${sign(payload)}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition | null {
  if (!cursor) return null;
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [msStr, id, signature] = parts;
  const ms = Number(msStr);
  if (!Number.isInteger(ms) || ms <= 0 || !UUID_RE.test(id)) return null;
  if (sign(`${msStr}.${id}`) !== signature) return null;
  return { createdAt: new Date(ms), id };
}

export function parsePageParams(
  url: URL,
): { limit: number; cursor: CursorPosition | null } | { invalid: string } {
  const limitParam = url.searchParams.get('limit');
  let limit = PAGE_LIMIT_DEFAULT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed)) {
      return { invalid: `limit debe ser un entero entre 1 y ${PAGE_LIMIT_MAX}` };
    }
    limit = Math.min(Math.max(parsed, 1), PAGE_LIMIT_MAX);
  }

  const cursorParam = url.searchParams.get('cursor');
  if (cursorParam === null) return { limit, cursor: null };

  const cursor = decodeCursor(cursorParam);
  if (!cursor) {
    return { invalid: 'cursor inválido o manipulado; use el next_cursor de la página anterior' };
  }
  return { limit, cursor };
}

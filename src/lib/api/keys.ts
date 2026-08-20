// ---------------------------------------------------------------------------
// Llaves del API público — `utop_sk_{live|test}_<26 base62><6 crc32-base62>`.
//
// Diseño validado contra NIST SP 800-63B-4 (hash rápido permitido para
// secretos ≥112 bits; SHOULD iteración con sal secreta del verificador) y el
// formato de tokens de GitHub (checksum CRC32 → validación offline, cero
// falsos positivos de secret scanning). 26 chars base62 ≈ 154 bits CSPRNG.
//
// En reposo SOLO viaja hex(HMAC-SHA256(pepper, token)). El pepper vive en
// `UTOPIA_API_KEY_PEPPER` (env, nunca en DB ni en el repo — es público).
// Sin pepper el API completo responde 503 fail-closed (patrón admin-auth).
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

import { crc32Base62, randomBase62 } from './encoding';

export type ApiKeyMode = 'live' | 'test';

export interface GeneratedApiKey {
  token: string;
  prefix: string;
  last4: string;
  mode: ApiKeyMode;
}

export const API_KEY_PEPPER_ENV = 'UTOPIA_API_KEY_PEPPER';
export const CURRENT_PEPPER_VERSION = 1;

const KEY_BODY_LENGTH = 26;
const KEY_CHECKSUM_LENGTH = 6;
const KEY_TOKEN_RE = new RegExp(
  `^utop_sk_(live|test)_([0-9A-Za-z]{${KEY_BODY_LENGTH}})([0-9A-Za-z]{${KEY_CHECKSUM_LENGTH}})$`,
);

/** Genera un token nuevo. El token completo se muestra UNA sola vez. */
export function generateApiKeyToken(mode: ApiKeyMode): GeneratedApiKey {
  const body = randomBase62(KEY_BODY_LENGTH);
  const checksum = crc32Base62(body);
  const prefix = `utop_sk_${mode}_`;
  const token = `${prefix}${body}${checksum}`;
  return { token, prefix, last4: token.slice(-4), mode };
}

/** Parsea el token; null si el formato no es el nuestro. */
export function parseApiKeyToken(
  token: string,
): { mode: ApiKeyMode; body: string; checksum: string } | null {
  const match = KEY_TOKEN_RE.exec(token);
  if (!match) return null;
  return { mode: match[1] as ApiKeyMode, body: match[2], checksum: match[3] };
}

/**
 * Verificación offline del checksum (antes de tocar la DB): descarta tokens
 * corruptos o inventados sin costo de lookup.
 */
export function verifyApiKeyChecksum(token: string): boolean {
  const parsed = parseApiKeyToken(token);
  if (!parsed) return false;
  return crc32Base62(parsed.body) === parsed.checksum;
}

export function isApiKeyPepperConfigured(): boolean {
  return Boolean(process.env[API_KEY_PEPPER_ENV]);
}

/** hex(HMAC-SHA256(pepper, token)) — lo ÚNICO que se persiste de la llave. */
export function hashApiKeyToken(token: string): string {
  const pepper = process.env[API_KEY_PEPPER_ENV];
  if (!pepper) {
    throw new Error(
      `hashApiKeyToken: ${API_KEY_PEPPER_ENV} no está configurado (el API debe responder 503 fail-closed antes de llegar aquí)`,
    );
  }
  return createHmac('sha256', Buffer.from(pepper, 'base64')).update(token).digest('hex');
}

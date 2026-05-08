/**
 * AES-256-GCM vault for ERP credential secrets.
 *
 * Envelope wire format: `v1:gcm:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>`
 *
 * Key management
 * --------------
 *   Set `UTOPIA_VAULT_KEY` to a base64-encoded 32-byte random secret:
 *     node -e "console.log(crypto.randomBytes(32).toString('base64'))"
 *   Optionally set `UTOPIA_VAULT_KEY_PREV` during key rotation.
 *
 * Security notes
 * --------------
 *   - IV is 12 random bytes per encryption (GCM recommended size).
 *   - Auth tag is 16 bytes (GCM maximum — prevents ciphertext tampering).
 *   - Plaintext is never logged here.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENVELOPE_VERSION = 'v1';
const ENVELOPE_ALGO = 'gcm';
const KEY_ENV = 'UTOPIA_VAULT_KEY';
const KEY_PREV_ENV = 'UTOPIA_VAULT_KEY_PREV';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// ---------------------------------------------------------------------------
// Internal key loading
// ---------------------------------------------------------------------------

function loadKey(envName: string, required: boolean): Buffer | null {
  const raw = process.env[envName];
  if (!raw) {
    if (required) {
      throw new Error(
        `[vault] ${envName} is not set. ` +
          `Generate one with: node -e "console.log(crypto.randomBytes(32).toString('base64'))"`,
      );
    }
    return null;
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `[vault] ${envName} decoded to ${buf.length} bytes but expected ${KEY_BYTES} (256 bits). ` +
        `Re-generate: node -e "console.log(crypto.randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Core AES-256-GCM primitives
// ---------------------------------------------------------------------------

function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAutoPadding(false);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // always 16 bytes

  const ivB64 = iv.toString('base64url');
  const tagB64 = tag.toString('base64url');
  const ctB64 = encrypted.toString('base64url');

  return `${ENVELOPE_VERSION}:${ENVELOPE_ALGO}:${ivB64}:${tagB64}:${ctB64}`;
}

function decryptWithKey(key: Buffer, envelope: string): string {
  const segments = envelope.split(':');
  if (segments.length !== 5) {
    throw new Error(
      `[vault] envelope: malformed segments (expected 5, got ${segments.length})`,
    );
  }

  const [version, algo, ivB64, tagB64, ctB64] = segments;

  if (version !== ENVELOPE_VERSION) {
    throw new Error(`[vault] envelope: unknown version '${version}'`);
  }
  if (algo !== ENVELOPE_ALGO) {
    throw new Error(`[vault] envelope: unknown algorithm '${algo}'`);
  }

  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt `plaintext` using `UTOPIA_VAULT_KEY`.
 * Returns a self-describing envelope: `v1:gcm:<iv>:<tag>:<ciphertext>`.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey(KEY_ENV, true)!;
  return encryptWithKey(key, plaintext);
}

/**
 * Decrypt an envelope produced by `encryptSecret`.
 * Throws on any form of tampering, version/algo mismatch, or missing key.
 */
export function decryptSecret(envelope: string): string {
  const key = loadKey(KEY_ENV, true)!;
  return decryptWithKey(key, envelope);
}

/**
 * Try decrypting with `UTOPIA_VAULT_KEY` first; on auth-tag failure fall back
 * to `UTOPIA_VAULT_KEY_PREV` (key rotation support).
 *
 * Returns `{ plaintext, keyVersion }` — `'current'` or `'prev'`.
 * If neither key succeeds, rethrows the last error.
 */
export function tryDecryptWithRotation(
  envelope: string,
): { plaintext: string; keyVersion: 'current' | 'prev' } {
  const currentKey = loadKey(KEY_ENV, true)!;

  try {
    const plaintext = decryptWithKey(currentKey, envelope);
    return { plaintext, keyVersion: 'current' };
  } catch (currentErr) {
    const prevKey = loadKey(KEY_PREV_ENV, false);
    if (!prevKey) {
      throw currentErr;
    }
    // Let this throw if PREV also fails — caller sees the real error.
    const plaintext = decryptWithKey(prevKey, envelope);
    return { plaintext, keyVersion: 'prev' };
  }
}

/**
 * Idempotency check for migration scripts.
 * Returns `true` iff `value` looks like a vault envelope (`v1:gcm:...` with 5 segments).
 * Does NOT decode or validate the content.
 */
export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith('v1:gcm:') && value.split(':').length === 5;
}

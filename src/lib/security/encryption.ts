/**
 * Column-level encryption helpers backed by Postgres `pgcrypto`.
 *
 * Use to satisfy Ley 1581 / Proyecto 274/2025C / Habeas Data: sensitive
 * tributary data (NIT, cuentas bancarias, RUT, salarios, dirección fiscal,
 * teléfono personal) MUST be encrypted at rest.
 *
 * Requirements
 * ------------
 *   1. The Postgres database must have the pgcrypto extension installed:
 *        CREATE EXTENSION IF NOT EXISTS pgcrypto;
 *   2. Set `DB_ENCRYPTION_KEY` to a 32-byte random secret, base64-encoded:
 *        node -e "console.log(crypto.randomBytes(32).toString('base64'))"
 *      Then add to Vercel for production / preview / development.
 *      Rotate by adding a `DB_ENCRYPTION_KEY_PREV` env and migrating columns.
 *
 * Usage
 * -----
 *   import { encryptColumn, decryptColumn } from '@/lib/security/encryption';
 *   import { db } from '@/lib/db/client';
 *   import { erpCredentials } from '@/lib/db/schema';
 *
 *   // Insert
 *   await db.insert(erpCredentials).values({
 *     workspaceId,
 *     // pgp_sym_encrypt produces bytea; the column should be `bytea` (or text
 *     // wrapping pgp_sym_encrypt(...)::text — see SECURITY_ENCRYPTION.md).
 *     nitEncrypted: encryptColumn(rawNit),
 *   });
 *
 *   // Select with decryption (returns plaintext)
 *   const rows = await db.execute(sql`
 *     SELECT id, ${decryptColumn(erpCredentials.nitEncrypted)} AS nit
 *     FROM ${erpCredentials}
 *     WHERE workspace_id = ${workspaceId}
 *   `);
 *
 * Limitations
 * -----------
 *   - Equality / range queries on encrypted columns are NOT possible without a
 *     deterministic surrogate (HMAC-SHA256 of the value with a separate key).
 *     Add such a surrogate column when you need WHERE clauses.
 *   - Indexes on encrypted columns are useless (every row decrypts to a unique
 *     ciphertext per call). Index the HMAC surrogate instead.
 *   - Key material lives in env. Rotate via background job that re-encrypts
 *     with the new key and drops the old one from env.
 */

import { sql } from 'drizzle-orm';
import type { SQL, AnyColumn } from 'drizzle-orm';

const ENCRYPTION_KEY_ENV = 'DB_ENCRYPTION_KEY';

function getKey(): string {
  const key = process.env[ENCRYPTION_KEY_ENV];
  if (!key) {
    throw new Error(
      `[encryption] ${ENCRYPTION_KEY_ENV} is not set. ` +
        `Generate one with: node -e "console.log(crypto.randomBytes(32).toString('base64'))" ` +
        `and add it to Vercel project env vars.`,
    );
  }
  if (key.length < 24) {
    // Soft sanity check — a base64 32-byte key is 44 chars. Anything shorter
    // is almost certainly wrong / dev placeholder.
    throw new Error(
      `[encryption] ${ENCRYPTION_KEY_ENV} looks too short (${key.length} chars). ` +
        `Expected base64-encoded 32 bytes (~44 chars).`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext value before INSERT/UPDATE.
 * Returns a Drizzle SQL fragment that calls `pgp_sym_encrypt` server-side, so
 * the plaintext travels over the wire only as a parameter (TLS protected) and
 * is encrypted by Postgres before hitting disk.
 *
 *   await db.insert(table).values({ col: encryptColumn('secret value') });
 */
export function encryptColumn(value: string | null | undefined): SQL {
  if (value === null || value === undefined) {
    return sql`NULL`;
  }
  const key = getKey();
  return sql`pgp_sym_encrypt(${value}, ${key})`;
}

/**
 * Decrypt a column in a SELECT statement.
 * Returns a Drizzle SQL fragment suitable for embedding in raw SELECT lists:
 *
 *   sql`SELECT id, ${decryptColumn(table.colEncrypted)} AS col_plain FROM ...`
 *
 * The column type should be `bytea` (preferred) — that's what pgp_sym_encrypt
 * returns. If you have stored ciphertext as TEXT (legacy), pass `{ asBytea: true }`
 * to cast first.
 */
export function decryptColumn(
  column: AnyColumn | SQL,
  options: { asBytea?: boolean } = {},
): SQL {
  const key = getKey();
  const colExpr = options.asBytea ? sql`${column}::bytea` : sql`${column}`;
  return sql`pgp_sym_decrypt(${colExpr}, ${key})`;
}

/**
 * Compute a deterministic HMAC for equality lookups on encrypted columns.
 *
 * Postgres recipe: store both `nit_encrypted` (bytea, pgp_sym_encrypt) AND
 * `nit_lookup` (bytea, hmac with a SEPARATE key from DB_HMAC_KEY) so you can
 * query `WHERE nit_lookup = encrypted_lookup_value(rawNit)` without exposing
 * plaintext to the planner.
 *
 * Set `DB_HMAC_KEY` to a different 32-byte secret (rotated independently).
 */
export function encryptedLookupValue(value: string): SQL {
  const hmacKey = process.env.DB_HMAC_KEY;
  if (!hmacKey) {
    throw new Error(
      `[encryption] DB_HMAC_KEY is not set. Required for deterministic lookups on encrypted columns.`,
    );
  }
  return sql`hmac(${value}, ${hmacKey}, 'sha256')`;
}

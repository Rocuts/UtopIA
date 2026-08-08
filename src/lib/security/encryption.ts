/**
 * @deprecated SIN USO EN PRODUCCIÓN. Para cifrar secretos use
 * `src/lib/security/vault.ts` (AES-256-GCM en Node, envelope
 * `v1:gcm:<iv>:<tag>:<ct>`, rotación vía `UTOPIA_VAULT_KEY_PREV`), que es lo
 * que realmente protege las credenciales ERP. Este módulo se conserva sólo
 * como la receta pgcrypto documentada en `docs/SECURITY_ENCRYPTION.md` para el
 * día que se cifren columnas PII (NIT, salarios, dirección fiscal); no tiene
 * ni un solo importador de producción.
 *
 * POR QUÉ ESTÁ DEPRECADO, y no sólo "sin usar": pgcrypto consume la variable
 * de entorno como PASSPHRASE en crudo — no decodifica el base64 ni valida
 * nada. Un '\n' pegado al final de `DB_ENCRYPTION_KEY` (lo normal al pegar en
 * un dashboard) genera un digest distinto SIN error: las filas se cifran con
 * una clave que luego no descifra, y los lookups HMAC devuelven 0 filas para
 * siempre. `vault.ts` no tiene ese modo de fallo porque decodifica la clave y
 * verifica el tag GCM.
 *
 * Mitigación mientras siga aquí: `getKey()` ahora LANZA ante una clave de
 * forma sospechosa en vez de emitir un warning (ver `assertKeyShape`). Antes
 * seguía adelante y corrompía en silencio.
 *
 * ---
 *
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
const HMAC_KEY_ENV = 'DB_HMAC_KEY';

// pgcrypto consume el STRING crudo del env como passphrase (no los bytes
// decodificados). Un salto de línea o espacio pegado al valor — habitual al
// pegar en un dashboard — o un base64 que no decodifica a 32 bytes cambia el
// digest SIN lanzar ningún error: se cifra con una clave y luego no descifra,
// y los lookups HMAC devuelven 0 filas para siempre.
//
// Antes esto era un `console.warn` una-vez-por-proceso, con el argumento de
// que trimear la clave rompería las filas ya cifradas con el valor sucio. Ese
// argumento sólo vale si HAY filas cifradas — y no las hay: el módulo no tiene
// importadores de producción (ver el @deprecated de la cabecera). Con cero
// filas en riesgo, fallar en el primer uso es estrictamente mejor que dejar
// que alguien cifre un año de datos PII contra una clave que no podrá volver a
// leer. `encryptedLookupValue()` ya se comportaba así; ahora los dos caminos
// (cifrado y HMAC) fallan igual de duro, que es lo que evita que el par
// cifrado/lookup se desincronice en silencio. Ver GO_LIVE_RUNBOOK.md §6.1.
//
// Seguimos SIN mutar el valor: no adivinamos qué quiso decir el operador, le
// decimos que lo re-aprovisione bien.
function assertKeyShape(envName: string, raw: string): void {
  const hasWhitespace = raw.trim() !== raw;
  const decodedBytes = Buffer.from(raw.trim(), 'base64').length;
  if (!hasWhitespace && decodedBytes === 32) return;
  throw new Error(
    `[encryption] ${envName} tiene forma inválida ` +
      `(${hasWhitespace ? 'espacios/salto de línea alrededor; ' : ''}decodifica a ${decodedBytes} bytes, se esperaban 32). ` +
      `pgcrypto usa el string crudo como passphrase: un '\\n' suelto rompe el descifrado y los lookups sin avisar. ` +
      `Re-aprovisione con \`printf %s\` (sin salto final): ` +
      `node -e "console.log(crypto.randomBytes(32).toString('base64'))". Ver GO_LIVE_RUNBOOK.md §6.1.`,
  );
}

function getKey(): string {
  const key = process.env[ENCRYPTION_KEY_ENV];
  if (!key) {
    throw new Error(
      `[encryption] ${ENCRYPTION_KEY_ENV} no está definida. ` +
        `Genere una con: node -e "console.log(crypto.randomBytes(32).toString('base64'))" ` +
        `y agréguela a las env vars del proyecto en Vercel.`,
    );
  }
  // Subsume el viejo chequeo de "clave demasiado corta": 32 bytes en base64
  // son 44 caracteres, así que cualquier valor más corto ya falla acá.
  assertKeyShape(ENCRYPTION_KEY_ENV, key);
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
  const raw = process.env[HMAC_KEY_ENV];
  if (!raw) {
    throw new Error(
      `[encryption] ${HMAC_KEY_ENV} is not set. Required for deterministic lookups on encrypted columns.`,
    );
  }
  // Trim is safe here: DB_HMAC_KEY gates this function, so the throw above
  // prevents any nit_lookup row from being written with an un-trimmed key.
  // Validating the decoded length fails loud instead of silently producing
  // mismatched HMAC digests (lookups returning 0 rows). See GO_LIVE_RUNBOOK.md §6.
  const hmacKey = raw.trim();
  const decodedBytes = Buffer.from(hmacKey, 'base64').length;
  if (decodedBytes !== 32) {
    throw new Error(
      `[encryption] ${HMAC_KEY_ENV} must decode to 32 bytes (got ${decodedBytes}). ` +
        `Generate: node -e "console.log(crypto.randomBytes(32).toString('base64'))".`,
    );
  }
  return sql`hmac(${value}, ${hmacKey}, 'sha256')`;
}

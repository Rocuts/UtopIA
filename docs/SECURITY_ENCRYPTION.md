# Encryption-at-Rest (pgcrypto)

Helper: `src/lib/security/encryption.ts`. Used together with Drizzle ORM
to encrypt sensitive Colombian PII / financial columns at rest.

## Why

Ley 1581 (Habeas Data) + Proyecto 274/2025C + Circular SIC 2025
(CONPES 4144) require encryption-at-rest for "datos sensibles" and
"datos financieros" of natural persons and Colombian taxpayers.

## One-time setup

1. Enable `pgcrypto` on Neon:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```
2. Generate the master key locally and store in Vercel:
   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64'))"
   ```
   Add as `DB_ENCRYPTION_KEY` for Production / Preview / Development.
3. (Optional, for equality search) generate a second key:
   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64'))"
   ```
   Add as `DB_HMAC_KEY`. Used by `encryptedLookupValue()`.

Both keys MUST live in Vercel env (NOT in Postgres, NOT committed).

## Candidate columns (Ola 1)

These are the candidates flagged for column-level encryption. Schema is
**not** modified yet — the column rename + bytea migration is a job for
Ola 1 (per-tenant rollout) so that the team can plan an HMAC surrogate
column for each search-by-equality requirement.

| Table              | Column              | Reason                                    | Needs HMAC lookup? |
|--------------------|---------------------|-------------------------------------------|--------------------|
| `workspaces`       | `nit`               | Identificador tributario empresarial      | Yes                |
| `workspaces`       | `legal_name`        | Razon social (sensitive when paired)      | No                 |
| `erp_credentials`  | `api_key`           | Credenciales ERP (Siigo / Alegra)         | No                 |
| `erp_credentials`  | `api_secret`        | Idem                                      | No                 |
| `erp_credentials`  | `tenant_id`         | Identificador de tenant ERP               | No                 |
| `pyme_*` (futuro)  | `cuenta_bancaria`   | Cuenta de ahorros/corriente colombiana    | Yes (parcial)      |
| `pyme_*` (futuro)  | `ruc_proveedor`     | RUT proveedor                             | Yes                |
| `pyme_*` (futuro)  | `salario_empleado`  | PII economica trabajador                  | No                 |
| `reports`          | `payload` JSONB     | Solo si contiene PII tokenizada en claro  | No (revisar)       |

## Migration pattern (per column)

Each encrypted column uses the suffix `_encrypted` (bytea) plus an
optional `_lookup` HMAC surrogate. Example for `workspaces.nit`:

```sql
ALTER TABLE workspaces ADD COLUMN nit_encrypted bytea;
ALTER TABLE workspaces ADD COLUMN nit_lookup bytea;

UPDATE workspaces
   SET nit_encrypted = pgp_sym_encrypt(nit, current_setting('app.enc_key')),
       nit_lookup    = hmac(nit, current_setting('app.hmac_key'), 'sha256')
 WHERE nit IS NOT NULL;

ALTER TABLE workspaces DROP COLUMN nit;
CREATE INDEX idx_workspaces_nit_lookup ON workspaces (nit_lookup);
```

(`current_setting` requires a session-level GUC. In Drizzle migrations
prefer reading the key from env in a tiny script — see
`scripts/db-migrate.ts`.)

## Querying

```ts
import { encryptColumn, decryptColumn, encryptedLookupValue } from '@/lib/security/encryption';
import { db } from '@/lib/db/client';
import { workspaces } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

// INSERT
await db.insert(workspaces).values({
  id: workspaceId,
  nitEncrypted: encryptColumn(rawNit),
  nitLookup: encryptedLookupValue(rawNit),  // sha256 hmac
});

// SELECT (decrypt server-side)
const rows = await db.execute(sql`
  SELECT id,
         ${decryptColumn(workspaces.nitEncrypted)} AS nit
    FROM ${workspaces}
   WHERE nit_lookup = ${encryptedLookupValue(rawNit)}
`);
```

## Rotation

1. Add `DB_ENCRYPTION_KEY_NEXT` to Vercel.
2. Run a background job: read with the old key, re-write with the next
   key. Update one row at a time, idempotent.
3. Promote `DB_ENCRYPTION_KEY_NEXT` -> `DB_ENCRYPTION_KEY`. Drop old.

## Limitations

- **No equality on ciphertext.** Use HMAC surrogate columns for WHERE clauses.
- **No range queries.** If you need ordering or BETWEEN, store the value in
  a separate (non-encrypted) coarse-grained column (e.g. `created_year`).
- **Indexes useless on ciphertext.** Index the HMAC surrogate.
- **Not a substitute for row-level security.** Combine with workspace-scoped
  filters in every query (`WHERE workspace_id = $1`).

## ERP Vault (AES-256-GCM, Node-side)

ERP credentials (Siigo, SAP B1, Oracle Fusion, etc.) are encrypted in Node before
they touch Postgres, ensuring no plaintext appears in DB query logs, pgBouncer,
or Neon log streams. This is a different mechanism from the column-level
pgcrypto helper in `src/lib/security/encryption.ts`, which is for PII columns
(NIT, RUT, salaries) where lookup queries with HMAC surrogates are needed.

### Wire format

`v1:gcm:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>`

- `v1`: version tag (bumps on algorithm change)
- `gcm`: AES-256-GCM AEAD
- `iv`: 12 random bytes per encryption (NIST SP 800-38D recommendation)
- `tag`: 16-byte GCM authentication tag
- `ciphertext`: AES-256-GCM(plaintext, key, iv, tag)
- All segments base64url-encoded without padding

The plaintext payload is a JSON object with the secret-bag fields only
(apiKey, apiToken, password, accessToken, refreshToken, clientSecret). Non-secret
fields (baseUrl, companyId, tenantId, databaseName, username, webhookSecret)
remain plaintext in `erp_credentials.metadata` JSONB.

### Key generation

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set as `UTOPIA_VAULT_KEY` in Vercel project env (Production + Preview +
Development scopes). Pull locally with `vercel env pull .env.local`.

### Rotation runbook

1. Generate new key (recipe above).
2. In Vercel env: copy current `UTOPIA_VAULT_KEY` to `UTOPIA_VAULT_KEY_PREV`.
3. Set the new key as `UTOPIA_VAULT_KEY`.
4. Redeploy. The vault helper now reads with current and falls back to PREV
   on auth-tag failures (covers in-flight rows).
5. Run the rotation script:
   ```bash
   npm run db:encrypt-erp -- --rotate
   ```
   This re-encrypts every `erp_credentials` row using the new key, decrypting
   via PREV fallback.
6. Verify all rows decrypt cleanly with current key only (run script again
   without `--rotate` and confirm `migrated=0, errors=0`). Then remove
   `UTOPIA_VAULT_KEY_PREV` from env and redeploy.

> **Note:** A `key_version` column on `erp_credentials` for per-row rotation
> telemetry is deferred until the migrations baseline (0005-0010) is rebased
> into `_journal.json`. Tracked as `e1-followup` in `src/lib/db/schema.ts`
> and `src/app/api/erp/connect/route.ts`.

### Tradeoffs vs pgcrypto

- AES-GCM Node-side: no plaintext in any DB log; no equality queries on
  encrypted columns (intentional — secrets shouldn't be queried).
- pgcrypto: plaintext travels in SQL parameters (visible in query logs);
  supports HMAC-surrogate equality lookups; useful for PII that needs WHERE
  clauses (NIT, email).

Use the vault for credentials, secrets, tokens, refresh tokens. Use pgcrypto
for queryable PII columns.

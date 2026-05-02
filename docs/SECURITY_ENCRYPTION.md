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

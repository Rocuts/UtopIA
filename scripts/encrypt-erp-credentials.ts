// scripts/encrypt-erp-credentials.ts
// Idempotent one-shot migration: wraps any plaintext `encrypted_secret` in an
// AES-256-GCM envelope (`v1:gcm:<iv>:<tag>:<ct>`) and moves secret-bag fields
// out of `metadata`. The `key_version` column is reserved for a follow-up PR
// once the migration baseline (0005-0010) is journaled — until then rotation
// works without a per-row version flag.
//
// Usage (normal):
//   dotenv -e .env.local -- tsx scripts/encrypt-erp-credentials.ts
//
// Dry-run (no writes, shows what would change):
//   dotenv -e .env.local -- tsx scripts/encrypt-erp-credentials.ts --dry-run
//
// Key rotation (re-encrypt all rows, PREV key → current key):
//   dotenv -e .env.local -- tsx scripts/encrypt-erp-credentials.ts --rotate
//
// SAFE to run multiple times: isEncryptedEnvelope() check prevents double-encryption.

import { Pool } from 'pg';
import { encryptSecret, isEncryptedEnvelope, tryDecryptWithRotation } from '@/lib/security/vault';

const SECRET_FIELDS = [
  'apiKey',
  'apiToken',
  'password',
  'accessToken',
  'refreshToken',
  'clientSecret',
] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

const DRY_RUN = process.argv.includes('--dry-run');
const ROTATE = process.argv.includes('--rotate');

if (DRY_RUN) {
  console.log('[encrypt-erp-credentials] DRY RUN — no writes will be performed.');
}
if (ROTATE) {
  console.log('[encrypt-erp-credentials] ROTATE mode — all rows will be re-encrypted regardless of envelope state.');
}

interface CredentialRow {
  id: string;
  workspace_id: string;
  provider: string;
  encrypted_secret: string;
  metadata: Record<string, unknown> | null;
}

function omitSecretFields(metadata: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (!(SECRET_FIELDS as readonly string[]).includes(key)) {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

function extractSecrets(metadata: Record<string, unknown>): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const field of SECRET_FIELDS) {
    const val = metadata[field];
    if (val !== undefined && val !== null && val !== '') {
      secrets[field] = String(val);
    }
  }
  return secrets;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes`.');
    process.exit(1);
  }

  if (!process.env.UTOPIA_VAULT_KEY) {
    console.error('UTOPIA_VAULT_KEY is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    await pool.query('BEGIN');

    const { rows } = await pool.query<CredentialRow>(
      'SELECT id, workspace_id, provider, encrypted_secret, metadata FROM erp_credentials',
    );

    console.log(`[encrypt-erp-credentials] Found ${rows.length} credential row(s).`);

    for (const row of rows) {
      try {
        const alreadyEncrypted = isEncryptedEnvelope(row.encrypted_secret);

        if (!ROTATE && alreadyEncrypted) {
          // Already migrated — skip.
          console.log(JSON.stringify({ id: row.id, action: 'skipped' }));
          skipped++;
          continue;
        }

        if (ROTATE && alreadyEncrypted) {
          // Re-encrypt: decrypt with PREV key, then encrypt with current key.
          let plaintext: string;
          try {
            ({ plaintext } = tryDecryptWithRotation(row.encrypted_secret));
          } catch (decryptErr) {
            console.error(
              JSON.stringify({
                id: row.id,
                action: 'rotate_decrypt_failed',
                error: (decryptErr as Error).message,
              }),
            );
            errors++;
            continue; // Don't rollback the whole batch for one bad row.
          }

          const newEnvelope = encryptSecret(plaintext);

          if (!DRY_RUN) {
            await pool.query(
              'UPDATE erp_credentials SET encrypted_secret = $1 WHERE id = $2',
              [newEnvelope, row.id],
            );
          }

          console.log(
            JSON.stringify({
              id: row.id,
              workspace_id: row.workspace_id,
              provider: row.provider,
              action: 'rotated',
            }),
          );
          migrated++;
          continue;
        }

        // Not yet encrypted — migrate plaintext to envelope.
        const metadata = row.metadata ?? {};
        const secrets = extractSecrets(metadata);
        const secretsJson = JSON.stringify(secrets);
        const envelope = encryptSecret(secretsJson);
        const cleanMetadata = omitSecretFields(metadata);

        if (!DRY_RUN) {
          await pool.query(
            'UPDATE erp_credentials SET encrypted_secret = $1, metadata = $2 WHERE id = $3',
            [envelope, JSON.stringify(cleanMetadata), row.id],
          );
        }

        console.log(
          JSON.stringify({
            id: row.id,
            workspace_id: row.workspace_id,
            provider: row.provider,
            action: DRY_RUN ? 'would_migrate' : 'migrated',
            secretFieldsCount: Object.keys(secrets).length,
          }),
        );
        migrated++;
      } catch (rowErr) {
        console.error(
          JSON.stringify({
            id: row.id,
            action: 'error',
            error: (rowErr as Error).message,
          }),
        );
        errors++;
        // Non-fatal per-row errors in rotate mode; in normal mode roll back.
        if (!ROTATE) {
          throw new Error(`Fatal error on row ${row.id}: ${(rowErr as Error).message}`);
        }
      }
    }

    if (DRY_RUN) {
      await pool.query('ROLLBACK');
      console.log('[encrypt-erp-credentials] DRY RUN complete — all changes rolled back.');
    } else {
      await pool.query('COMMIT');
    }

    console.log(
      `\n[encrypt-erp-credentials] Done. migrated=${migrated}, skipped=${skipped}, errors=${errors}, total=${rows.length}`,
    );
    if (errors > 0) {
      process.exit(1);
    }
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('[encrypt-erp-credentials] Transaction rolled back.', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

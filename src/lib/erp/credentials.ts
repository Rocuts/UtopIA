/**
 * Domain boundary: ERP credential serialization / deserialization.
 *
 * Splits an `ERPCredentials` object into:
 *   - `encryptedSecret`  — JSON blob of secret-bag fields, AES-256-GCM encrypted.
 *   - `metadata`         — plaintext non-secret fields safe to store in jsonb.
 *
 * Loading reverses the process: decrypt → parse → merge with metadata row.
 */

import type { ErpCredential } from '@/lib/db/schema';
import type { ERPCredentials } from '@/lib/erp/types';
import { encryptSecret, tryDecryptWithRotation } from '@/lib/security/vault';

// ---------------------------------------------------------------------------
// Secret-bag field names (encrypted as a JSON blob)
// ---------------------------------------------------------------------------

const SECRET_FIELDS = [
  'apiKey',
  'apiToken',
  'password',
  'accessToken',
  'refreshToken',
  'clientSecret',
] as const;

type SecretField = (typeof SECRET_FIELDS)[number];
type SecretBag = Partial<Record<SecretField, string>>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize ERP credentials for DB storage.
 *
 * Returns:
 *   - `encryptedSecret`: AES-256-GCM envelope containing the secret-bag JSON.
 *   - `metadata`: plaintext fields (baseUrl, companyId, tenantId, etc.) plus
 *     any extras (webhookSecret, enabled).
 *
 * Secret-bag fields are NOT present in `metadata`.
 */
export function serializeCredentials(
  creds: ERPCredentials,
  extras?: { webhookSecret?: string; enabled?: boolean },
): { encryptedSecret: string; metadata: Record<string, unknown> } {
  // 1. Extract secret-bag fields.
  const secrets: SecretBag = {};
  for (const field of SECRET_FIELDS) {
    const val = creds[field];
    if (val !== undefined) {
      secrets[field] = val;
    }
  }

  // 2. Encrypt the secret blob.
  const encryptedSecret = encryptSecret(JSON.stringify(secrets));

  // 3. Build plaintext metadata (everything that is NOT a secret-bag field).
  const secretSet = new Set<string>(SECRET_FIELDS);
  const metadata: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(creds)) {
    if (k === 'provider') continue; // stored in its own column
    if (secretSet.has(k)) continue;
    if (v !== undefined) {
      metadata[k] = v;
    }
  }

  // 4. Merge extras into metadata.
  if (extras) {
    if (extras.webhookSecret !== undefined) {
      metadata.webhookSecret = extras.webhookSecret;
    }
    if (extras.enabled !== undefined) {
      metadata.enabled = extras.enabled;
    }
  }

  return { encryptedSecret, metadata };
}

/**
 * Load ERP credentials from a DB row.
 *
 * Decrypts the secret blob (with key-rotation support), parses it, and merges
 * the result with plaintext metadata fields.
 *
 * Throws `[erp/credentials] decrypt failed for workspace=<id> provider=<provider>`
 * on decryption failure — does NOT expose the bad ciphertext.
 */
export function loadCredentials(row: ErpCredential): ERPCredentials {
  let secrets: SecretBag;
  try {
    const { plaintext } = tryDecryptWithRotation(row.encryptedSecret);
    secrets = JSON.parse(plaintext) as SecretBag;
  } catch {
    throw new Error(
      `[erp/credentials] decrypt failed for workspace=${row.workspaceId} provider=${row.provider}`,
    );
  }

  const meta = (row.metadata ?? {}) as Record<string, unknown>;

  // Merge: metadata fields first, then secrets (secrets win on collision — unlikely but safe).
  const creds: ERPCredentials = {
    provider: row.provider as ERPCredentials['provider'],
    // Plaintext metadata fields
    ...(meta.baseUrl !== undefined && { baseUrl: meta.baseUrl as string }),
    ...(meta.companyId !== undefined && { companyId: meta.companyId as string }),
    ...(meta.tenantId !== undefined && { tenantId: meta.tenantId as string }),
    ...(meta.databaseName !== undefined && { databaseName: meta.databaseName as string }),
    ...(meta.username !== undefined && { username: meta.username as string }),
    ...(meta.clientId !== undefined && { clientId: meta.clientId as string }),
    ...(meta.tokenExpiry !== undefined && { tokenExpiry: meta.tokenExpiry as string }),
    // Decrypted secrets
    ...secrets,
  };

  return creds;
}

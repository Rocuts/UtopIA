import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { serializeCredentials, loadCredentials } from '../credentials';
import type { ERPCredentials } from '@/lib/erp/types';
import type { ErpCredential } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshKey(): string {
  return randomBytes(32).toString('base64');
}

/** Build a minimal ErpCredential row from serialize output. */
function makeRow(
  workspaceId: string,
  provider: string,
  encryptedSecret: string,
  metadata: Record<string, unknown>,
): ErpCredential {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    workspaceId,
    provider,
    label: 'test',
    encryptedSecret,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Env management
// ---------------------------------------------------------------------------

let savedKey: string | undefined;
let savedKeyPrev: string | undefined;

beforeEach(() => {
  savedKey = process.env.UTOPIA_VAULT_KEY;
  savedKeyPrev = process.env.UTOPIA_VAULT_KEY_PREV;
  process.env.UTOPIA_VAULT_KEY = freshKey();
  delete process.env.UTOPIA_VAULT_KEY_PREV;
});

afterEach(() => {
  if (savedKey === undefined) {
    delete process.env.UTOPIA_VAULT_KEY;
  } else {
    process.env.UTOPIA_VAULT_KEY = savedKey;
  }
  if (savedKeyPrev === undefined) {
    delete process.env.UTOPIA_VAULT_KEY_PREV;
  } else {
    process.env.UTOPIA_VAULT_KEY_PREV = savedKeyPrev;
  }
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('serializeCredentials / loadCredentials', () => {
  it('round-trips Siigo credentials (apiKey + companyId + baseUrl)', () => {
    const creds: ERPCredentials = {
      provider: 'siigo',
      apiKey: 'sk_siigo_abc123',
      companyId: 'COMP-001',
      baseUrl: 'https://api.siigo.com',
    };

    const { encryptedSecret, metadata } = serializeCredentials(creds);
    const row = makeRow('ws-001', 'siigo', encryptedSecret, metadata);
    const loaded = loadCredentials(row);

    expect(loaded.provider).toBe('siigo');
    expect(loaded.apiKey).toBe('sk_siigo_abc123');
    expect(loaded.companyId).toBe('COMP-001');
    expect(loaded.baseUrl).toBe('https://api.siigo.com');
  });

  it('round-trips SAP B1 credentials — password ends up in encrypted blob, NOT in metadata', () => {
    const creds: ERPCredentials = {
      provider: 'sap_b1',
      username: 'manager',
      password: 's3cr3t!',
      databaseName: 'SBO_PROD',
      baseUrl: 'https://sap.example.com:50000',
    };

    const { encryptedSecret, metadata } = serializeCredentials(creds);

    // password must NOT appear in plaintext metadata
    expect(metadata.password).toBeUndefined();
    expect(metadata.username).toBe('manager');
    expect(metadata.databaseName).toBe('SBO_PROD');
    expect(metadata.baseUrl).toBe('https://sap.example.com:50000');

    const row = makeRow('ws-002', 'sap_b1', encryptedSecret, metadata);
    const loaded = loadCredentials(row);

    expect(loaded.provider).toBe('sap_b1');
    expect(loaded.username).toBe('manager');
    expect(loaded.password).toBe('s3cr3t!');
    expect(loaded.databaseName).toBe('SBO_PROD');
    expect(loaded.baseUrl).toBe('https://sap.example.com:50000');
  });

  it('round-trips Oracle Fusion — clientSecret encrypted, tenantId plaintext', () => {
    const creds: ERPCredentials = {
      provider: 'oracle_fusion',
      clientId: 'oracle-client-xyz',
      clientSecret: 'super-secret-client-secret',
      tenantId: 'TENANT-42',
      baseUrl: 'https://oracle.example.com',
    };

    const { encryptedSecret, metadata } = serializeCredentials(creds);

    // clientSecret must NOT be in metadata
    expect(metadata.clientSecret).toBeUndefined();
    // tenantId must be in plaintext
    expect(metadata.tenantId).toBe('TENANT-42');

    const row = makeRow('ws-003', 'oracle_fusion', encryptedSecret, metadata);
    const loaded = loadCredentials(row);

    expect(loaded.provider).toBe('oracle_fusion');
    expect(loaded.clientId).toBe('oracle-client-xyz');
    expect(loaded.clientSecret).toBe('super-secret-client-secret');
    expect(loaded.tenantId).toBe('TENANT-42');
  });

  it('strips all secret-bag fields from metadata output', () => {
    const creds: ERPCredentials = {
      provider: 'xero',
      apiKey: 'xero-api',
      apiToken: 'xero-token',
      password: 'xero-pass',
      accessToken: 'xero-access',
      refreshToken: 'xero-refresh',
      clientSecret: 'xero-secret',
      baseUrl: 'https://api.xero.com',
    };

    const { metadata } = serializeCredentials(creds);

    expect(metadata.apiKey).toBeUndefined();
    expect(metadata.apiToken).toBeUndefined();
    expect(metadata.password).toBeUndefined();
    expect(metadata.accessToken).toBeUndefined();
    expect(metadata.refreshToken).toBeUndefined();
    expect(metadata.clientSecret).toBeUndefined();
    // Non-secret field should be present
    expect(metadata.baseUrl).toBe('https://api.xero.com');
  });

  it('extras.webhookSecret lands in plaintext metadata', () => {
    const creds: ERPCredentials = {
      provider: 'alegra',
      apiKey: 'alegra-key',
    };

    const { metadata } = serializeCredentials(creds, {
      webhookSecret: 'wh-s3cret',
      enabled: true,
    });

    expect(metadata.webhookSecret).toBe('wh-s3cret');
    expect(metadata.enabled).toBe(true);
    // API key must NOT leak into metadata
    expect(metadata.apiKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('loadCredentials error handling', () => {
  it('throws with workspaceId in message on decrypt failure', () => {
    const row = makeRow('ws-FAIL-99', 'helisa', 'v1:gcm:bad:bad:bad', {});
    expect(() => loadCredentials(row)).toThrow('ws-FAIL-99');
  });

  it('throws with provider in message on decrypt failure', () => {
    const row = makeRow('ws-XYZ', 'sap_s4hana', 'v1:gcm:bad:bad:bad', {});
    expect(() => loadCredentials(row)).toThrow('sap_s4hana');
  });

  it('does NOT expose ciphertext in thrown message', () => {
    const row = makeRow('ws-XYZ', 'helisa', 'v1:gcm:bad:bad:bad', {});
    try {
      loadCredentials(row);
      expect.fail('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('v1:gcm:bad:bad:bad');
    }
  });
});

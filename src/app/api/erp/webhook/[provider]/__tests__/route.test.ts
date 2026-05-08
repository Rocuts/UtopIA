/**
 * Unit tests for POST /api/erp/webhook/[provider]
 *
 * Mocks:
 *   - @/lib/db/client     — getDb() returns a mock drizzle-like object
 *   - @/lib/erp/adapter   — ERPAdapter.fetchTrialBalance is a no-op
 *   - @/lib/cache/preprocessed-balance — getLatestOpenPeriod + getCachedPreprocessedBalance
 *   - next/cache          — revalidateTag is a spy
 *   - next/server         — after() calls the callback synchronously in tests
 *
 * We import the route handler directly and call it with synthetic NextRequest
 * objects. No network, no DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports of the module under test
// ---------------------------------------------------------------------------

// next/cache
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

// next/server — mock `after` to call the callback synchronously so we can
// await the side effects in tests without real background scheduling.
vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>();
  return {
    ...original,
    after: vi.fn((fn: () => Promise<void>) => fn()),
  };
});

// DB — return a mock that lets us control the rows returned by select()
const mockSelect = vi.fn();
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: mockSelect,
  }),
}));

// ERP adapter — fetchTrialBalance always resolves
vi.mock('@/lib/erp/adapter', () => ({
  ERPAdapter: vi.fn().mockImplementation(() => ({
    fetchTrialBalance: vi.fn().mockResolvedValue({}),
  })),
}));

// preprocessed-balance helpers
vi.mock('@/lib/cache/preprocessed-balance', () => ({
  getLatestOpenPeriod: vi.fn().mockResolvedValue(null),
  getCachedPreprocessedBalance: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';

function makeRequest(
  provider: string,
  body: unknown,
  token?: string,
): NextRequest {
  const url = `http://localhost/api/erp/webhook/${provider}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token !== undefined) {
    headers['x-webhook-token'] = token;
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Minimal valid CloudEvents payload */
const CE_PAYLOAD = {
  specversion: '1.0',
  type: 'sap.fi.trialbalance.changed.v1',
  source: '/sap/s4hana/financials',
  id: 'evt-001',
  time: '2026-05-08T12:00:00Z',
  data: { companyCode: '1000' },
};

/** Minimal valid Siigo webhook payload */
const SIIGO_PAYLOAD = {
  topic: 'AccountingDocument.Created',
  data: { documentId: 'doc-123', type: 'JournalEntry' },
  timestamp: '2026-05-08T12:00:00Z',
  company_id: 'siigo-co-001',
};

/** A credential row returned by the mock DB with matching webhookSecret */
const CRED_ROW = {
  id: 'cred-uuid-1',
  workspaceId: 'ws-uuid-1',
  provider: 'sap_s4hana',
  encryptedSecret: 'enc_secret',
  metadata: {
    webhookSecret: 'valid-token-123',
    companyId: '1000',
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  label: 'SAP Test',
};

// Chainable mock: db.select().from().where() → rows
function mockDbRows(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  mockSelect.mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Import route handler AFTER all mocks are declared
// ---------------------------------------------------------------------------

// Dynamic import so mocks are hoisted before module evaluation
const { POST } = await import('../route.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/erp/webhook/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when X-Webhook-Token header is missing', async () => {
    const req = makeRequest('sap_s4hana', CE_PAYLOAD); // no token header
    const params = Promise.resolve({ provider: 'sap_s4hana' });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/missing/i);
  });

  it('returns 401 when X-Webhook-Token does not match any credential', async () => {
    mockDbRows([CRED_ROW]); // webhookSecret = 'valid-token-123'
    const req = makeRequest('sap_s4hana', CE_PAYLOAD, 'wrong-token');
    const params = Promise.resolve({ provider: 'sap_s4hana' });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
  });

  // ─── Payload validation ───────────────────────────────────────────────────

  it('returns 400 when CloudEvents payload is invalid (missing required fields)', async () => {
    mockDbRows([CRED_ROW]);
    const badPayload = { specversion: '1.0' }; // missing type, source, id
    const req = makeRequest('sap_s4hana', badPayload, 'valid-token-123');
    const params = Promise.resolve({ provider: 'sap_s4hana' });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/validation failed/i);
  });

  it('returns 400 when Siigo payload is invalid (missing topic)', async () => {
    const siigoCredRow = { ...CRED_ROW, provider: 'siigo' };
    mockDbRows([siigoCredRow]);
    const badPayload = { data: { documentId: 'x' } }; // missing topic
    const req = makeRequest('siigo', badPayload, 'valid-token-123');
    const params = Promise.resolve({ provider: 'siigo' });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/validation failed/i);
  });

  it('returns 400 for an unknown provider slug', async () => {
    const req = makeRequest('nonexistent_erp', CE_PAYLOAD, 'any-token');
    const params = Promise.resolve({ provider: 'nonexistent_erp' });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown erp provider/i);
  });

  // ─── Success paths ────────────────────────────────────────────────────────

  it('returns 202 Accepted for valid SAP S/4HANA CloudEvents payload', async () => {
    mockDbRows([CRED_ROW]);
    const req = makeRequest('sap_s4hana', CE_PAYLOAD, 'valid-token-123');
    const params = Promise.resolve({ provider: 'sap_s4hana' });
    const res = await POST(req, { params });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.provider).toBe('sap_s4hana');
  });

  it('returns 202 Accepted for valid Oracle Fusion CloudEvents payload', async () => {
    const oracleCredRow = { ...CRED_ROW, provider: 'oracle_fusion' };
    mockDbRows([oracleCredRow]);
    const oraclePayload = {
      ...CE_PAYLOAD,
      type: 'oracle.erp.financials.trialbalance.updated',
      source: '/oracle/fusion/financials',
    };
    const req = makeRequest('oracle_fusion', oraclePayload, 'valid-token-123');
    const params = Promise.resolve({ provider: 'oracle_fusion' });
    const res = await POST(req, { params });
    expect(res.status).toBe(202);
  });

  it('returns 202 Accepted for valid Siigo topic+data payload', async () => {
    const siigoCredRow = { ...CRED_ROW, provider: 'siigo' };
    mockDbRows([siigoCredRow]);
    const req = makeRequest('siigo', SIIGO_PAYLOAD, 'valid-token-123');
    const params = Promise.resolve({ provider: 'siigo' });
    const res = await POST(req, { params });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.provider).toBe('siigo');
  });

  it('calls revalidateTag for workspace-balance and pillars after valid sync', async () => {
    const { revalidateTag } = await import('next/cache');
    mockDbRows([CRED_ROW]);
    const req = makeRequest('sap_s4hana', CE_PAYLOAD, 'valid-token-123');
    const params = Promise.resolve({ provider: 'sap_s4hana' });
    await POST(req, { params });
    expect(revalidateTag).toHaveBeenCalledWith('workspace-balance', 'max');
    expect(revalidateTag).toHaveBeenCalledWith(`pillars-${CRED_ROW.workspaceId}`, 'max');
  });
});

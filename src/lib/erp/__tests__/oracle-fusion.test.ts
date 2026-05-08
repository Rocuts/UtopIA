// ─── Oracle Fusion Connector Tests ───────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OracleFusionConnector } from '../providers/oracle-fusion';
import type { ERPCredentials } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CREDENTIALS: ERPCredentials = {
  provider: 'oracle_fusion',
  baseUrl: 'https://my-pod.oraclecloud.com',
  clientId: 'oracle-client-id',
  clientSecret: 'oracle-client-secret',
  tenantId: 'idcs-abc123.identity.oraclecloud.com',
  companyId: 'MY_LEDGER',
  // apiKey = natural account segment index
};

const TOKEN_RESPONSE = {
  access_token: 'oracle-bearer-token',
  token_type: 'Bearer',
  expires_in: 3600,
};

const makeBalance = (combo: string, ending: number, activity = ending) => ({
  LedgerName: 'MY_LEDGER',
  PeriodName: 'Dec-25',
  Currency: 'COP',
  DetailAccountCombination: combo,
  BeginningBalance: 0,
  PeriodActivity: activity,
  EndingBalance: ending,
  AmountType: 'PTD',
});

function makeResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OracleFusionConnector', () => {
  let connector: OracleFusionConnector;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    connector = new OracleFusionConnector();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('testConnection returns true on successful token fetch', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE));

    const result = await connector.testConnection(CREDENTIALS);
    expect(result).toBe(true);
  });

  it('testConnection returns false on auth error', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401));

    const result = await connector.testConnection(CREDENTIALS);
    expect(result).toBe(false);
  });

  it('fetchRawAccountRows paginates and extracts natural account from combination', async () => {
    // Combination "01.0.110505.0000" → split('.') = ["01","0","110505","0000"]
    // apiKey = "2" → segIdx=2 → segments[2] = "110505" ✓
    const page1 = {
      items: [
        makeBalance('01.0.110505.0000', 5_000_000),
        makeBalance('01.0.130505.0000', 12_000_000),
      ],
      hasMore: true,
      totalResults: 3,
      offset: 0,
      limit: 499,
    };
    const page2 = {
      items: [makeBalance('01.0.210505.0000', -8_000_000)],
      hasMore: false,
      totalResults: 3,
      offset: 499,
      limit: 499,
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(makeResponse(page1))
      .mockResolvedValueOnce(makeResponse(page2));

    const creds: ERPCredentials = { ...CREDENTIALS, apiKey: '2' };
    const rows = await connector.fetchRawAccountRows(creds, 'Dec-25', '2025');

    expect(rows).toHaveLength(3);
    expect(rows[0].code).toBe('110505');
    expect(rows[0].balancesByPeriod['2025']).toBe(5_000_000);
    expect(rows[2].balancesByPeriod['2025']).toBe(-8_000_000);
    expect(rows[0].level).toBe('Auxiliar');
    expect(rows[0].transactional).toBe(true);
  });

  it('applies pucMappingTable when provided', async () => {
    const page = {
      items: [makeBalance('01.0.GL9999.0000', 7_000_000)],
      hasMore: false, totalResults: 1, offset: 0, limit: 499,
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(makeResponse(page));

    const creds: ERPCredentials = { ...CREDENTIALS, apiKey: '2' };
    const mapping: Record<string, string> = { GL9999: '110505' };
    const rows = await connector.fetchRawAccountRows(creds, 'Dec-25', '2025', mapping);

    expect(rows[0].code).toBe('110505');
  });

  it('retries on 429 with Retry-After and eventually succeeds', async () => {
    const retryHeaders = new Headers({ 'Retry-After': '0' });
    const page = {
      items: [makeBalance('01.0.110505.0000', 1_000_000)],
      hasMore: false, totalResults: 1, offset: 0, limit: 499,
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}), text: () => Promise.resolve('TooMany'), headers: retryHeaders } as unknown as Response)
      .mockResolvedValueOnce(makeResponse(page));

    const creds: ERPCredentials = { ...CREDENTIALS, apiKey: '2' };
    const rows = await connector.fetchRawAccountRows(creds, 'Dec-25', '2025');
    expect(rows).toHaveLength(1);
  });

  it('throws on non-recoverable 4xx', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValue(makeResponse({ error: 'not found' }, false, 404));

    await expect(
      connector.fetchRawAccountRows(CREDENTIALS, 'Dec-25', '2025'),
    ).rejects.toThrow('404');
  });

  it('getTrialBalance returns ERPTrialBalance with correct mapping', async () => {
    const page = {
      items: [makeBalance('01.0.110505.0000', 3_000_000, 3_000_000)],
      hasMore: false, totalResults: 1, offset: 0, limit: 499,
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(makeResponse(page));

    const creds: ERPCredentials = { ...CREDENTIALS, apiKey: '2' };
    const tb = await connector.getTrialBalance(creds, '2025-12');
    expect(tb.period).toBe('2025-12');
    expect(tb.accounts[0].balance).toBe(3_000_000);
    expect(tb.accounts[0].debit).toBe(3_000_000);
  });

  it('returns false when tenantId is missing (validation absorbed by testConnection)', async () => {
    const creds: ERPCredentials = { ...CREDENTIALS, tenantId: undefined };

    // tokenEndpoint throws synchronously before HTTP; testConnection catches → false
    const result = await connector.testConnection(creds);
    expect(result).toBe(false);
    // fetch should NOT have been called — error thrown before HTTP
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

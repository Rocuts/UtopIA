// ─── SAP S/4HANA Connector Tests ─────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SAPS4HANAConnector } from '../providers/sap-s4hana';
import type { ERPCredentials } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CREDENTIALS: ERPCredentials = {
  provider: 'sap_s4hana',
  baseUrl: 'https://my-tenant.s4hana.ondemand.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  companyId: '1000',
};

const TOKEN_RESPONSE = {
  access_token: 'test-bearer-token',
  token_type: 'Bearer',
  expires_in: 3600,
};

const makeTrialBalanceItem = (glAccount: string, name: string, balance: string) => ({
  GLAccount: glAccount,
  AccountName: name,
  BalanceAmountInCompanyCodeCurrency: balance,
  DebitAmountInCompanyCodeCurrency: balance,
  CreditAmountInCompanyCodeCurrency: '0',
  FiscalYear: '2025',
  FiscalPeriod: '012',
  CompanyCode: '1000',
  CompanyCodeCurrency: 'COP',
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

describe('SAPS4HANAConnector', () => {
  let connector: SAPS4HANAConnector;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Fresh connector each test — per-instance token cache avoids bleeding
    connector = new SAPS4HANAConnector();
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
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('testConnection returns false on token fetch failure', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401));

    const result = await connector.testConnection(CREDENTIALS);
    expect(result).toBe(false);
  });

  it('fetchRawAccountRows fetches all pages and maps to RawAccountRow[]', async () => {
    const page1 = {
      d: {
        results: [
          makeTrialBalanceItem('110505', 'Caja General', '5000000'),
          makeTrialBalanceItem('130505', 'Clientes Nacionales', '12000000'),
        ],
        __count: '3',
        __next: 'https://my-tenant.s4hana.ondemand.com/sap/opu/odata/sap/C_TRIALBALANCE_CDS/C_TRIALBALANCE?$skip=2',
      },
    };
    const page2 = {
      d: {
        results: [makeTrialBalanceItem('210505', 'Proveedores Nacionales', '-8000000')],
        __count: '3',
      },
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))  // token
      .mockResolvedValueOnce(makeResponse(page1))            // page 1
      .mockResolvedValueOnce(makeResponse(page2));           // page 2

    const rows = await connector.fetchRawAccountRows(CREDENTIALS, '2025', '012');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      code: '110505',
      name: 'Caja General',
      level: 'Auxiliar',
      transactional: true,
    });
    expect(rows[0].balancesByPeriod['2025']).toBe(5_000_000);
    expect(rows[2].balancesByPeriod['2025']).toBe(-8_000_000);
  });

  it('applies pucMappingTable when provided', async () => {
    const page = {
      d: { results: [makeTrialBalanceItem('GL0110505', 'Caja', '1000')] },
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(makeResponse(page));

    const mapping: Record<string, string> = { GL0110505: '110505' };
    const rows = await connector.fetchRawAccountRows(CREDENTIALS, '2025', '012', mapping);

    expect(rows[0].code).toBe('110505');
  });

  it('retries on 429 and eventually succeeds', async () => {
    const retryHeaders = new Headers({ 'Retry-After': '0' });
    const page = { d: { results: [makeTrialBalanceItem('110505', 'Caja', '500')] } };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}), text: () => Promise.resolve('TooMany'), headers: retryHeaders } as unknown as Response)
      .mockResolvedValueOnce(makeResponse(page));

    const rows = await connector.fetchRawAccountRows(CREDENTIALS, '2025', '012');
    expect(rows).toHaveLength(1);
  });

  it('throws on non-recoverable 4xx from OData endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValue(makeResponse({ error: 'Forbidden' }, false, 403));

    await expect(
      connector.fetchRawAccountRows(CREDENTIALS, '2025', '012'),
    ).rejects.toThrow('403');
  });

  it('getTrialBalance returns ERPTrialBalance with correct period and accounts', async () => {
    const page = {
      d: { results: [makeTrialBalanceItem('110505', 'Caja', '3000000')] },
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(makeResponse(page));

    const tb = await connector.getTrialBalance(CREDENTIALS, '2025-12');
    expect(tb.period).toBe('2025-12');
    expect(tb.accounts).toHaveLength(1);
    expect(tb.accounts[0].balance).toBe(3_000_000);
  });
});

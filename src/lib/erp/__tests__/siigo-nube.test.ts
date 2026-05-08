// ─── Siigo Nube Connector Tests ───────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SiigoNubeConnector } from '../providers/siigo-nube';
import type { ERPCredentials } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CREDENTIALS: ERPCredentials = {
  provider: 'siigo',
  baseUrl: 'https://api.siigo.com',
  username: 'user@empresa.com',
  apiKey: 'access-key-secreto',
};

const AUTH_RESPONSE = {
  access_token: 'siigo-bearer-token',
  token_type: 'Bearer',
  expires_in: 86400,
};

const makeRow = (code: string, name: string, finalBalance: number, debit = finalBalance, credit = 0) => ({
  account: { identification: code, name },
  initial_balance: 0,
  debit,
  credit,
  final_balance: finalBalance,
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

describe('SiigoNubeConnector', () => {
  let connector: SiigoNubeConnector;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    connector = new SiigoNubeConnector();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('testConnection returns true on successful auth', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(AUTH_RESPONSE));

    const result = await connector.testConnection(CREDENTIALS);
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.siigo.com/auth',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('testConnection returns false on auth failure', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401));

    const result = await connector.testConnection(CREDENTIALS);
    expect(result).toBe(false);
  });

  it('fetchRawAccountRows paginates and returns correct RawAccountRow[]', async () => {
    const page1 = {
      page: 1, page_size: 100, total_results: 3,
      results: [
        makeRow('110505', 'Caja General', 5_000_000),
        makeRow('130505', 'Clientes Nacionales', 12_000_000),
      ],
    };
    const page2 = {
      page: 2, page_size: 100, total_results: 3,
      results: [makeRow('210505', 'Proveedores', -8_000_000, 0, 8_000_000)],
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(AUTH_RESPONSE))  // /auth
      .mockResolvedValueOnce(makeResponse(page1))           // page 1
      .mockResolvedValueOnce(makeResponse(page2));          // page 2

    const rows = await connector.fetchRawAccountRows(CREDENTIALS, 12, 2025);

    expect(rows).toHaveLength(3);
    // PUC nativo — sin transformacion
    expect(rows[0].code).toBe('110505');
    expect(rows[0].name).toBe('Caja General');
    expect(rows[0].level).toBe('Auxiliar');
    expect(rows[0].transactional).toBe(true);
    expect(rows[0].balancesByPeriod['2025']).toBe(5_000_000);
    // Pasivo — final_balance negativo
    expect(rows[2].code).toBe('210505');
    expect(rows[2].balancesByPeriod['2025']).toBe(-8_000_000);
  });

  it('sends Idempotency-Key and Partner-Id headers on trial balance POST', async () => {
    const singlePage = {
      page: 1, page_size: 100, total_results: 2,
      results: [
        makeRow('110505', 'Caja', 1_000_000),
        makeRow('130505', 'Clientes', 2_000_000),
      ],
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(makeResponse(singlePage));

    await connector.fetchRawAccountRows(CREDENTIALS, 12, 2025);

    // Second call is the trial balance POST
    const tbCallArgs = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = tbCallArgs[1].headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('UTOPIA-TB-2025-12-p1');
    expect(headers['Partner-Id']).toBe('UtopIA-NIIF');
  });

  it('waits 60s on 429 (via fake timers) and then succeeds', async () => {
    vi.useFakeTimers();

    const page = {
      page: 1, page_size: 100, total_results: 1,
      results: [makeRow('110505', 'Caja', 1_000_000)],
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}), text: () => Promise.resolve('TooMany'), headers: new Headers() } as unknown as Response)
      .mockResolvedValueOnce(makeResponse(page));

    const rowsPromise = connector.fetchRawAccountRows(CREDENTIALS, 12, 2025);

    // Advance past the 60s Siigo rate-limit wait
    await vi.advanceTimersByTimeAsync(61_000);

    const rows = await rowsPromise;
    expect(rows).toHaveLength(1);

    vi.useRealTimers();
  });

  it('throws descriptive error on non-recoverable 4xx from trial balance endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(AUTH_RESPONSE))
      .mockResolvedValue(makeResponse({ error: 'bad request' }, false, 400));

    await expect(
      connector.fetchRawAccountRows(CREDENTIALS, 12, 2025),
    ).rejects.toThrow('400');
  });

  it('getTrialBalance maps accounts correctly', async () => {
    const page = {
      page: 1, page_size: 100, total_results: 1,
      results: [makeRow('110505', 'Caja', 3_000_000, 3_000_000, 0)],
    };

    fetchMock
      .mockResolvedValueOnce(makeResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(makeResponse(page));

    const tb = await connector.getTrialBalance(CREDENTIALS, '2025-12');
    expect(tb.period).toBe('2025-12');
    expect(tb.currency).toBe('COP');
    expect(tb.accounts[0].code).toBe('110505');
    expect(tb.accounts[0].balance).toBe(3_000_000);
    expect(tb.accounts[0].isAuxiliary).toBe(true);
    expect(tb.totalDebit).toBe(3_000_000);
    expect(tb.totalCredit).toBe(0);
  });

  it('returns false when username is missing (validation absorbed by testConnection)', async () => {
    const badCreds: ERPCredentials = { ...CREDENTIALS, username: undefined };

    // getAccessToken throws before HTTP → testConnection catches → false
    const result = await connector.testConnection(badCreds);
    expect(result).toBe(false);
    // Validation error thrown before HTTP → fetch should not have been called
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

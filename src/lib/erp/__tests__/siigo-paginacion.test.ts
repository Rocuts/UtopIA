// ---------------------------------------------------------------------------
// ingesta-22 — paginación de Siigo Nube (test-balance-report) y Siigo
// alliances (listados). Se cuentan los registros realmente recibidos; sin
// total se itera hasta una página vacía; si el conteo final no coincide con
// el total, error explícito (nunca un balance o listado incompleto).
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SiigoConnector } from '../providers/siigo';
import { SiigoNubeConnector } from '../providers/siigo-nube';
import { ERPSessionStore, sharedERPSessionStore } from '../session-store';
import type { ERPCredentials } from '../types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const row = (code: string) => ({
  account: { identification: code, name: `Cuenta ${code}` },
  initial_balance: 0,
  debit: 100,
  credit: 0,
  final_balance: 100,
});

beforeEach(() => sharedERPSessionStore.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Siigo Nube — el servidor limita el tamaño de página', () => {
  const CREDS: ERPCredentials = { provider: 'siigo', baseUrl: 'https://api.siigo.com', username: 'u@x.co', apiKey: 'k' };

  function install(pages: Array<{ total_results: number; results: unknown[] }>) {
    const calls: string[] = [];
    let page = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).endsWith('/auth')) return json({ access_token: 't', token_type: 'Bearer', expires_in: 86400 });
        const p = pages[page++] ?? { total_results: pages[0]?.total_results ?? 0, results: [] };
        return json({ page, page_size: 2, ...p });
      }),
    );
    return calls;
  }

  it('página de 2 con total 5: lee las tres páginas (antes se detenía en 4 filas)', async () => {
    const calls = install([
      { total_results: 5, results: [row('110505'), row('110510')] },
      { total_results: 5, results: [row('130505'), row('130510')] },
      { total_results: 5, results: [row('140505')] },
    ]);
    const rows = await new SiigoNubeConnector().fetchRawAccountRows(CREDS, 12, 2025);
    expect(rows.map((r) => r.code)).toEqual(['110505', '110510', '130505', '130510', '140505']);
    expect(calls.filter((c) => c.includes('test-balance-report'))).toHaveLength(3);
  });

  it('una página vacía antes de completar el total: error explícito', async () => {
    install([
      { total_results: 5, results: [row('110505'), row('110510')] },
      { total_results: 5, results: [] },
    ]);
    await expect(new SiigoNubeConnector().fetchRawAccountRows(CREDS, 12, 2025)).rejects.toThrow(
      /paginación incompleta \(2 de 5 filas\)/,
    );
  });
});

describe('Siigo alliances — sin `pagination` se itera hasta una página vacía', () => {
  const CREDS: ERPCredentials = { provider: 'siigo', username: 'u@x.co', apiKey: 'k' };

  function install(pages: Array<{ results: unknown[]; pagination?: { page: number; page_size: number; total_results: number } }>) {
    let page = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/sign-in')) return json({ access_token: 't', token_type: 'Bearer', expires_in: 86400 });
        return json(pages[page++] ?? { results: [] });
      }),
    );
  }
  const acct = (id: number) => ({ id, code: `1105${String(id).padStart(2, '0')}`, name: `Cuenta ${id}` });

  it('sin total: lee todas las páginas (antes sólo la primera)', async () => {
    install([{ results: [acct(1), acct(2)] }, { results: [acct(3)] }, { results: [] }]);
    const accounts = await new SiigoConnector(new ERPSessionStore()).getChartOfAccounts(CREDS);
    expect(accounts).toHaveLength(3);
  });

  it('con total que no cuadra con lo recibido: error explícito', async () => {
    install([
      { results: [acct(1), acct(2)], pagination: { page: 1, page_size: 2, total_results: 4 } },
      { results: [], pagination: { page: 2, page_size: 2, total_results: 4 } },
    ]);
    await expect(new SiigoConnector(new ERPSessionStore()).getChartOfAccounts(CREDS)).rejects.toThrow(
      /paginación incompleta \(2 de 4 registros\)/,
    );
  });

  it('con total: se detiene al completarlo', async () => {
    install([
      { results: [acct(1), acct(2)], pagination: { page: 1, page_size: 2, total_results: 3 } },
      { results: [acct(3)], pagination: { page: 2, page_size: 2, total_results: 3 } },
    ]);
    expect(await new SiigoConnector(new ERPSessionStore()).getChartOfAccounts(CREDS)).toHaveLength(3);
  });
});

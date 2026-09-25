// ─── ingesta-13: aislamiento de token/sesión por conexión ────────────────────
// Dos empresas del mismo proveedor, atendidas en paralelo (y en secuencia) por
// el mismo proceso, deben usar cada una su propio token/sesión y recibir sus
// propios datos. La prueba cubre todos los conectores con estado de auth.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getConnector } from '../registry';
import { ERPSessionStore, sharedERPSessionStore, credentialFingerprint } from '../session-store';
import { SiigoConnector } from '../providers/siigo';
import { SiigoNubeConnector } from '../providers/siigo-nube';
import { OracleFusionConnector } from '../providers/oracle-fusion';
import type { BaseERPConnector } from '../connector';
import type { ERPCredentials, ERPProvider } from '../types';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

const header = (init: RequestInit | undefined, name: string): string =>
  String((init?.headers as Record<string, string> | undefined)?.[name] ?? '');

const basicUser = (init: RequestInit | undefined): string =>
  Buffer.from(header(init, 'Authorization').replace(/^Basic /, ''), 'base64').toString();

/** Pequeña espera aleatoria para intercalar las peticiones de A y B. */
const jitter = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));

interface ProviderCase {
  provider: ERPProvider;
  a: ERPCredentials;
  b: ERPCredentials;
  /** Identidad que el token/sesión de estas credenciales debe llevar. */
  identity: (c: ERPCredentials) => string;
  /** Respuesta simulada del ERP; devuelve undefined si la URL no es suya. */
  handle: (url: string, init: RequestInit | undefined) => Promise<unknown> | unknown;
  /** Lee del resultado la identidad con la que el ERP atendió la petición. */
  run: (connector: BaseERPConnector, c: ERPCredentials) => Promise<string>;
}

const CASES: ProviderCase[] = [
  {
    provider: 'siigo',
    a: { provider: 'siigo', username: 'empresaA@x.co', apiKey: 'kA' },
    b: { provider: 'siigo', username: 'empresaB@x.co', apiKey: 'kB' },
    identity: (c) => `tok:${c.username}:${c.apiKey}`,
    handle: (url, init) => {
      if (url.includes('/sign-in')) {
        const body = JSON.parse(String(init?.body));
        return { access_token: `tok:${body.userName}:${body.accessKey}`, token_type: 'Bearer', expires_in: 86400 };
      }
      if (url.includes('/v1/accounts')) {
        const who = header(init, 'Authorization').replace(/^Bearer /, '');
        return { results: [{ id: 1, code: '110505', name: who }], pagination: { page: 1, page_size: 100, total_results: 1 } };
      }
    },
    run: async (c, creds) => (await c.getChartOfAccounts(creds))[0].name,
  },
  {
    provider: 'contapyme',
    a: { provider: 'contapyme', baseUrl: 'https://cp.example.com', username: 'ua', password: 'pa', companyId: 'EA' },
    b: { provider: 'contapyme', baseUrl: 'https://cp.example.com', username: 'ub', password: 'pb', companyId: 'EB' },
    identity: (c) => `tok:${c.username}:${c.password}:${c.companyId}|Empresa ${c.companyId}|nit-${c.companyId}`,
    handle: (url, init) => {
      if (url.endsWith('/GetAuth')) {
        const body = JSON.parse(String(init?.body));
        return {
          token: `tok:${body.usuario}:${body.clave}:${body.empresa}`,
          empresa: `Empresa ${body.empresa}`,
          nit: `nit-${body.empresa}`,
          expires: 3600,
        };
      }
      if (url.includes('/BalanceComprobacion')) {
        const who = header(init, 'Authorization').replace(/^Token /, '');
        return { periodo: '2025-01', cuentas: [
          { codigo: '110505', nombre: who, saldoAnterior: 0, debitos: 10, creditos: 0, saldoFinal: 10 },
        ] };
      }
    },
    // Además del dato, el nombre y NIT de la empresa deben salir de SU sesión.
    run: async (c, creds) => {
      const tb = await c.getTrialBalance(creds, '2025-01');
      return `${tb.accounts[0].name}|${tb.companyName}|${tb.companyNit}`;
    },
  },
  {
    provider: 'sap_b1',
    a: { provider: 'sap_b1', baseUrl: 'https://sap.example.com', username: 'ua', password: 'pa', databaseName: 'DBA' },
    b: { provider: 'sap_b1', baseUrl: 'https://sap.example.com', username: 'ub', password: 'pb', databaseName: 'DBB' },
    identity: (c) => `sess:${c.databaseName}:${c.password}`,
    handle: (url, init) => {
      if (url.endsWith('/b1s/v1/Login')) {
        const body = JSON.parse(String(init?.body));
        return { SessionId: `sess:${body.CompanyDB}:${body.Password}`, SessionTimeout: 30 };
      }
      if (url.includes('/ChartOfAccounts')) {
        const who = header(init, 'Cookie').replace(/^B1SESSION=/, '');
        return { value: [{ Code: '110505', Name: who, Balance: 0, AccountType: 'at_Other', ActiveAccount: 'tYES', Levels: 5 }] };
      }
    },
    run: async (c, creds) => (await c.getChartOfAccounts(creds))[0].name,
  },
  {
    provider: 'odoo',
    a: { provider: 'odoo', baseUrl: 'https://odoo.example.com', username: 'ua', password: 'pa', databaseName: 'dba' },
    b: { provider: 'odoo', baseUrl: 'https://odoo.example.com', username: 'ub', password: 'pb', databaseName: 'dbb' },
    identity: (c) => `sess:${c.databaseName}:${c.password}`,
    handle: (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.endsWith('/web/session/authenticate')) {
        const p = body.params;
        return { jsonrpc: '2.0', id: body.id, result: { uid: 7, session_id: `sess:${p.db}:${p.password}`, company_id: 1 } };
      }
      if (url.endsWith('/web/dataset/call_kw')) {
        const who = header(init, 'Cookie').replace(/^session_id=/, '');
        return { jsonrpc: '2.0', id: body.id, result: [{ id: 1, code: '110505', name: who, internal_group: 'asset' }] };
      }
    },
    run: async (c, creds) => (await c.getChartOfAccounts(creds))[0].name,
  },
  {
    provider: 'xero',
    a: { provider: 'xero', clientId: 'ca', clientSecret: 'sa', refreshToken: 'ra', tenantId: 'ta' },
    b: { provider: 'xero', clientId: 'cb', clientSecret: 'sb', refreshToken: 'rb', tenantId: 'tb' },
    identity: (c) => `tok:${c.clientId}:${c.clientSecret}:${c.refreshToken}|${c.tenantId}`,
    handle: (url, init) => {
      if (url.startsWith('https://identity.xero.com/')) {
        const refresh = new URLSearchParams(String(init?.body)).get('refresh_token');
        return { access_token: `tok:${basicUser(init)}:${refresh}`, refresh_token: `${refresh}-rot`, token_type: 'Bearer', expires_in: 1800 };
      }
      if (url.includes('api.xero.com') && url.includes('/Accounts')) {
        const who = `${header(init, 'Authorization').replace(/^Bearer /, '')}|${header(init, 'xero-tenant-id')}`;
        return { Accounts: [{ AccountID: 'id', Code: '200', Name: who, Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE' }] };
      }
    },
    run: async (c, creds) => (await c.getChartOfAccounts(creds))[0].name,
  },
  {
    provider: 'quickbooks',
    a: { provider: 'quickbooks', clientId: 'ca', clientSecret: 'sa', refreshToken: 'ra', companyId: 'realmA' },
    b: { provider: 'quickbooks', clientId: 'cb', clientSecret: 'sb', refreshToken: 'rb', companyId: 'realmB' },
    identity: (c) => `tok:${c.clientId}:${c.clientSecret}:${c.refreshToken}`,
    handle: (url, init) => {
      if (url.startsWith('https://oauth.platform.intuit.com/')) {
        const refresh = new URLSearchParams(String(init?.body)).get('refresh_token');
        return { access_token: `tok:${basicUser(init)}:${refresh}`, refresh_token: refresh, token_type: 'bearer', expires_in: 3600 };
      }
      if (url.includes('quickbooks.api.intuit.com') && url.includes('/query')) {
        const who = header(init, 'Authorization').replace(/^Bearer /, '');
        return { QueryResponse: { Account: [{
          Id: '1', Name: who, AccountType: 'Bank', AccountSubType: 'Checking', AcctNum: '110505',
          CurrentBalance: 0, Active: true, Classification: 'Asset',
        }] } };
      }
    },
    run: async (c, creds) => (await c.getChartOfAccounts(creds))[0].name,
  },
  {
    provider: 'dynamics_365',
    a: { provider: 'dynamics_365', tenantId: 'tA', clientId: 'cA', clientSecret: 'sA', companyId: 'compA' },
    b: { provider: 'dynamics_365', tenantId: 'tB', clientId: 'cB', clientSecret: 'sB', companyId: 'compB' },
    identity: (c) => `tok:${c.clientId}:${c.clientSecret}`,
    handle: (url, init) => {
      if (url.startsWith('https://login.microsoftonline.com/')) {
        const body = new URLSearchParams(String(init?.body));
        return { access_token: `tok:${body.get('client_id')}:${body.get('client_secret')}`, token_type: 'Bearer', expires_in: 3600 };
      }
      if (url.includes('api.businesscentral.dynamics.com') && url.includes('/accounts')) {
        const who = header(init, 'Authorization').replace(/^Bearer /, '');
        return { value: [{ id: '1', number: '110505', displayName: who, category: 'Assets', subCategory: '', blocked: false, accountType: 'Posting', directPosting: true, netChange: 0 }] };
      }
    },
    run: async (c, creds) => (await c.getChartOfAccounts(creds))[0].name,
  },
  {
    provider: 'sap_s4hana',
    // Mismo client id y URL: sólo cambian el secreto y la sociedad.
    a: { provider: 'sap_s4hana', baseUrl: 'https://s4.example.com', clientId: 'comm-user', clientSecret: 'sA', companyId: '1000' },
    b: { provider: 'sap_s4hana', baseUrl: 'https://s4.example.com', clientId: 'comm-user', clientSecret: 'sB', companyId: '2000' },
    identity: (c) => `tok:${c.clientId}:${c.clientSecret}`,
    handle: (url, init) => {
      if (url.endsWith('/sap/bc/sec/oauth2/token')) {
        return { access_token: `tok:${basicUser(init)}`, token_type: 'Bearer', expires_in: 3600 };
      }
      if (url.includes('C_TRIALBALANCE')) {
        const who = header(init, 'Authorization').replace(/^Bearer /, '');
        return { d: { results: [{
          GLAccount: '110505', AccountName: who, BalanceAmountInCompanyCodeCurrency: '10',
          DebitAmountInCompanyCodeCurrency: '10', CreditAmountInCompanyCodeCurrency: '0',
          FiscalYear: '2025', FiscalPeriod: '012', CompanyCode: '1000', CompanyCodeCurrency: 'COP',
        }] } };
      }
    },
    run: async (c, creds) => (await c.getTrialBalance(creds, '2025-12')).accounts[0].name,
  },
  {
    provider: 'oracle_fusion',
    a: { provider: 'oracle_fusion', baseUrl: 'https://pod.oraclecloud.com', tenantId: 'idcs-a.identity.oraclecloud.com', clientId: 'c', clientSecret: 'sA', companyId: 'LEDGER_A', apiKey: '2' },
    b: { provider: 'oracle_fusion', baseUrl: 'https://pod.oraclecloud.com', tenantId: 'idcs-a.identity.oraclecloud.com', clientId: 'c', clientSecret: 'sB', companyId: 'LEDGER_B', apiKey: '2' },
    identity: (c) => `tok:${c.clientId}:${c.clientSecret}`,
    handle: (url, init) => {
      if (url.endsWith('/oauth2/v1/token')) {
        return { access_token: `tok:${basicUser(init)}`, token_type: 'Bearer', expires_in: 3600 };
      }
      if (url.includes('ledgerBalances')) {
        const who = header(init, 'Authorization').replace(/^Bearer /, '');
        return { items: [{
          LedgerName: 'L', PeriodName: 'Dec-25', Currency: 'COP', DetailAccountCombination: `01.0.110505.${who}`,
          BeginningBalance: 0, PeriodActivity: 10, EndingBalance: 10, AmountType: 'PTD',
        }], hasMore: false, totalResults: 1, offset: 0, limit: 499 };
      }
    },
    run: async (c, creds) =>
      (await c.getTrialBalance(creds, '2025-12')).accounts[0].name.replace(/^01\.0\.110505\./, ''),
  },
];

function installFetch(testCase: ProviderCase) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    await jitter();
    const data = await testCase.handle(String(url), init);
    if (data === undefined) return json({ error: `unexpected ${url}` }, 404);
    return json(data);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  sharedERPSessionStore.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ingesta-13 — cada conexión usa su propio token/sesión', () => {
  it('getConnector devuelve una instancia nueva por llamada', async () => {
    const c1 = await getConnector('siigo');
    const c2 = await getConnector('siigo');
    expect(c1).not.toBe(c2);
  });

  it.each(CASES.map((c) => [c.provider, c] as const))(
    '%s: empresa A y luego empresa B (proceso compartido) — B no recibe la sesión de A',
    async (_provider, testCase) => {
      installFetch(testCase);
      const first = await getConnector(testCase.provider);
      expect(await testCase.run(first, testCase.a)).toBe(testCase.identity(testCase.a));
      const second = await getConnector(testCase.provider);
      expect(await testCase.run(second, testCase.b)).toBe(testCase.identity(testCase.b));
    },
  );

  it.each(CASES.map((c) => [c.provider, c] as const))(
    '%s: dos empresas en paralelo sobre la MISMA instancia reciben cada una sus datos',
    async (_provider, testCase) => {
      installFetch(testCase);
      const connector = await getConnector(testCase.provider);
      const runs = await Promise.all([
        testCase.run(connector, testCase.a),
        testCase.run(connector, testCase.b),
        testCase.run(connector, testCase.a),
        testCase.run(connector, testCase.b),
      ]);
      expect(runs).toEqual([
        testCase.identity(testCase.a),
        testCase.identity(testCase.b),
        testCase.identity(testCase.a),
        testCase.identity(testCase.b),
      ]);
    },
  );

  it('reutiliza el token vigente sólo para las mismas credenciales', async () => {
    const siigo = CASES[0];
    const calls = installFetch(siigo);
    const connector = new SiigoConnector(new ERPSessionStore());
    await siigo.run(connector, siigo.a);
    await siigo.run(connector, siigo.a);
    expect(calls.filter((u) => u.includes('/sign-in'))).toHaveLength(1);
    // Mismo usuario, otro access key: nunca el token emitido para kA.
    const wrongSecret: ERPCredentials = { ...siigo.a, apiKey: 'otra-clave' };
    expect(await siigo.run(connector, wrongSecret)).toBe(siigo.identity(wrongSecret));
    expect(calls.filter((u) => u.includes('/sign-in'))).toHaveLength(2);
  });

  it('testConnection autentica contra el ERP aunque haya un token en caché', async () => {
    const siigo = CASES[0];
    const calls = installFetch(siigo);
    const connector = await getConnector('siigo');
    await siigo.run(connector, siigo.a);
    expect(await connector.testConnection(siigo.a)).toBe(true);
    expect(calls.filter((u) => u.includes('/sign-in'))).toHaveLength(2);
  });

  it('Siigo Nube y Oracle: el mismo usuario/client id con otro secreto no hereda el token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth')) {
        const body = JSON.parse(String(init?.body));
        return json({ access_token: `tok:${body.username}:${body.access_key}`, token_type: 'Bearer', expires_in: 86400 });
      }
      return json({ access_token: `tok:${basicUser(init)}`, token_type: 'Bearer', expires_in: 3600 });
    }));
    const store = new ERPSessionStore();
    const nube = new SiigoNubeConnector(store);
    const base = { provider: 'siigo' as const, baseUrl: 'https://api.siigo.com', username: 'u@x.co' };
    expect(await nube.getAccessToken({ ...base, apiKey: 'k1' })).toBe('tok:u@x.co:k1');
    expect(await nube.getAccessToken({ ...base, apiKey: 'k2' })).toBe('tok:u@x.co:k2');

    const oracle = new OracleFusionConnector(store);
    const ob = { provider: 'oracle_fusion' as const, tenantId: 'idcs-a.identity.oraclecloud.com', clientId: 'c' };
    expect(await oracle.getAccessToken({ ...ob, clientSecret: 's1', companyId: 'P1' })).toBe('tok:c:s1');
    expect(await oracle.getAccessToken({ ...ob, clientSecret: 's2', companyId: 'P2' })).toBe('tok:c:s2');
  });

  it('la huella cambia con cualquier campo de identidad o secreto y no contiene secretos', () => {
    const base: ERPCredentials = { provider: 'siigo', username: 'u', apiKey: 'secreto-123' };
    const fp = credentialFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain('secreto');
    for (const change of [
      { apiKey: 'otro' }, { username: 'v' }, { companyId: 'X' }, { baseUrl: 'https://b' },
      { tenantId: 't' }, { databaseName: 'd' }, { clientSecret: 's' }, { refreshToken: 'r' },
    ]) {
      expect(credentialFingerprint({ ...base, ...change })).not.toBe(fp);
    }
    expect(credentialFingerprint({ ...base, provider: 'alegra' })).not.toBe(fp);
  });
});

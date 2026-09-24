// ─── ingesta-14/15/16/17/19/20/21: contenido del balance que entrega cada ERP ─

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getConnector } from '../registry';
import { sharedERPSessionStore } from '../session-store';
import { trialBalanceToCSV, trialBalanceToRawRows, formatErpAmount } from '../trial-balance-serialization';
import { resolveERPPeriod, ERPPeriodError } from '../period';
import { pucTypeFromCode, leafCodes } from '../puc';
import { pullTrialBalanceForPeriod } from '../pipeline';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { ERPAccount, ERPCredentials, ERPProvider, ERPTrialBalance } from '../types';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

type Route = (url: string, init: RequestInit | undefined) => unknown;

function stubFetch(route: Route) {
  const urls: string[] = [];
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(String(init?.body ?? ''));
    const data = route(String(url), init);
    return data === undefined ? json({ error: 'not found' }, 404) : json(data);
  }));
  return { urls, bodies };
}

const acc = (code: string, balance: number, extra: Partial<ERPAccount> = {}): ERPAccount => ({
  code, name: `Cuenta ${code}`, type: pucTypeFromCode(code), balance, debit: 0, credit: 0,
  level: 5, isAuxiliary: true, ...extra,
});

const completeTB = (accounts: ERPAccount[], period = '2025-12'): ERPTrialBalance => ({
  period, companyName: 'X', currency: 'COP', totalDebit: 0, totalCredit: 0, generatedAt: '',
  accounts, balanceStatus: 'complete', balanceStatusReason: null, warnings: [],
});

beforeEach(() => sharedERPSessionStore.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── ingesta-14 ───────────────────────────────────────────────────────────────

const JOURNAL_ONLY: Array<{ provider: ERPProvider; creds: ERPCredentials; route: Route }> = [
  {
    provider: 'alegra',
    creds: { provider: 'alegra', username: 'u@x.co', apiToken: 't' },
    route: (url) => {
      if (url.includes('/accounts')) {
        return url.includes('start=0') ? [
          { id: 1, code: '11050501', name: 'Caja general' },
          { id: 2, code: '41350501', name: 'Venta de mercancias' },
          { id: 3, code: '13050501', name: 'Clientes' },
        ] : [];
      }
      if (url.includes('/journal-entries')) {
        return url.includes('start=0') ? [{ id: 10, date: '2025-12-15', accounts: [
          { account: { id: 3, name: 'Clientes', code: '13050501' }, debit: 1_000_000, credit: 0 },
          { account: { id: 2, name: 'Ventas', code: '41350501' }, debit: 0, credit: 1_000_000 },
        ] }] : [];
      }
    },
  },
  {
    provider: 'siigo',
    creds: { provider: 'siigo', username: 'u@x.co', apiKey: 'k' },
    route: (url) => {
      if (url.includes('/sign-in')) return { access_token: 'tok', token_type: 'Bearer', expires_in: 86400 };
      if (url.includes('/v1/accounts')) {
        return { results: [{ id: 1, code: '13050501', name: 'Clientes' }], pagination: { page: 1, page_size: 100, total_results: 1 } };
      }
      if (url.includes('/v1/journals')) {
        return { results: [{ id: 1, date: '2025-12-15', items: [
          { account: { code: '13050501', name: 'Clientes' }, debit: 1_000_000, credit: 0 },
          { account: { code: '41350501', name: 'Ventas' }, debit: 0, credit: 1_000_000 },
        ] }], pagination: { page: 1, page_size: 100, total_results: 1 } };
      }
    },
  },
  {
    provider: 'world_office',
    creds: { provider: 'world_office', baseUrl: 'https://wo.example.com/api', accessToken: 'jwt' },
    route: (url) => {
      if (url.includes('/Contabilidad/PlanCuentas')) {
        return { Data: [{ Id: 1, Codigo: '13050501', Nombre: 'Clientes', EsAuxiliar: true }], Total: 1, Page: 1, PageSize: 100 };
      }
      if (url.includes('/Contabilidad/Comprobantes')) {
        return { Data: [{ Id: 1, Numero: 1, Fecha: '2025-12-15', Detalles: [
          { CuentaCodigo: '13050501', CuentaNombre: 'Clientes', Debito: 1_000_000, Credito: 0 },
          { CuentaCodigo: '41350501', CuentaNombre: 'Ventas', Debito: 0, Credito: 1_000_000 },
        ] }], Total: 1, Page: 1, PageSize: 100 };
      }
    },
  },
  {
    provider: 'sap_b1',
    creds: { provider: 'sap_b1', baseUrl: 'https://sap.example.com', username: 'u', password: 'p', databaseName: 'DB' },
    route: (url) => {
      if (url.endsWith('/Login')) return { SessionId: 's', SessionTimeout: 30 };
      if (url.includes('/ChartOfAccounts')) {
        return { value: [{ Code: '13050501', Name: 'Clientes', Balance: 9_999, AccountType: 'at_Other', ActiveAccount: 'tYES', Levels: 5 }] };
      }
      if (url.includes('/CompanyService_GetAdminInfo')) return { LocalCurrency: 'COP' };
      if (url.includes('/JournalEntries')) {
        return { value: [{ JdtNum: 1, RefDate: '2025-12-15', Memo: '', JournalEntryLines: [
          { AccountCode: '13050501', ShortName: 'Clientes', Debit: 1_000_000, Credit: 0 },
          { AccountCode: '41350501', ShortName: 'Ventas', Debit: 0, Credit: 1_000_000 },
        ] }] };
      }
    },
  },
  {
    provider: 'dynamics_365',
    creds: { provider: 'dynamics_365', tenantId: 't', clientId: 'c', clientSecret: 's', companyId: 'co' },
    route: (url) => {
      if (url.startsWith('https://login.microsoftonline.com/')) return { access_token: 'tok', expires_in: 3600 };
      if (url.includes('/companyInformation')) return { value: [{ currencyCode: 'COP' }] };
      if (url.includes('/accounts')) {
        return { value: [{ id: '1', number: '13050501', displayName: 'Clientes', category: 'Assets', blocked: false, netChange: 0 }] };
      }
      if (url.includes('/generalLedgerEntries')) {
        return { value: [
          { id: '1', entryNumber: 1, postingDate: '2025-12-15', documentNumber: 'D1', documentType: '', accountId: '1', accountNumber: '13050501', description: 'x', debitAmount: 1_000_000, creditAmount: 0 },
          { id: '2', entryNumber: 2, postingDate: '2025-12-15', documentNumber: 'D1', documentType: '', accountId: '2', accountNumber: '41350501', description: 'x', debitAmount: 0, creditAmount: 1_000_000 },
        ] };
      }
    },
  },
  {
    provider: 'odoo',
    creds: { provider: 'odoo', baseUrl: 'https://odoo.example.com', username: 'u', password: 'p', databaseName: 'db' },
    route: (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.endsWith('/web/session/authenticate')) {
        return { jsonrpc: '2.0', id: body.id, result: { uid: 1, session_id: 's', company_id: 1 } };
      }
      const model = body.params?.model;
      if (model === 'account.account') {
        return { jsonrpc: '2.0', id: body.id, result: [
          { id: 1, code: '13050501', name: 'Clientes', internal_group: 'asset' },
          { id: 2, code: '41350501', name: 'Ventas', internal_group: 'income' },
        ] };
      }
      if (model === 'res.company') return { jsonrpc: '2.0', id: body.id, result: [{ currency_id: [8, 'COP'] }] };
      if (model === 'account.move.line') {
        return { jsonrpc: '2.0', id: body.id, result: [
          { id: 1, account_id: [1, '13050501 Clientes'], debit: 1_000_000, credit: 0, balance: 1_000_000 },
          { id: 2, account_id: [2, '41350501 Ventas'], debit: 0, credit: 1_000_000, balance: -1_000_000 },
        ] };
      }
    },
  },
];

describe('ingesta-14 — movimientos del mes no se presentan como balance de prueba', () => {
  it.each(JOURNAL_ONLY.map((c) => [c.provider, c] as const))(
    '%s: el informe queda marcado movements_only con motivo y no se serializa al pipeline',
    async (_p, testCase) => {
      stubFetch(testCase.route);
      const connector = await getConnector(testCase.provider);
      const tb = await connector.getTrialBalance(testCase.creds, '2025-12');
      expect(tb.balanceStatus).toBe('movements_only');
      expect(tb.balanceStatusReason).toMatch(/movimientos del periodo/);
      expect(() => trialBalanceToCSV(tb)).toThrow(/saldos finales completos/);
      expect(() => trialBalanceToRawRows(tb)).toThrow(/saldos finales completos/);
      // Las cifras que sí trae son los movimientos agregados del periodo.
      const byCode = Object.fromEntries(tb.accounts.map((a) => [a.code, a]));
      expect(byCode['13050501'].debit).toBe(1_000_000);
      expect(byCode['41350501'].credit).toBe(1_000_000);
    },
  );

  it('pullTrialBalanceForPeriod (ERP → pipeline) rechaza el informe de movimientos con su motivo', async () => {
    const alegra = JOURNAL_ONLY[0];
    stubFetch(alegra.route);
    await expect(pullTrialBalanceForPeriod([{
      id: 'conn-1', provider: 'alegra', companyName: 'X', status: 'connected', createdAt: '2026-01-01',
      credentials: alegra.creds,
    }], '2025-12')).rejects.toThrow(/no se puede usar como balance de prueba.*movimientos del periodo/);
  });

  it('ContaPyme: saldo final = saldo inicial + débitos − créditos → balance completo', async () => {
    stubFetch((url) => {
      if (url.endsWith('/GetAuth')) return { token: 't', empresa: 'Empresa', nit: '900', expires: 3600 };
      if (url.includes('/BalanceComprobacion')) {
        return { empresa: 'Empresa', cuentas: [
          { codigo: '110505', nombre: 'Caja', saldoAnterior: 50_000_000, debitos: 0, creditos: 0, saldoFinal: 50_000_000 },
          { codigo: '310505', nombre: 'Capital', saldoAnterior: -50_000_000, debitos: 0, creditos: 0, saldoFinal: -50_000_000 },
        ] };
      }
    });
    const connector = await getConnector('contapyme');
    const tb = await connector.getTrialBalance({ provider: 'contapyme', baseUrl: 'https://cp.example.com', username: 'u', password: 'p' }, '2025-12');
    expect(tb.balanceStatus).toBe('complete');
    // La caja con saldo y sin movimiento conserva su saldo final.
    expect(tb.accounts.find((a) => a.code === '110505')?.balance).toBe(50_000_000);
  });

  it('ContaPyme: saldo final inconsistente con saldo inicial + movimientos → parcial con motivo', async () => {
    stubFetch((url) => {
      if (url.endsWith('/GetAuth')) return { token: 't', expires: 3600 };
      if (url.includes('/BalanceComprobacion')) {
        return { empresa: 'E', cuentas: [
          { codigo: '110505', nombre: 'Caja', saldoAnterior: 100, debitos: 50, creditos: 0, saldoFinal: 120 },
        ] };
      }
    });
    const connector = await getConnector('contapyme');
    const tb = await connector.getTrialBalance({ provider: 'contapyme', baseUrl: 'https://cp.example.com', username: 'u', password: 'p' }, '2025-12');
    expect(tb.balanceStatus).toBe('partial');
    expect(tb.balanceStatusReason).toMatch(/110505/);
    expect(() => trialBalanceToCSV(tb)).toThrow(/saldos finales completos/);
  });
});

// ─── ingesta-15 ───────────────────────────────────────────────────────────────

describe('ingesta-15 — hojas por jerarquía real, no por longitud del código', () => {
  const hierarchical = completeTB([
    acc('110505', 300_000), acc('11050501', 100_000), acc('11050502', 200_000),
    acc('220505', 100_000), acc('22050501', 100_000),
    acc('310505', 200_000), acc('31050501', 200_000),
    acc('130505', 0),
  ]);

  it('el CSV sólo emite hojas: subcuenta + auxiliares no se suman dos veces', () => {
    const rows = parseTrialBalanceCSV(trialBalanceToCSV(hierarchical));
    expect(rows.map((r) => r.code).sort()).toEqual(['11050501', '11050502', '130505', '22050501', '31050501']);
    const ct = preprocessTrialBalance(rows).primary.controlTotals;
    expect(ct.activo).toBe(300_000);
    expect(ct.pasivo).toBe(100_000);
    expect(ct.patrimonio).toBe(200_000);
  });

  it('una cuenta de 6 dígitos sin auxiliares sigue siendo hoja (no se descarta)', () => {
    expect(trialBalanceToRawRows(hierarchical).some((r) => r.code === '130505')).toBe(true);
  });

  it('ignora un isAuxiliary heredado por longitud en el padre', () => {
    const leaves = leafCodes(hierarchical.accounts);
    expect(leaves.has('110505')).toBe(false);
    expect(leaves.has('11050501')).toBe(true);
  });

  it('parentCode declarado por el ERP también excluye al padre', () => {
    const leaves = leafCodes([
      { code: '9001', parentCode: undefined },
      { code: '9002', parentCode: '9001' },
    ]);
    expect([...leaves]).toEqual(['9002']);
  });

  it('Helisa: informe con subcuenta y auxiliares no duplica saldos', async () => {
    stubFetch((url) => {
      if (url.includes('/summary/balanceSheet')) {
        return { empresa: 'H', items: [
          { codigo: '110505', nombre: 'Caja', debitos: 0, creditos: 0, saldo: 300_000 },
          { codigo: '11050501', nombre: 'Caja 1', debitos: 0, creditos: 0, saldo: 100_000 },
          { codigo: '11050502', nombre: 'Caja 2', debitos: 0, creditos: 0, saldo: 200_000 },
        ] };
      }
      if (url.includes('/summary/incomeStatement')) return { items: [] };
    });
    const connector = await getConnector('helisa');
    const tb = await connector.getTrialBalance({ provider: 'helisa', baseUrl: 'https://h.example.com/KansasWS', apiKey: 'k', companyId: '1' }, '2025-12');
    expect(tb.accounts.filter((a) => a.isAuxiliary).map((a) => a.code)).toEqual(['11050501', '11050502']);
    const leafSum = trialBalanceToRawRows(tb).reduce((s, r) => s + r.balancesByPeriod['2025-12'], 0);
    expect(leafSum).toBe(300_000);
  });
});

// ─── ingesta-16 ───────────────────────────────────────────────────────────────

describe('ingesta-16 — importes serializados a centavos con ida y vuelta exacta', () => {
  it('formato: enteros tal cual, fracciones con dos decimales, sin notación científica', () => {
    expect(formatErpAmount(100.1 + 200.2)).toBe('300.30');
    expect(formatErpAmount(1_500_000)).toBe('1500000');
    expect(formatErpAmount(-8_000_000)).toBe('-8000000');
    expect(formatErpAmount(0.1 + 0.2)).toBe('0.30');
    expect(formatErpAmount(-0.004)).toBe('0');
    expect(formatErpAmount(12_345_678_901_234.5)).toBe('12345678901234.50');
    expect(formatErpAmount(1e-7)).toBe('0');
  });

  it('ruido IEEE-754 (100.10 + 200.20) no infla el saldo al re-parsear', () => {
    const noisy = 100.1 + 200.2;
    const tb = completeTB([
      acc('11050501', noisy, { debit: noisy }), acc('31050501', -noisy, { credit: noisy }),
    ]);
    const csv = trialBalanceToCSV(tb);
    expect(csv).toContain('11050501,"Cuenta 11050501",Auxiliar,1,300.30,0,300.30');
    expect(csv).not.toMatch(/e[+-]?\d/i);
    const parsed = parseTrialBalanceCSV(csv, { normalizeSignConvention: false });
    expect(parsed.find((r) => r.code === '11050501')?.balancesByPeriod['2025-12']).toBe(300.3);
    expect(parsed.find((r) => r.code === '31050501')?.balancesByPeriod['2025-12']).toBe(-300.3);
  });

  it.each([0.01, 0.1, 1.05, 999.99, 1234.5, 72_000_000.12, 1_234_567, 98_765_432_109.87])(
    'ida y vuelta exacta de %s con el parser del repo',
    (value) => {
      const tb = completeTB([acc('11050501', value, { debit: value })]);
      const parsed = parseTrialBalanceCSV(trialBalanceToCSV(tb), { normalizeSignConvention: false });
      expect(Math.round(parsed[0].balancesByPeriod['2025-12'] * 100)).toBe(Math.round(value * 100));
    },
  );

  it('trialBalanceToRawRows redondea igual que el CSV', () => {
    const tb = completeTB([acc('11050501', 100.1 + 200.2)]);
    expect(trialBalanceToRawRows(tb)[0].balancesByPeriod['2025-12']).toBe(300.3);
  });
});

// ─── ingesta-17 ───────────────────────────────────────────────────────────────

describe('ingesta-17 — periodos anuales, trimestrales y rangos', () => {
  it('resolveERPPeriod entrega fechas válidas para cada formato', () => {
    expect(resolveERPPeriod('2025')).toMatchObject({ from: '2025-01-01', to: '2025-12-31', label: '2025' });
    expect(resolveERPPeriod('2025-Q3')).toMatchObject({ from: '2025-07-01', to: '2025-09-30', label: '2025-Q3' });
    expect(resolveERPPeriod('2024-2')).toMatchObject({ from: '2024-02-01', to: '2024-02-29', label: '2024-02' });
    expect(resolveERPPeriod('2025-01-01..2025-03-31')).toMatchObject({ from: '2025-01-01', to: '2025-03-31' });
  });

  it.each(['marzo', '2025-13', '2025-Q5', '2025-02-30..2025-03-01', '2025-03-01..2025-01-01', ''])(
    'rechaza %j explícitamente',
    (value) => {
      expect(() => resolveERPPeriod(value)).toThrow(ERPPeriodError);
    },
  );

  it('Siigo: año y trimestre generan start/end reales, nunca NaN ni "Q3-01"', async () => {
    const { urls } = stubFetch((url) => {
      if (url.includes('/sign-in')) return { access_token: 'tok', token_type: 'Bearer', expires_in: 86400 };
      return { results: [], pagination: { page: 1, page_size: 100, total_results: 0 } };
    });
    const connector = await getConnector('siigo');
    const creds: ERPCredentials = { provider: 'siigo', username: 'p@x.co', apiKey: 'k' };
    const annual = await connector.getTrialBalance(creds, '2025');
    const quarter = await connector.getTrialBalance(creds, '2025-Q3');
    const journals = urls.filter((u) => u.includes('/v1/journals')).map((u) => new URL(u).searchParams);
    expect(journals[0].get('start_date')).toBe('2025-01-01');
    expect(journals[0].get('end_date')).toBe('2025-12-31');
    expect(journals[1].get('start_date')).toBe('2025-07-01');
    expect(journals[1].get('end_date')).toBe('2025-09-30');
    expect(annual.period).toBe('2025');
    expect(quarter.period).toBe('2025-Q3');
    await expect(connector.getTrialBalance(creds, 'diciembre')).rejects.toThrow(ERPPeriodError);
  });

  it('Helisa (informe a fecha de corte): el año usa el 31 de diciembre como corte', async () => {
    const { urls } = stubFetch((url) => (url.includes('/summary/') ? { items: [] } : undefined));
    const connector = await getConnector('helisa');
    await connector.getTrialBalance({ provider: 'helisa', baseUrl: 'https://h.example.com/KansasWS', apiKey: 'k', companyId: '1' }, '2025');
    const params = new URL(urls[0]).searchParams;
    expect(params.get('fechaCorte')).toBe('2025-12-31');
    expect(params.get('mes')).toBe('12');
  });
});

// ─── ingesta-19 ───────────────────────────────────────────────────────────────

describe('ingesta-19 — moneda de la compañía en SAP B1, Dynamics y Odoo', () => {
  const sapCreds: ERPCredentials = { provider: 'sap_b1', baseUrl: 'https://sap.example.com', username: 'u', password: 'p', databaseName: 'DB' };
  const sapRoute = (adminInfo: unknown): Route => (url) => {
    if (url.endsWith('/Login')) return { SessionId: 's' };
    if (url.includes('/CompanyService_GetAdminInfo')) return adminInfo;
    if (url.includes('/ChartOfAccounts')) return { value: [] };
    if (url.includes('/JournalEntries')) return { value: [] };
  };

  it('SAP B1 toma LocalCurrency de AdminInfo (USD no se rotula como COP)', async () => {
    stubFetch(sapRoute({ LocalCurrency: 'USD' }));
    const tb = await (await getConnector('sap_b1')).getTrialBalance(sapCreds, '2025-12');
    expect(tb.currency).toBe('USD');
  });

  it('SAP B1 sin moneda legible → cadena vacía (falla cerrado) con advertencia', async () => {
    stubFetch(sapRoute(undefined));
    const tb = await (await getConnector('sap_b1')).getTrialBalance(sapCreds, '2025-12');
    expect(tb.currency).toBe('');
    expect(tb.warnings.join(' ')).toMatch(/Moneda/);
  });

  it('Dynamics toma companyInformation.currencyCode', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://login.microsoftonline.com/')) return { access_token: 't', expires_in: 3600 };
      if (url.includes('/companyInformation')) return { value: [{ currencyCode: 'EUR' }] };
      return { value: [] };
    });
    const tb = await (await getConnector('dynamics_365')).getTrialBalance(
      { provider: 'dynamics_365', tenantId: 't', clientId: 'c', clientSecret: 's', companyId: 'co' }, '2025-12');
    expect(tb.currency).toBe('EUR');
  });

  it('Odoo toma la moneda de res.company', async () => {
    stubFetch((url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.endsWith('/authenticate')) return { jsonrpc: '2.0', id: body.id, result: { uid: 1, session_id: 's', company_id: 3 } };
      if (body.params?.model === 'res.company') return { jsonrpc: '2.0', id: body.id, result: [{ currency_id: [2, 'USD'] }] };
      return { jsonrpc: '2.0', id: body.id, result: [] };
    });
    const tb = await (await getConnector('odoo')).getTrialBalance(
      { provider: 'odoo', baseUrl: 'https://odoo.example.com', username: 'u', password: 'p', databaseName: 'db' }, '2025-12');
    expect(tb.currency).toBe('USD');
  });
});

// ─── ingesta-20 ───────────────────────────────────────────────────────────────

describe('ingesta-20 — el ID interno nunca sustituye al código PUC', () => {
  it('Alegra: cuenta sin código se excluye; líneas sin código se resuelven por el plan o se excluyen', async () => {
    stubFetch((url) => {
      if (url.includes('/accounts')) {
        return url.includes('start=0') ? [
          { id: 412345, name: 'Cuenta sin código' },
          { id: 7, code: '13050501', name: 'Clientes' },
        ] : [];
      }
      if (url.includes('/journal-entries')) {
        return url.includes('start=0') ? [{ id: 1, date: '2025-12-01', accounts: [
          { account: { id: 7, name: 'Clientes' }, debit: 500, credit: 0 },
          { account: { id: 412345, name: 'Cuenta sin código' }, debit: 0, credit: 500 },
        ] }] : [];
      }
    });
    const connector = await getConnector('alegra');
    const creds: ERPCredentials = { provider: 'alegra', username: 'u@x.co', apiToken: 't' };
    const chart = await connector.getChartOfAccounts(creds);
    expect(chart.map((a) => a.code)).toEqual(['13050501']);
    const tb = await connector.getTrialBalance(creds, '2025-12');
    expect(tb.accounts.map((a) => a.code)).toEqual(['13050501']);
    expect(tb.accounts.some((a) => a.code === '412345')).toBe(false);
    expect(tb.warnings.join(' ')).toMatch(/sin código PUC/);
  });

  it('Odoo: cuentas deprecated conservan su código; IDs desconocidos se excluyen con advertencia', async () => {
    stubFetch((url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.endsWith('/authenticate')) return { jsonrpc: '2.0', id: body.id, result: { uid: 1, session_id: 's', company_id: 1 } };
      const model = body.params?.model;
      if (model === 'account.account') {
        // Sin filtro de deprecated: la 51xx deprecated sigue en el mapa.
        return { jsonrpc: '2.0', id: body.id, result: [{ id: 5, code: '519595', name: 'Otros (deprecated)', internal_group: 'expense' }] };
      }
      if (model === 'res.company') return { jsonrpc: '2.0', id: body.id, result: [{ currency_id: [8, 'COP'] }] };
      if (model === 'account.move.line') {
        return { jsonrpc: '2.0', id: body.id, result: [
          { id: 1, account_id: [5, '519595 Otros'], debit: 100, credit: 0, balance: 100 },
          { id: 2, account_id: [412345, 'Sin código'], debit: 0, credit: 100, balance: -100 },
        ] };
      }
    });
    const tb = await (await getConnector('odoo')).getTrialBalance(
      { provider: 'odoo', baseUrl: 'https://odoo.example.com', username: 'u', password: 'p', databaseName: 'db' }, '2025-12');
    expect(tb.accounts.map((a) => a.code)).toEqual(['519595']);
    expect(tb.warnings.join(' ')).toMatch(/sin código PUC/);
  });
});

// ─── ingesta-21 (mapeo de clases) ─────────────────────────────────────────────

describe('ingesta-21 — clase 5 = gasto, clases 6 y 7 = costo (Decreto 2650/1993)', () => {
  it('pucTypeFromCode', () => {
    expect(pucTypeFromCode('510506')).toBe('expense');
    expect(pucTypeFromCode('613505')).toBe('cost');
    expect(pucTypeFromCode('720505')).toBe('cost');
  });

  it.each([
    ['siigo', { provider: 'siigo', username: 'u', apiKey: 'k' }, (url: string) => {
      if (url.includes('/sign-in')) return { access_token: 't', token_type: 'Bearer', expires_in: 86400 };
      return { results: [{ id: 1, code: '510506', name: 'Sueldos' }, { id: 2, code: '613505', name: 'Costo' }], pagination: { page: 1, page_size: 100, total_results: 2 } };
    }],
    ['alegra', { provider: 'alegra', username: 'u', apiToken: 't' }, (url: string) =>
      (url.includes('start=0') ? [{ id: 1, code: '510506', name: 'Sueldos' }, { id: 2, code: '613505', name: 'Costo' }] : [])],
    ['helisa', { provider: 'helisa', baseUrl: 'https://h.example.com', apiKey: 'k' }, () =>
      [{ codigo: '510506', nombre: 'Sueldos' }, { codigo: '613505', nombre: 'Costo' }]],
    ['world_office', { provider: 'world_office', baseUrl: 'https://wo.example.com/api', accessToken: 'j' }, () =>
      ({ Data: [{ Id: 1, Codigo: '510506', Nombre: 'Sueldos' }, { Id: 2, Codigo: '613505', Nombre: 'Costo' }], Total: 2, Page: 1, PageSize: 100 })],
    ['contapyme', { provider: 'contapyme', baseUrl: 'https://cp.example.com', username: 'u', password: 'p' }, (url: string) =>
      (url.endsWith('/GetAuth') ? { token: 't' } : { cuentas: [{ codigo: '510506', nombre: 'Sueldos' }, { codigo: '613505', nombre: 'Costo' }] })],
  ] as const)('%s: el plan de cuentas rotula 5 como gasto y 6 como costo', async (provider, creds, route) => {
    stubFetch(route as Route);
    const chart = await (await getConnector(provider)).getChartOfAccounts(creds as ERPCredentials);
    const types = Object.fromEntries(chart.map((a) => [a.code, a.type]));
    expect(types).toEqual({ '510506': 'expense', '613505': 'cost' });
  });
});

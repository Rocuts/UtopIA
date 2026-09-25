// ─── query_erp: balance de prueba presentado al LLM ──────────────────────────
// ingesta-14: movimientos del periodo no se presentan como balance.
// ingesta-15: el resumen por clase suma sólo hojas de la jerarquía real.
// ingesta-17: periodos validados antes de llamar al ERP.
// ingesta-21: resultado operacional = EBIT del preprocesador, con signo.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ERPAccount, ERPTrialBalance } from '@/lib/erp/types';

const getTrialBalance = vi.fn();
vi.mock('@/lib/erp/registry', () => ({
  getConnector: vi.fn(async () => ({ getTrialBalance })),
}));

const { queryERP } = await import('../erp-query');
const { getConnector } = await import('@/lib/erp/registry');

const CONNECTION = [{ provider: 'contapyme' as const, credentials: { username: 'u', password: 'p' } }];

const acc = (code: string, balance: number, extra: Partial<ERPAccount> = {}): ERPAccount => ({
  code, name: `Cuenta ${code}`, type: 'asset', balance,
  debit: balance > 0 ? balance : 0, credit: balance < 0 ? -balance : 0,
  level: code.length >= 8 ? 5 : 4, isAuxiliary: code.length >= 6, ...extra,
});

function tb(overrides: Partial<ERPTrialBalance>): ERPTrialBalance {
  return {
    period: '2025-12', companyName: 'Empresa SAS', currency: 'COP', accounts: [],
    totalDebit: 0, totalCredit: 0, generatedAt: '2026-01-01T00:00:00Z',
    balanceStatus: 'complete', balanceStatusReason: null, warnings: [], ...overrides,
  };
}

/** Balance algebraico (débitos +, créditos −) que cuadra, en millones: utilidad 120. */
const M = 1_000_000;
const COMPLETE_ACCOUNTS: ERPAccount[] = [
  acc('1105', 1_120 * M), acc('110505', 1_120 * M),  // padre + hoja: no duplicar
  acc('220505', -500 * M), acc('310505', -500 * M),
  acc('413505', -1_000 * M),                         // ingresos operacionales
  acc('613505', 400 * M), acc('720505', 100 * M),    // costos clase 6 y 7
  acc('510506', 200 * M), acc('520506', 100 * M),    // gastos operacionales
  acc('530505', 50 * M), acc('540505', 30 * M),      // no operacional e impuesto
];

beforeEach(() => {
  getTrialBalance.mockReset();
  vi.mocked(getConnector).mockClear();
});

describe('query_erp — trial_balance', () => {
  it('movimientos del periodo: sin "Total activos" ni "balance cuadra", con motivo visible', async () => {
    getTrialBalance.mockResolvedValue(tb({
      balanceStatus: 'movements_only',
      balanceStatusReason: 'Alegra sólo entrega los comprobantes del periodo, sin saldo inicial ni saldos acumulados.',
      accounts: [acc('13050501', 1_000_000), acc('41350501', -1_000_000)],
      totalDebit: 1_000_000, totalCredit: 1_000_000,
    }));
    const result = await queryERP({ type: 'trial_balance', period: '2025-12' }, CONNECTION);
    expect(result.content).toMatch(/NO es un balance de prueba/);
    expect(result.content).toMatch(/sin saldo inicial/);
    expect(result.content).not.toMatch(/Total activos/);
    expect(result.content).not.toMatch(/cuadra correctamente/);
    expect(result.content).not.toMatch(/Resultado operacional/);
  });

  it('balance completo: resultado operacional = ingresos 41 − costos 6 y 7 − gastos 51 y 52 (no 53/54, no valores absolutos)', async () => {
    getTrialBalance.mockResolvedValue(tb({ accounts: COMPLETE_ACCOUNTS }));
    const result = await queryERP({ type: 'trial_balance', period: '2025-12' }, CONNECTION);
    // 1.000 − (400 + 100) − (200 + 100) = 200 (millones). La fórmula anterior
    // |4| − |5| − |6| daba 220 y omitía la clase 7.
    expect(result.content).toMatch(/Resultado operacional[^\n]*:\*\* \$\s?200\.000\.000\n/);
    expect(result.content).toMatch(/Total activos:\*\* \$\s?1\.120\.000\.000\n/);
    expect(result.content).toMatch(/Total pasivos:\*\* \$\s?500\.000\.000\n/);
    // Patrimonio del preprocesador: 500 + resultado del ejercicio 120 (A = P + K).
    expect(result.content).toMatch(/Total patrimonio:\*\* \$\s?620\.000\.000\n/);
    expect(result.content).toMatch(/Resultado del ejercicio:\*\* \$\s?120\.000\.000\n/);
    expect(result.content).not.toMatch(/cuadra correctamente/);
  });

  it('resumen por clase suma sólo hojas: la cuenta padre 1105 no se duplica', async () => {
    getTrialBalance.mockResolvedValue(tb({ accounts: COMPLETE_ACCOUNTS }));
    const result = await queryERP({ type: 'trial_balance', period: '2025-12' }, CONNECTION);
    const classOne = result.content.split('\n').find((l) => l.startsWith('| 1 | Activo'));
    expect(classOne).toMatch(/\$\s?1\.120\.000\.000 \|$/);
    expect(result.recordCount).toBe(COMPLETE_ACCOUNTS.length - 1);
  });

  it('balance parcial: advertencias visibles y sin cifras clave', async () => {
    getTrialBalance.mockResolvedValue(tb({
      balanceStatus: 'partial',
      balanceStatusReason: 'Balance parcial: Saldo final ≠ saldo inicial + débitos − créditos en: 110505.',
      warnings: ['Saldo final ≠ saldo inicial + débitos − créditos en: 110505.'],
      accounts: COMPLETE_ACCOUNTS,
    }));
    const result = await queryERP({ type: 'trial_balance', period: '2025-12' }, CONNECTION);
    expect(result.content).toMatch(/PARCIAL/);
    expect(result.content).toMatch(/Advertencias de integridad/);
    expect(result.content).not.toMatch(/Total activos/);
  });

  it.each(['marzo', '2025-13', '2025-Q7'])('periodo %j no soportado: no llama al ERP', async (period) => {
    const result = await queryERP({ type: 'trial_balance', period }, CONNECTION);
    expect(result.content).toMatch(/no soportado|inválido/);
    expect(getTrialBalance).not.toHaveBeenCalled();
  });

  it.each([
    [{ period: '2025' }, '2025'],
    [{ period: '2025-q3' }, '2025-Q3'],
    [{ dateFrom: '2025-01-01', dateTo: '2025-06-30' }, '2025-01-01..2025-06-30'],
  ])('pasa al conector el periodo canónico (%j → %s)', async (args, label) => {
    getTrialBalance.mockResolvedValue(tb({ period: label }));
    await queryERP({ type: 'trial_balance', ...args }, CONNECTION);
    expect(getTrialBalance).toHaveBeenCalledWith(expect.anything(), label);
  });

  it('sin periodo, el balance usa el mes en curso', async () => {
    getTrialBalance.mockResolvedValue(tb({}));
    await queryERP({ type: 'trial_balance' }, CONNECTION);
    expect(getTrialBalance.mock.calls[0][1]).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

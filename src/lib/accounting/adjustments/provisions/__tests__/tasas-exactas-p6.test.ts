// contab-nomina-24 — tasas de prestaciones exactas (1/12, 1/24) en vez de su
// redondeo a 4 o 6 decimales.
// contab-nomina-25 — una sola regla de redondeo (half-up) en el camino que
// postea, igual que computeIncomeTaxProvision; la cadencia anual no se
// provisiona cada mes como si fuera mensual.
import { describe, expect, it } from 'vitest';

import {
  applyProvisionRate,
  calculateProvisions,
  type PeriodAccountBalance,
} from '../calculator';
import { computeIncomeTaxProvision } from '../income-tax';

const PERIOD = { id: 'p1', year: 2026, month: 3 } as never;

function cfg(provisionType: string, rate: string, extra: Record<string, unknown> = {}) {
  return {
    provisionType,
    rate,
    active: true,
    baseAccountCodes: ['510506'],
    expenseAccountId: `exp-${provisionType}`,
    liabilityAccountId: `liab-${provisionType}`,
    expenseAccountCode: '5105xx',
    liabilityAccountCode: '26xx',
    ...extra,
  } as never;
}

const BASE_4M: PeriodAccountBalance[] = [
  { code: '510506', totalDebit: '4000000.00', totalCredit: '0.00' },
];

function run(configs: never[], balances = BASE_4M) {
  return calculateProvisions({
    workspaceId: 'ws',
    period: PERIOD,
    entryDate: new Date('2026-03-31T00:00:00Z'),
    configs,
    periodBalances: balances,
    employerExonerated114_1: false,
    smmlvCop: '1750905.00',
  });
}

describe('contab-nomina-24 — prima, cesantías y vacaciones con fracciones exactas', () => {
  it('base 4.000.000: prima y cesantías = 333.333,33 con tasas 0,0833 o 0,083333', () => {
    for (const rate of ['0.083300', '0.083333', '0.0833']) {
      const r = run([cfg('prima', rate), cfg('cesantias', rate)]);
      expect(r.lines.map((l) => l.provisionAmountCop)).toEqual(['333333.33', '333333.33']);
    }
  });

  it('vacaciones = base × 15/360 = 166.666,67 con tasa 0,0417 o 0,041667', () => {
    for (const rate of ['0.041700', '0.041667']) {
      const r = run([cfg('vacaciones', rate)]);
      expect(r.lines[0].provisionAmountCop).toBe('166666.67');
    }
  });

  it('una tasa distinta fijada por el usuario se respeta', () => {
    const r = run([cfg('prima', '0.090000')]);
    expect(r.lines[0].provisionAmountCop).toBe('360000.00');
  });
});

describe('contab-nomina-25 — redondeo único y cadencia', () => {
  it('el camino que postea redondea half-up como computeIncomeTaxProvision', () => {
    // 0,03 × 35 % = 0,0105 → 0,01 ; 0,05 × 35 % = 0,0175 → 0,02 (antes truncaba a 0,01).
    expect(applyProvisionRate(BigInt(5), '0.350000')).toBe(BigInt(2));
    expect(computeIncomeTaxProvision('0.05')).toBe('0.02');
    const base = '123456789.87';
    const r = calculateProvisions({
      workspaceId: 'ws',
      period: PERIOD,
      entryDate: new Date('2026-03-31T00:00:00Z'),
      configs: [cfg('income_tax', '0.350000', { baseAccountCodes: [] })],
      periodBalances: [],
      pretaxIncome: base,
    });
    expect(r.lines[0].provisionAmountCop).toBe(computeIncomeTaxProvision(base));
  });

  it('una configuración con cadencia anual no se provisiona en el cálculo mensual', () => {
    const r = run([cfg('prima', '0.083333', { cadence: 'annual' }), cfg('cesantias', '0.083333', { cadence: 'monthly' })]);
    expect(r.skipped).toEqual([{ provisionType: 'prima', reason: 'cadence_not_monthly' }]);
    expect(r.lines.map((l) => l.provisionType)).toEqual(['cesantias']);
  });
});

// contab-nomina-06/-07/-08: provisiones laborales — base por centro de costo,
// exoneración Art. 114-1 condicionada al empleador y por trabajador,
// intereses sobre cesantías sobre la base de cesantías.
import { describe, it, expect } from 'vitest';
import { calculateProvisions, type PeriodAccountBalance } from '../calculator';

const PERIOD = { id: 'p1', year: 2026, month: 3 } as never;
const SMMLV = '1750905.00';

function cfg(provisionType: string, rate: string, base: string[]) {
  return {
    provisionType,
    rate,
    active: true,
    baseAccountCodes: base,
    expenseAccountId: `exp-${provisionType}`,
    liabilityAccountId: `liab-${provisionType}`,
    expenseAccountCode: '5105xx',
    liabilityAccountCode: '26xx',
  } as never;
}

const NOMINA: PeriodAccountBalance[] = [
  { code: '510506', costCenterId: 'cc-adm', thirdPartyId: 'w1', totalDebit: '3000000.00', totalCredit: '0.00' },
  { code: '510506', costCenterId: 'cc-vta', thirdPartyId: 'w2', totalDebit: '1000000.00', totalCredit: '0.00' },
  { code: '510527', costCenterId: 'cc-adm', thirdPartyId: 'w1', totalDebit: '249095.00', totalCredit: '0.00' },
];

function run(configs: never[], opts: { employer?: boolean | null; balances?: PeriodAccountBalance[] } = {}) {
  return calculateProvisions({
    workspaceId: 'ws',
    period: PERIOD,
    entryDate: new Date('2026-03-31T00:00:00Z'),
    configs,
    periodBalances: opts.balances ?? NOMINA,
    employerExonerated114_1: opts.employer,
    smmlvCop: SMMLV,
  });
}

describe('provisiones laborales — base y centros de costo', () => {
  it('una línea de gasto por centro de costo y el pasivo por el total', () => {
    const r = run([cfg('prima', '0.083333', ['510506', '510527'])]);
    const e = r.proposedEntries[0];
    const byCc = Object.fromEntries(
      e.lines.filter((l) => l.debit !== '0.00').map((l) => [l.costCenterId, l.debit]),
    );
    // adm: (3.000.000 + 249.095) / 12 ; vta: 1.000.000 / 12 — la tasa 0,083333
    // es el redondeo de 1/12 y se aplica la fracción exacta con redondeo
    // half-up (contab-nomina-24/25). Antes se esperaban 270.756,83 / 83.333,00:
    // la tasa truncada infraprovisionaba.
    expect(byCc).toEqual({ 'cc-adm': '270757.92', 'cc-vta': '83333.33' });
    expect(e.lines.at(-1)).toMatchObject({ accountId: 'liab-prima', credit: '354091.25' });
    expect(r.lines[0].baseAmountCop).toBe('4249095.00');
  });

  it('intereses sobre cesantías: 1 % sobre la base de cesantías (antes base = pasivo 261020 → 0)', () => {
    const r = run([cfg('intereses_cesantias', '0.010000', ['510506', '510527'])]);
    expect(r.lines[0].provisionAmountCop).toBe('42490.95');
    const legacy = run([cfg('intereses_cesantias', '0.010000', ['261020'])], {
      balances: [...NOMINA, { code: '261020', totalDebit: '0.00', totalCredit: '8330000.00' }],
    });
    expect(legacy.skipped[0].reason).toBe('zero_or_negative_base');
  });
});

describe('Art. 114-1 E.T. — salud/SENA/ICBF según el empleador (contab-nomina-07)', () => {
  const configs = () => [
    cfg('salud', '0.085000', ['510506']),
    cfg('sena', '0.020000', ['510506']),
    cfg('icbf', '0.030000', ['510506']),
    cfg('caja', '0.040000', ['510506']),
  ];

  it('sin condición declarada: N/D (no asume exoneración ni cobra a ciegas); Caja sí', () => {
    const r = run(configs(), { employer: null });
    expect(r.skipped.map((s) => [s.provisionType, s.reason])).toEqual([
      ['salud', 'employer_114_1_unknown'],
      ['sena', 'employer_114_1_unknown'],
      ['icbf', 'employer_114_1_unknown'],
    ]);
    expect(r.lines.map((l) => [l.provisionType, l.provisionAmountCop])).toEqual([['caja', '160000.00']]);
  });

  it('empleador NO beneficiario: salud 8,5 %, SENA 2 %, ICBF 3 % sobre toda la base', () => {
    const r = run(configs(), { employer: false });
    expect(Object.fromEntries(r.lines.map((l) => [l.provisionType, l.provisionAmountCop]))).toEqual({
      salud: '340000.00',
      sena: '80000.00',
      icbf: '120000.00',
      caja: '160000.00',
    });
  });

  it('empleador beneficiario: exonera trabajadores < 10 SMMLV y cobra sólo a los ≥ 10 SMMLV', () => {
    const balances: PeriodAccountBalance[] = [
      ...NOMINA,
      { code: '510506', costCenterId: 'cc-adm', thirdPartyId: 'w3', totalDebit: '20000000.00', totalCredit: '0.00' },
    ];
    const r = run(configs(), { employer: true, balances });
    const amounts = Object.fromEntries(r.lines.map((l) => [l.provisionType, l.provisionAmountCop]));
    expect(amounts.salud).toBe('1700000.00'); // 20.000.000 × 8,5 % (sólo w3)
    expect(amounts.caja).toBe('960000.00'); // Caja nunca se exonera: 24.000.000 × 4 %
  });

  it('empleador beneficiario con nómina sin tercero: exige detalle por trabajador', () => {
    const balances: PeriodAccountBalance[] = [
      { code: '510506', costCenterId: 'cc-adm', thirdPartyId: null, totalDebit: '4000000.00', totalCredit: '0.00' },
    ];
    const r = run(configs(), { employer: true, balances });
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'worker_detail_required',
      'worker_detail_required',
      'worker_detail_required',
    ]);
  });

  it("config legado 'parafiscales' (9 % agrupado) se omite con motivo", () => {
    const r = run([cfg('parafiscales', '0.090000', ['510506'])], { employer: false });
    expect(r.skipped).toEqual([{ provisionType: 'parafiscales', reason: 'legacy_parafiscales_split' }]);
  });
});

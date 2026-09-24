// ---------------------------------------------------------------------------
// API v1 — parámetros `unit` y `maturity_overrides` (P4, pendiente #4 de la
// auditoría integral 2026-09-24) e ingesta-30 (rango seguro de centavos en
// `rows`).
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { preprocessTrialBalance, type RawAccountRow } from '@/lib/preprocessing/trial-balance';

import { TrialBalanceCreateSchema } from '../schemas';
import {
  buildRawRowsFromInput,
  preprocessBuiltRows,
  serializeTrialBalance,
  serializeTrialBalanceDetail,
  summarize,
} from '../trial-balances';

const CSV_MILES = [
  'codigo;nombre;transaccional;saldo 2025 (miles de pesos)',
  '110505;Caja general;si;1000',
  '210505;Crédito bancario a 3 años;si;400',
  '310505;Capital suscrito;si;600',
].join('\n');

const summaryOf = (input: Parameters<typeof buildRawRowsFromInput>[0]) => {
  const built = buildRawRowsFromInput(input);
  if (!built.ok) throw new Error(`fixture inválido: ${built.code}`);
  const pre = preprocessBuiltRows(built, input.period_label);
  return { built, pre, summary: summarize(pre, { signConvention: built.signConvention, unit: built.unit }) };
};

describe('API v1 — unit (P4-a)', () => {
  it('CSV en miles sin `unit`: unbalanced, unidad detectada y motivo que indica cómo confirmarla', () => {
    const { summary, pre } = summaryOf({ csv: CSV_MILES });
    expect(summary.status).toBe('unbalanced');
    expect(summary.unit).toEqual({
      declared: 'miles',
      declared_text: 'saldo 2025 (miles de pesos)',
      confirmed: null,
      requires_confirmation: true,
    });
    const detail = serializeTrialBalanceDetail({}, pre);
    expect(JSON.stringify(detail.validation_reasons)).toMatch(/parámetro `unit` del API v1/);
  });

  it('CSV con unit=miles: balanced, centavos exactos y nota en validation_notes', () => {
    const { summary, pre } = summaryOf({ csv: CSV_MILES, unit: 'miles' });
    expect(summary.status).toBe('balanced');
    expect(summary.control_totals.activo).toEqual({ amount: '100000000', currency: 'COP' });
    expect(summary.unit?.confirmed).toBe('miles');
    expect(summary.unit?.requires_confirmation).toBe(false);
    const detail = serializeTrialBalanceDetail({}, pre);
    expect((detail.validation_notes as string[]).some((n) => /reexpresadas de miles de pesos a pesos/.test(n))).toBe(true);
    const base = serializeTrialBalance('tb_x', { createdAt: new Date(0), summary, preprocessorVersion: 'v' });
    expect(base.unit).toEqual(summary.unit);
  });

  it('rows con unit=millones: reexpresión exacta desde el decimal (0,1 + 0,2 millones = $300.000)', () => {
    const { summary, built } = summaryOf({
      unit: 'millones',
      period_label: '2025',
      rows: [
        { code: '110505', name: 'Caja', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': 0.1 } },
        { code: '110510', name: 'Caja menor', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': 0.2 } },
        { code: '310505', name: 'Capital', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': 0.3 } },
      ],
    });
    expect(built.rows.map((r) => r.balancesByPeriod['2025'])).toEqual([100000, 200000, 300000]);
    expect(summary.control_totals.activo.amount).toBe('30000000');
    expect(summary.status).toBe('balanced');
    expect(summary.unit).toEqual({ declared: null, declared_text: null, confirmed: 'millones', requires_confirmation: false });
  });

  it('rows cuyo importe reexpresado excede 2^53 centavos: 400 con el puntero del campo', () => {
    const built = buildRawRowsFromInput({
      unit: 'millones',
      rows: [
        { code: '110505', name: 'Caja', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': 95_000_000_000 } },
      ],
    });
    expect(built.ok).toBe(false);
    if (built.ok || built.code !== 'validation_failed') throw new Error('se esperaba validation_failed');
    expect(built.errors[0].pointer).toBe('/rows/0/balances_by_period/2025');
    expect(built.errors[0].detail).toMatch(/rango de precisión monetaria/);
  });

  it('el esquema rechaza una unidad desconocida', () => {
    expect(TrialBalanceCreateSchema.safeParse({ csv: CSV_MILES, unit: 'docenas' }).success).toBe(false);
  });
});

describe('API v1 — maturity_overrides (P4-b)', () => {
  it('2105 → no corriente: persistido en las filas, aplicado y revelado; sin overrides cifras idénticas', () => {
    const sin = summaryOf({ csv: CSV_MILES, unit: 'miles' });
    const con = summaryOf({ csv: CSV_MILES, unit: 'miles', maturity_overrides: { '2105': 'no_corriente' } });
    expect(con.summary.control_totals).toEqual(sin.summary.control_totals);
    expect(sin.pre.primary.controlTotals.pasivoCorriente).toBe(400000);
    expect(con.pre.primary.controlTotals.pasivoCorriente).toBe(0);
    expect(con.pre.primary.controlTotals.pasivoNoCorriente).toBe(400000);
    // Las filas persistidas llevan el vencimiento: el recompute del detalle lo aplica igual.
    const persisted = JSON.parse(JSON.stringify(con.built.rows)) as RawAccountRow[];
    expect(persisted.find((r) => r.code === '210505')!.vencimiento).toBe('no_corriente');
    expect(preprocessTrialBalance(persisted).primary.controlTotals.pasivoNoCorriente).toBe(400000);
    const detail = serializeTrialBalanceDetail({}, con.pre);
    expect(detail.classification_note).toMatch(/210505 \(pasivo\) → no corriente/);
  });

  it('el esquema rechaza códigos que no son de activo o pasivo y plazos desconocidos', () => {
    expect(
      TrialBalanceCreateSchema.safeParse({ csv: CSV_MILES, maturity_overrides: { '4135': 'corriente' } }).success,
    ).toBe(false);
    expect(
      TrialBalanceCreateSchema.safeParse({ csv: CSV_MILES, maturity_overrides: { '2105': 'largo' } }).success,
    ).toBe(false);
    expect(
      TrialBalanceCreateSchema.safeParse({ csv: CSV_MILES, maturity_overrides: { '2105': 'no_corriente' } }).success,
    ).toBe(true);
  });
});

describe('ingesta-30 — rango seguro de centavos también en `rows`', () => {
  it('un saldo mayor de 2^53 centavos por `rows` bloquea con motivo (mismo guard que CSV, upload y ERP)', () => {
    const { summary, pre } = summaryOf({
      period_label: '2025',
      rows: [
        { code: '110505', name: 'Caja', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': 123456789012345.67 } },
        { code: '310505', name: 'Capital', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': 123456789012345.67 } },
      ],
    });
    expect(summary.status).toBe('unbalanced');
    expect(pre.primary.validation.integrityReasons?.some((r) => /rango de precisión monetaria/.test(r))).toBe(true);
    // JSON no transporta Infinity/NaN y el esquema (Zod 4) rechaza números no finitos.
    expect(
      TrialBalanceCreateSchema.safeParse({
        rows: [{ code: '1105', name: 'Caja', level: 'Auxiliar', transactional: true, balances_by_period: { '2025': Infinity } }],
      }).success,
    ).toBe(false);
  });
});

describe('API v1 — fecha de corte declarada en el título (P4-c, contrato documentado)', () => {
  it('con period_label "2025" y título "a junio 30 de 2025", el periodo es 2025-06 y la nota cita el archivo', () => {
    const csv = [
      'Balance de prueba a junio 30 de 2025',
      'codigo;nombre;saldo 2025',
      '110505;Caja general;1000',
      '310505;Capital suscrito;1000',
    ].join('\n');
    const { summary, pre } = summaryOf({ csv, period_label: '2025' });
    expect(summary.period_label).toBe('2025-06');
    const detail = serializeTrialBalanceDetail(
      serializeTrialBalance('tb_x', { createdAt: new Date(0), summary, preprocessorVersion: 'x' }),
      pre,
    );
    expect(
      (detail.validation_notes as string[]).some((n) => /Fecha de corte declarada.*a junio 30 de 2025/.test(n)),
    ).toBe(true);
  });
});

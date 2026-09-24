// ---------------------------------------------------------------------------
// trial-balances.ts — partes puras del servicio (parse, summarize, serialize).
// El acceso a DB (create/get/list/delete) queda cubierto por tsc + smoke.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { decryptSecret, encryptSecret } from '@/lib/security/vault';

import {
  buildRawRowsFromInput,
  centsToMoney,
  PREPROCESSOR_CONTRACT_VERSION,
  serializeTrialBalance,
  serializeTrialBalanceDetail,
  summarize,
} from '../trial-balances';

const CSV_BALANCEADO = [
  'codigo;nombre;transaccional;saldo 2025',
  '110505;Caja general;si;1000000',
  '210505;Bancos nacionales;si;400000',
  '310505;Capital suscrito;si;600000',
].join('\n');

const CSV_DESCUADRADO = [
  'codigo;nombre;transaccional;saldo 2025',
  '110505;Caja general;si;1000000',
  '210505;Bancos nacionales;si;400000',
  '310505;Capital suscrito;si;500000',
].join('\n');

beforeEach(() => {
  process.env.UTOPIA_VAULT_KEY = randomBytes(32).toString('base64');
});

describe('centsToMoney', () => {
  it('serializa centavos como string-integer COP (MoneyCop)', () => {
    expect(centsToMoney(BigInt(150000))).toEqual({ amount: '150000', currency: 'COP' });
    expect(centsToMoney(BigInt(0))).toEqual({ amount: '0', currency: 'COP' });
    expect(centsToMoney(BigInt(-5))).toEqual({ amount: '-5', currency: 'COP' });
  });
});

describe('buildRawRowsFromInput', () => {
  it('parsea CSV con los alias de la plataforma', () => {
    const r = buildRawRowsFromInput({ csv: CSV_BALANCEADO });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].code).toBe('110505');
    expect(r.rows[0].balancesByPeriod['2025']).toBe(1000000);
    expect(r.source).toBe('csv');
  });

  it('mapea filas estructuradas snake_case → RawAccountRow', () => {
    const r = buildRawRowsFromInput({
      rows: [
        {
          code: '110505',
          name: 'Caja',
          level: 'Auxiliar',
          transactional: true,
          balances_by_period: { '2025': 5000 },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].balancesByPeriod).toEqual({ '2025': 5000 });
    expect(r.source).toBe('rows');
  });

  it('CSV irreconocible → empty_trial_balance', () => {
    const r = buildRawRowsFromInput({ csv: 'esto no tiene columnas PUC' });
    expect(r).toEqual({ ok: false, code: 'empty_trial_balance' });
  });
});

describe('summarize', () => {
  it('balance cuadrado: status balanced y delta 0 en centavos', () => {
    const rows = buildRawRowsFromInput({ csv: CSV_BALANCEADO });
    if (!rows.ok) throw new Error('fixture inválido');
    const pre = preprocessTrialBalance(rows.rows);
    const s = summarize(pre);
    expect(s.status).toBe('balanced');
    expect(s.period_label).toBe('2025');
    expect(s.control_totals.activo.amount).toBe('100000000'); // $1.000.000 → centavos
    expect(s.control_totals.pasivo.amount).toBe('40000000');
    expect(s.control_totals.patrimonio.amount).toBe('60000000');
    expect(s.control_totals.equation_delta.amount).toBe('0');
    expect(s.row_count).toBe(3);
  });

  it('balance descuadrado: status unbalanced y delta ≠ 0', () => {
    const rows = buildRawRowsFromInput({ csv: CSV_DESCUADRADO });
    if (!rows.ok) throw new Error('fixture inválido');
    const s = summarize(preprocessTrialBalance(rows.rows));
    expect(s.status).toBe('unbalanced');
    expect(s.control_totals.equation_delta.amount).toBe('10000000'); // +$100.000
  });
});

describe('serializeTrialBalance', () => {
  it('produce el shape público snake_case con created_at RFC3339', () => {
    const rows = buildRawRowsFromInput({ csv: CSV_BALANCEADO });
    if (!rows.ok) throw new Error('fixture inválido');
    const summary = summarize(preprocessTrialBalance(rows.rows));
    const out = serializeTrialBalance('tb_x', {
      createdAt: new Date('2026-08-19T15:04:05.000Z'),
      summary,
      preprocessorVersion: PREPROCESSOR_CONTRACT_VERSION,
    });
    expect(out).toMatchObject({
      id: 'tb_x',
      object: 'trial_balance',
      status: 'balanced',
      period_label: '2025',
      row_count: 3,
      preprocessor_version: PREPROCESSOR_CONTRACT_VERSION,
      created_at: '2026-08-19T15:04:05.000Z',
    });
    expect(out.control_totals).toHaveProperty('equation_delta');
    expect(out.findings).toEqual({
      discrepancies: summary.findings.discrepancies,
      curator: summary.findings.curator,
    });
  });
});

describe('cifrado de filas (vault AES-256-GCM)', () => {
  it('roundtrip encrypt → decrypt preserva las filas', () => {
    const rows = buildRawRowsFromInput({ csv: CSV_BALANCEADO });
    if (!rows.ok) throw new Error('fixture inválido');
    const envelope = encryptSecret(JSON.stringify(rows.rows));
    expect(envelope.startsWith('v1:gcm:')).toBe(true);
    expect(JSON.parse(decryptSecret(envelope))).toEqual(rows.rows);
  });
});

// ---------------------------------------------------------------------------
// niif-preproceso-07 — status/equation_delta del archivo de origen.
// El recurso público reporta la cuadratura del archivo: lo que no explica el
// traslado del resultado ni la reclasificación de un grupo 36 anterior.
// Auditoría 2026-09 (niif-preproceso-06): R8 ya no absorbe ese residual en
// 3710VC — `virtual_close_adjustment` vale 0 y el residual queda en
// `equation_delta` y en el patrimonio publicado (A − P − K ≠ 0).
// ---------------------------------------------------------------------------
describe('summarize — cuadratura del archivo de origen (pre-R8)', () => {
  const aux = (code: string, name: string, balance: number) => ({
    code,
    name,
    level: 'Auxiliar',
    transactional: true,
    balances_by_period: { '2025': balance },
  });

  function summaryOf(rows: ReturnType<typeof aux>[]) {
    const built = buildRawRowsFromInput({ rows, period_label: '2025' });
    if (!built.ok) throw new Error('fixture inválido');
    return summarize(preprocessTrialBalance(built.rows, { defaultPeriod: '2025' }));
  }

  it('descuadre de $150M con P&G: unbalanced, delta exacto y nada absorbido en 3710VC', () => {
    // A 350M − P 100M − K 50M − utilidad 50M = 150M de descuadre en origen.
    const s = summaryOf([
      aux('11050501', 'Caja', 350_000_000),
      aux('21050501', 'Obligaciones', 100_000_000),
      aux('31050501', 'Capital', 50_000_000),
      aux('41350501', 'Ventas', 100_000_000),
      aux('51050501', 'Gastos', 50_000_000),
    ]);
    expect(s.status).toBe('unbalanced');
    expect(s.control_totals.equation_delta.amount).toBe('15000000000');
    // R8 sólo traslada la utilidad (3605VC = 50M): el patrimonio publicado es
    // 100M y A − P − K = 150M sigue visible; nada se absorbe en 3710VC.
    expect(s.control_totals.virtual_close_adjustment.amount).toBe('0');
    expect(s.control_totals.reclassified_from_3605.amount).toBe('0');
    expect(s.control_totals.patrimonio.amount).toBe('10000000000');
    expect(
      BigInt(s.control_totals.activo.amount) -
        BigInt(s.control_totals.pasivo.amount) -
        BigInt(s.control_totals.patrimonio.amount),
    ).toBe(BigInt(s.control_totals.equation_delta.amount));
  });

  it('libros abiertos que sí cuadran (A = P + K + utilidad): balanced sin tapón', () => {
    const s = summaryOf([
      aux('11050501', 'Caja', 250_000_000),
      aux('21050501', 'Obligaciones', 100_000_000),
      aux('31050501', 'Capital', 100_000_000),
      aux('41350501', 'Ventas', 100_000_000),
      aux('51050501', 'Gastos', 50_000_000),
    ]);
    expect(s.status).toBe('balanced');
    expect(s.control_totals.equation_delta.amount).toBe('0');
    expect(s.control_totals.virtual_close_adjustment.amount).toBe('0');
  });

  it('3605 del ejercicio anterior sin trasladar: se reclasifica, no es descuadre', () => {
    // A 280M = P 100M + K (capital 100M + 3605 viejo 30M) + utilidad 50M.
    const s = summaryOf([
      aux('11050501', 'Caja', 280_000_000),
      aux('21050501', 'Obligaciones', 100_000_000),
      aux('31050501', 'Capital', 100_000_000),
      aux('36050501', 'Utilidad del ejercicio', 30_000_000),
      aux('41350501', 'Ventas', 100_000_000),
      aux('51050501', 'Gastos', 50_000_000),
    ]);
    expect(s.status).toBe('balanced');
    expect(s.control_totals.equation_delta.amount).toBe('0');
    expect(s.control_totals.reclassified_from_3605.amount).toBe('3000000000');
    expect(s.control_totals.virtual_close_adjustment.amount).toBe('0');
    // K publicado = capital 100M + 3710VC 30M + 3605VC 50M.
    expect(s.control_totals.patrimonio.amount).toBe('18000000000');
  });

  it('3605 anterior reclasificado + descuadre real: el delta es sólo el descuadre (no resta la reclasificación)', () => {
    // A 290M = P 100M + K (capital 100M + 3605 viejo 30M) + utilidad 50M + 10M sin explicar.
    const s = summaryOf([
      aux('11050501', 'Caja', 290_000_000),
      aux('21050501', 'Obligaciones', 100_000_000),
      aux('31050501', 'Capital', 100_000_000),
      aux('36050501', 'Utilidad del ejercicio', 30_000_000),
      aux('41350501', 'Ventas', 100_000_000),
      aux('51050501', 'Gastos', 50_000_000),
    ]);
    expect(s.status).toBe('unbalanced');
    expect(s.control_totals.equation_delta.amount).toBe('1000000000');
    expect(s.control_totals.reclassified_from_3605.amount).toBe('3000000000');
    expect(s.control_totals.virtual_close_adjustment.amount).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// ingesta-10 — `rows` y `csv` pasan por la misma normalización de signos.
// ---------------------------------------------------------------------------
describe('buildRawRowsFromInput — misma convención de signos por rows y csv', () => {
  const DATA: Array<[string, string, number]> = [
    ['11050501', 'Caja general', 150000],
    ['11100501', 'Bancos nacionales', 250000],
    ['13050501', 'Clientes nacionales', 100000],
    ['15200101', 'Maquinaria y equipo', 500000],
    ['22050101', 'Proveedores nacionales', 150000],
    ['23359501', 'Otros costos por pagar', 100000],
    ['24080101', 'IVA por pagar', 100000],
    ['25050101', 'Salarios por pagar', 50000],
    ['31050501', 'Capital autorizado', 400000],
    ['33050501', 'Reserva legal', 200000],
  ];
  const algebraic = (code: string, v: number) => (['2', '3', '4'].includes(code[0]) ? -v : v);

  it('algebraica por rows da los mismos totales y status que por csv', () => {
    const rows = DATA.map(([code, name, v]) => ({
      code,
      name,
      level: 'Auxiliar',
      transactional: true,
      balances_by_period: { '2025': algebraic(code, v) },
    }));
    const csv = ['codigo,nombre,saldo', ...DATA.map(([c, n, v]) => `${c},${n},${algebraic(c, v)}`)].join('\n');

    const viaRows = buildRawRowsFromInput({ rows, period_label: '2025' });
    const viaCsv = buildRawRowsFromInput({ csv, period_label: '2025' });
    if (!viaRows.ok || !viaCsv.ok) throw new Error('fixture inválido');
    expect(viaRows.signConvention).toBe('algebraica');
    expect(viaCsv.signConvention).toBe('algebraica');

    const sRows = summarize(preprocessTrialBalance(viaRows.rows, { defaultPeriod: '2025' }));
    const sCsv = summarize(preprocessTrialBalance(viaCsv.rows, { defaultPeriod: '2025' }));
    expect(sRows.control_totals).toEqual(sCsv.control_totals);
    expect(sRows.status).toBe('balanced');
    expect(sRows.control_totals.pasivo.amount).toBe('40000000');
  });
});

// ---------------------------------------------------------------------------
// ingesta-06 por API v1 y motivos de validación visibles en el detalle.
// ---------------------------------------------------------------------------
describe('API v1 — columnas de saldo y motivos de validación', () => {
  it('"Saldo Inicial … Saldo Final" con period_label publica el saldo final', () => {
    const csv = [
      'Cuenta,Nombre,Saldo Inicial,Débitos,Créditos,Saldo Final',
      '11050501,Caja,800000,300000,100000,1000000',
      '21050501,Obligaciones,300000,0,100000,400000',
      '31050501,Capital,500000,0,100000,600000',
    ].join('\n');
    const built = buildRawRowsFromInput({ csv, period_label: '2025' });
    if (!built.ok) throw new Error('fixture inválido');
    const s = summarize(preprocessTrialBalance(built.rows, { defaultPeriod: '2025' }));
    expect(s.period_label).toBe('2025');
    expect(s.control_totals.activo.amount).toBe('100000000');
    expect(s.status).toBe('balanced');
  });

  it('una celda ilegible impide certificar la cuadratura y se expone en el detalle', () => {
    const csv = [
      'codigo;nombre;saldo 2025',
      '110505;Caja general;1000000',
      '111005;Bancos;1.23457E+11',
      '210505;Bancos nacionales;400000',
      '310505;Capital suscrito;600000',
    ].join('\n');
    const built = buildRawRowsFromInput({ csv });
    if (!built.ok) throw new Error('fixture inválido');
    const pre = preprocessTrialBalance(built.rows);
    const s = summarize(pre);
    expect(s.status).toBe('unbalanced');
    const detail = serializeTrialBalanceDetail({}, pre);
    expect(JSON.stringify(detail.validation_reasons)).toMatch(/111005/);
  });
});

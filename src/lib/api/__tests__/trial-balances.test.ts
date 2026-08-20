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

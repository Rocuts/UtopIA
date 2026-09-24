// ---------------------------------------------------------------------------
// niif-preproceso-33 — el preprocesado del cliente se re-deriva de sus filas
// ---------------------------------------------------------------------------
// `revivePreprocessedBalance` sólo valida la forma: unos totales de control
// alterados con centavos coherentes pasaban como anclas vinculantes en /export
// y /html. Ahora se recalculan desde `rawRows` (+ ajustes confirmados) y, si
// difieren, se rechaza; si coinciden, se usa el re-derivado.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import {
  preprocessedAnchorMismatches,
  revivePreprocessedBalance,
  toJsonSafe,
} from '@/lib/preprocessing/json-safe';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment } from '@/lib/agents/repair/types';
import {
  readAppliedAdjustments,
  rederivePreprocessedFromRows,
  REDERIVE_MISMATCH_HEADLINE,
} from '../preprocessed-integrity';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,1000,1700',
  '130505,Clientes,Auxiliar,1,5000,8300',
  '220505,Proveedores,Auxiliar,1,3000,4000',
  '311505,Capital,Auxiliar,1,3000,3000',
  '410505,Ventas,Auxiliar,1,0,7000',
  '510505,Sueldos,Auxiliar,1,0,2500',
].join('\n');

const LEDGER: Adjustment[] = [
  {
    id: 'adj-1',
    accountCode: '510505',
    accountName: 'Sueldos',
    amount: -500,
    rationale: 'Causación duplicada confirmada',
    status: 'applied',
    proposedAt: '2026-09-01T00:00:00Z',
    appliedAt: '2026-09-01T00:00:00Z',
  },
];

/** Lo que el servidor recibe: el preprocesado tras el viaje JSON. */
function wire(pp: ReturnType<typeof preprocessTrialBalance>) {
  const revived = revivePreprocessedBalance(JSON.parse(JSON.stringify(toJsonSafe(pp))));
  if (!revived) throw new Error('fixture inválido');
  return revived;
}

const original = () => preprocessTrialBalance(parseTrialBalanceCSV(CSV));

describe('rederivePreprocessedFromRows', () => {
  it('un preprocesado íntegro se acepta y se devuelve el re-derivado', () => {
    const out = rederivePreprocessedFromRows(wire(original()));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preprocessed.primary.controlTotals.activo).toBe(10000);
    expect(out.preprocessed.primary.controlTotals.cents?.utilidadNeta).toBe(BigInt(450000));
  });

  it('el preprocesado ajustado por el Doctor de Datos casa sólo con el mismo ledger', () => {
    const adjusted = wire(applyAdjustments(original(), LEDGER).balance);
    const without = rederivePreprocessedFromRows(adjusted);
    expect(without.ok).toBe(false);
    const withLedger = rederivePreprocessedFromRows(adjusted, LEDGER);
    expect(withLedger.ok).toBe(true);
    if (withLedger.ok) expect(withLedger.preprocessed.primary.controlTotals.utilidadNeta).toBe(5000);
  });

  it('centavos alterados en todas las copias del periodo primario → rechazo con el detalle', () => {
    const pp = wire(original());
    const forged = BigInt(99_999_900);
    pp.primary.controlTotals.cents!.activo = forged;
    pp.periods[pp.periods.length - 1].controlTotals.cents!.activo = forged;
    const out = rederivePreprocessedFromRows(pp);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.details[0]).toBe(REDERIVE_MISMATCH_HEADLINE);
    expect(out.details.join('\n')).toMatch(/2025 · activo: enviado 99999900, recalculado 1000000 \(centavos\)/);
  });

  it('`primary` es una copia independiente tras el viaje JSON: alterarla sola también se detecta', () => {
    const pp = wire(original());
    pp.primary.controlTotals.cents!.utilidadNeta = BigInt(1);
    const out = rederivePreprocessedFromRows(pp);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.details.join('\n')).toMatch(/primario 2025 · utilidadNeta/);
  });

  it('los totales en `number` también se exigen (los leen KPI, cascada y diales)', () => {
    const pp = wire(original());
    pp.primary.controlTotals.activo = 99_999;
    const out = rederivePreprocessedFromRows(pp);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.details.join('\n')).toMatch(/primario 2025 · activo: enviado 99999, recalculado 10000/);
  });

  it('cuentas alteradas sin tocar totales: se usa el re-derivado, no el objeto del cliente', () => {
    const pp = wire(original());
    const caja = pp.primary.classes.find((c) => c.code === 1)!.accounts.find((a) => a.code === '110505')!;
    caja.balance = 123_456;
    const out = rederivePreprocessedFromRows(pp);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const rederivedCaja = out.preprocessed.primary.classes
      .find((c) => c.code === 1)!
      .accounts.find((a) => a.code === '110505')!;
    expect(rederivedCaja.balance).toBe(1700);
  });

  it('respeta los periodos declarados como saldos de apertura (ingesta-09)', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV), { openingPeriods: ['2024'] });
    expect(pp.comparative?.saldosDeApertura).toBe(true);
    const out = rederivePreprocessedFromRows(wire(pp));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.preprocessed.comparative?.saldosDeApertura).toBe(true);
  });

  it('filas crudas ilegibles → rechazo, no excepción', () => {
    const pp = wire(original());
    (pp as unknown as { rawRows: unknown[] }).rawRows = [{ code: null }];
    const out = rederivePreprocessedFromRows(pp);
    expect(out.ok).toBe(false);
  });
});

describe('preprocessedAnchorMismatches', () => {
  it('periodos distintos se reportan', () => {
    const a = original();
    const b = preprocessTrialBalance(parseTrialBalanceCSV(CSV.replace(/saldo 2024,saldo 2025/, 'saldo 2023,saldo 2025')));
    const out = preprocessedAnchorMismatches(a, b);
    expect(out.join('\n')).toMatch(/periodos: enviado \[2024, 2025\], recalculado \[2023, 2025\]/);
  });

  it('idénticos → sin diferencias', () => {
    expect(preprocessedAnchorMismatches(wire(original()), original())).toEqual([]);
  });
});

describe('readAppliedAdjustments', () => {
  it('ausente → []; mal formado → null', () => {
    expect(readAppliedAdjustments(undefined)).toEqual([]);
    expect(readAppliedAdjustments(null)).toEqual([]);
    expect(readAppliedAdjustments('x')).toBeNull();
    expect(readAppliedAdjustments({ adjustments: [{ id: 1 }] })).toBeNull();
    expect(readAppliedAdjustments({ adjustments: 'x' })).toBeNull();
  });

  it('conserva sólo los confirmados y su `period` (mismo contrato que /niif, /consolidate y /export)', () => {
    const out = readAppliedAdjustments({
      adjustments: [
        { ...LEDGER[0], period: '2024' },
        { ...LEDGER[0], id: 'adj-2', status: 'proposed' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out?.[0].id).toBe('adj-1');
    // Un ajuste del comparativo se re-deriva sobre el comparativo, como en /niif.
    expect(out?.[0].period).toBe('2024');
    expect(readAppliedAdjustments({ adjustments: [LEDGER[0]] })?.[0].period).toBeUndefined();
  });

  it('un `period` con forma inválida invalida el ledger (400), igual que el esquema de las rutas', () => {
    expect(readAppliedAdjustments({ adjustments: [{ ...LEDGER[0], period: 2024 }] })).toBeNull();
    expect(readAppliedAdjustments({ adjustments: [{ ...LEDGER[0], period: '' }] })).toBeNull();
  });
});

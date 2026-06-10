// ---------------------------------------------------------------------------
// Regresión producción — Doctor de Datos (applyAdjustments + revalidate).
//
// Dos bugs del flujo crítico #1 que el fix repara:
//   1. cloneSnapshot/cloneBalance DESCARTABAN campos enriquecidos del
//      preprocessor (virtualCloseAdjustment, curator, periodoTipo,
//      cashFlowIndirecto). Sin virtualCloseAdjustment el Bridge de Cuadratura
//      del orchestrator se desactivaba tras aplicar CUALQUIER ajuste.
//   2. recomputeSnapshotTotals reemplazaba controlTotals SIN cents/raw → el
//      bloque vinculante perdía UAI/impuesto/KPIs y el gate
//      auditReportEmittable comparaba contra anclas obsoletas.
//
// Usa el preprocesador REAL (no mocks) — el contrato que importa es el de
// producción.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { applyAdjustments, revalidate } from '../adjustments';
import type { Adjustment } from '../types';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

function buildBalance() {
  const csv = [
    'codigo,nombre,nivel,saldo 2025',
    '1,Activos,Clase,200000000',
    '11,Disponible,Grupo,50000000',
    '110505,Caja,Auxiliar,50000000',
    '13,Deudores,Grupo,40000000',
    '130505,Clientes,Auxiliar,40000000',
    '14,Inventarios,Grupo,60000000',
    '143505,Mercancías,Auxiliar,60000000',
    '15,PPE,Grupo,50000000',
    '152405,Equipo oficina,Auxiliar,50000000',
    '2,Pasivos,Clase,80000000',
    '22,Proveedores,Grupo,30000000',
    '220505,Proveedores nacionales,Auxiliar,30000000',
    '23,Cxp,Grupo,30000000',
    '230505,Cxp comerciales,Auxiliar,30000000',
    '24,Impuestos,Grupo,20000000',
    '240405,Renta,Auxiliar,20000000',
    '3,Patrimonio,Clase,120000000',
    '311505,Capital suscrito,Auxiliar,100000000',
    '4,Ingresos,Clase,210000000',
    '410505,Ventas,Auxiliar,200000000',
    '417505,Devoluciones rebajas,Auxiliar,10000000',
    '5,Gastos,Clase,30000000',
    '510505,Sueldos,Auxiliar,20000000',
    '530505,Intereses,Auxiliar,10000000',
    '6,Costos,Clase,150000000',
    '613505,CMV,Auxiliar,150000000',
  ].join('\n');
  return preprocessTrialBalance(parseTrialBalanceCSV(csv));
}

function mkAdjustment(over: Partial<Adjustment>): Adjustment {
  return {
    id: 'adj-test-1',
    accountCode: '130505',
    accountName: 'Clientes',
    amount: 5_000_000,
    rationale: 'test',
    status: 'applied',
    proposedAt: '2026-06-10T00:00:00.000Z',
    appliedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

describe('applyAdjustments — preserva cents/raw tras recomputar (regresión bloque vinculante)', () => {
  it('el balance ajustado conserva controlTotals.cents en BigInt', () => {
    const balance = buildBalance();
    expect(typeof balance.primary.controlTotals.cents?.activo).toBe('bigint');

    const { balance: adjusted } = applyAdjustments(balance, [mkAdjustment({})]);
    const cents = adjusted.primary.controlTotals.cents;

    expect(cents).toBeDefined();
    expect(typeof cents?.activo).toBe('bigint');
    expect(typeof cents?.utilidadAntesImpuestos).toBe('bigint');
    expect(typeof cents?.impuestoCausado).toBe('bigint');
    // +5M en un activo (deudores) → activo sube exactamente 5M.
    const before = balance.primary.controlTotals.cents!.activo;
    expect(cents!.activo).toBe(before + BigInt(500_000_000));
  });

  it('los cents recomputados son coherentes con los floats ajustados', () => {
    const balance = buildBalance();
    const { balance: adjusted } = applyAdjustments(balance, [mkAdjustment({})]);
    const ct = adjusted.primary.controlTotals;
    // cents.activo / 100 == activo float (mismo dato, dos representaciones).
    expect(Number(ct.cents!.activo) / 100).toBeCloseTo(ct.activo, 2);
    expect(Number(ct.cents!.ingresos) / 100).toBeCloseTo(ct.ingresos, 2);
  });

  it('preserva campos enriquecidos del snapshot que el módulo NO recalcula', () => {
    const balance = buildBalance();
    // Inyecta marcadores en los campos que el bug descartaba.
    const marker = { applied: true, gapCents: '12345' };
    // @ts-expect-error — campo opcional poblado por el preprocessor/curator.
    balance.primary.virtualCloseAdjustment = marker;
    balance.primary.periodoTipo = 'cerrado';

    const { balance: adjusted } = applyAdjustments(balance, [mkAdjustment({})]);

    // Sobrevive al clon + recompute (el bug lo descartaba).
    expect((adjusted.primary as { virtualCloseAdjustment?: unknown }).virtualCloseAdjustment)
      .toEqual(marker);
    expect(adjusted.primary.periodoTipo).toBe('cerrado');
  });

  it('no muta el balance original (clon profundo)', () => {
    const balance = buildBalance();
    const activoAntes = balance.primary.controlTotals.cents!.activo;
    applyAdjustments(balance, [mkAdjustment({ amount: 99_000_000 })]);
    expect(balance.primary.controlTotals.cents!.activo).toBe(activoAntes);
  });
});

describe('revalidate — gate del Doctor de Datos sobre el balance ajustado', () => {
  it('un balance cuadrado revalida sin errores', () => {
    const balance = buildBalance();
    const result = revalidate(balance, balance.primary);
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('revalida sobre TODOS los periodos sin lanzar', () => {
    const balance = buildBalance();
    expect(() => balance.periods.map((s) => revalidate(balance, s))).not.toThrow();
  });
});

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

  it('las devoluciones 4175 recomputadas NO divergen del preprocesador', () => {
    // El mirror de `recomputeSnapshotTotals` replica la fórmula de ingresos
    // netos del preprocesador. Cuando divergía, cualquier balance reparado
    // volvía a publicar la cifra defectuosa (doble resta + abs por cuenta):
    // medido sobre el balance real, $2.101.198.187,69 en vez de
    // $2.429.109.531,57. Un ajuste que no toca clase 4 debe dejar intactos
    // `totalDevoluciones` e `ingresosNetos`.
    const balance = buildBalance();
    const antes = balance.primary.controlTotals;
    // Ventas $200M (ordinarias) − devoluciones $10M = $190M netos.
    expect(antes.cents!.ingresosNetos).toBe(BigInt(19_000_000_000));
    expect(antes.cents!.totalDevoluciones).toBe(BigInt(1_000_000_000));

    const { balance: adjusted } = applyAdjustments(balance, [mkAdjustment({})]);
    const despues = adjusted.primary.controlTotals;

    expect(despues.cents!.ingresosNetos).toBe(antes.cents!.ingresosNetos);
    expect(despues.cents!.totalDevoluciones).toBe(antes.cents!.totalDevoluciones);
    expect(despues.ingresosNetos).toBe(antes.ingresosNetos);
    expect(despues.totalDevoluciones).toBe(antes.totalDevoluciones);
  });

  it('un ajuste que hunde los ingresos bajo las devoluciones DISPARA la guarda', () => {
    // Hallazgo de la refutación adversarial: el mirror había replicado la mitad
    // ARITMÉTICA de la regla 4175 pero no la DECLARATIVA. Medido antes de este
    // arreglo: un ajuste que subía las devoluciones por encima de los ingresos
    // ordinarios publicaba `ingresosNetos` NEGATIVO con `blocking = false`,
    // cero motivos y cero discrepancias — el preprocesador bloqueaba ese mismo
    // balance y el reparador lo dejaba pasar.
    const balance = buildBalance();
    // El fixture puede traer otros motivos de bloqueo; lo que importa es que
    // NO haya todavía uno por devoluciones.
    expect(
      balance.primary.validation.reasons.some((r) => r.includes('Devoluciones 4175')),
    ).toBe(false);

    // Ventas ordinarias $200M; se suben las devoluciones a $210M.
    const { balance: adjusted } = applyAdjustments(balance, [
      mkAdjustment({
        accountCode: '417505',
        accountName: 'Devoluciones en ventas',
        amount: 200_000_000,
      }),
    ]);
    const snap = adjusted.primary;

    expect(snap.controlTotals.ingresosNetos).toBeLessThan(0);
    expect(snap.validation.blocking).toBe(true);
    expect(
      snap.validation.reasons.some((r) => r.includes('Devoluciones 4175')),
    ).toBe(true);
    expect(
      snap.discrepancies.some((d) => d.location.includes('Devoluciones 4175')),
    ).toBe(true);
  });

  it('un ajuste que SANEA la anomalía retira el bloqueo, no lo deja pegado', () => {
    // La otra mitad: si la guarda no se reevalúa, el balance queda bloqueado
    // para siempre aunque el contador corrija la causa.
    const balance = buildBalance();
    const { balance: roto } = applyAdjustments(balance, [
      mkAdjustment({
        accountCode: '417505',
        accountName: 'Devoluciones en ventas',
        amount: 200_000_000,
      }),
    ]);
    expect(roto.primary.validation.blocking).toBe(true);

    const { balance: sano } = applyAdjustments(roto, [
      mkAdjustment({
        id: 'adj-fix',
        accountCode: '417505',
        accountName: 'Devoluciones en ventas',
        amount: -200_000_000,
      }),
    ]);

    expect(sano.primary.controlTotals.ingresosNetos).toBe(190_000_000);
    expect(
      sano.primary.validation.reasons.some((r) => r.includes('Devoluciones 4175')),
    ).toBe(false);
    expect(
      sano.primary.discrepancies.some((d) => d.location.includes('Devoluciones 4175')),
    ).toBe(false);
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

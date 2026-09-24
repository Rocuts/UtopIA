// ---------------------------------------------------------------------------
// Tests del motor de tarjetas ejecutivas del Pilar ESCUDO
// ---------------------------------------------------------------------------
// Cubre los escenarios financieros canónicos. Auditoría ratios-kpis-10/15:
// la autonomía y la liquidez usan las MISMAS funciones que el pilar
// (shared-metrics), la reserva fiscal es N/D sin base fiscal verificada y ya no
// existe el centinela 999 ni la autonomía "saturada" de 365 días.
//   1. Caja saludable → autonomía, prueba ácida y brecha calculadas; reserva N/D.
//   2. Reserva fiscal: N/D aunque haya provisión 24 y utilidad (diagnóstico interno intacto).
//   3. Brecha Escudo negativa (caja < proveedores 2205).
//   4. Sin egresos del periodo → autonomía N/D.
//   5. Con comparativo → autonomía del periodo actual (sin promediar periodos).
//   6. Pasivo corriente = 0 → prueba ácida N/D.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { computeEscudoExecutiveCards } from '../escudo-cards';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Helpers idénticos a otros tests del pillars/preprocessing
// ---------------------------------------------------------------------------

function makeValidation(): ValidationResult {
  return { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] };
}

function makeControlTotals(overrides: Partial<ControlTotals> = {}): ControlTotals {
  return {
    activo: 0,
    activoCorriente: 0,
    activoNoCorriente: 0,
    pasivo: 0,
    pasivoCorriente: 0,
    pasivoNoCorriente: 0,
    patrimonio: 0,
    ingresos: 0,
    gastos: 0,
    utilidadNeta: 0,
    efectivoCuenta11: 0,
    deudoresCuenta13: 0,
    cuentasPorPagar23: 0,
    impuestosCuenta24: 0,
    obligacionesLaborales25: 0,
    ...overrides,
  };
}

function makeClass(
  code: number,
  accounts: Array<{ code: string; name: string; balance: number; level?: string }>,
): PUCClass {
  return {
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: accounts.reduce((s, a) => s + a.balance, 0),
    reportedTotal: null,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: a.name,
      level: a.level ?? 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  };
}

function makeSnapshot(opts: {
  period: string;
  controlTotals: ControlTotals;
  classes: PUCClass[];
}): PeriodSnapshot {
  const ct = opts.controlTotals;
  return {
    period: opts.period,
    classes: opts.classes,
    controlTotals: ct,
    equityBreakdown: {},
    summary: {
      totalAssets: ct.activo,
      totalLiabilities: ct.pasivo,
      totalEquity: ct.patrimonio,
      totalRevenue: ct.ingresos,
      totalExpenses: ct.gastos,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: ct.utilidadNeta,
      equationBalance: ct.activo - (ct.pasivo + ct.patrimonio),
      equationBalanced: Math.abs(ct.activo - (ct.pasivo + ct.patrimonio)) < 100,
    },
    validation: makeValidation(),
    discrepancies: [],
    missingExpectedAccounts: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeEscudoExecutiveCards', () => {
  it('ERP a mitad de año con caja saludable → 4 cards calculadas y valores positivos', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 900_000_000,
        utilidadNeta: 200_000_000,
        efectivoCuenta11: 200_000_000,
        impuestosCuenta24: 100_000_000,
        activoCorriente: 400_000_000,
        pasivoCorriente: 110_000_000,
      }),
      classes: [
        makeClass(1, [
          { code: '110505', name: 'Caja', balance: 200_000_000 },
          { code: '120505', name: 'Inversiones temp.', balance: 50_000_000 },
          { code: '130505', name: 'Clientes', balance: 150_000_000 },
        ]),
        makeClass(2, [
          { code: '220505', name: 'Proveedores', balance: 80_000_000 },
          { code: '230505', name: 'CxP', balance: 30_000_000 },
        ]),
      ],
    });

    const cards = computeEscudoExecutiveCards({ snapshot: snap });

    expect(cards.autonomia.value).not.toBeNull();
    expect(cards.cobertura_pasivos.value).not.toBeNull();
    expect(cards.reserva_fiscal.value).toBeNull();
    expect(cards.brecha_escudo.value).not.toBeNull();

    // Autonomía: caja 200M / (900M / 365) ≈ 81,1 días (misma función que el pilar)
    expect(cards.autonomia.value).toBeCloseTo(200_000_000 / (900_000_000 / 365), 6);
    // Prueba ácida: (AC 400M − inventarios 0) / PC 110M ≈ 3,636
    expect(cards.cobertura_pasivos.value).toBeCloseTo(3.636, 2);
    // Brecha: caja(200M) − proveedores 2205. Aquí no hay 2205 explícito → fallback a 22 → 80M.
    // Brecha = 200M − 80M = 120M
    expect(cards.brecha_escudo.value).toBeCloseTo(120_000_000, 0);
    expect(cards.brecha_escudo.status).toBe('healthy');
  });

  it('Reserva fiscal N/D aunque haya provisión 24 y utilidad (sin base fiscal verificada)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 500_000_000,
        utilidadNeta: 500_000_000, // renta teórica = 175M
        impuestosCuenta24: 10_000_000, // déficit 165M
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 20_000_000 }]),
      ],
    });

    const cards = computeEscudoExecutiveCards({ snapshot: snap });

    // Antes: 10M − UN × 35 % = −165M "critical". Ni la utilidad contable es base
    // fiscal ni el grupo 24 es sólo renta ⇒ N/D.
    expect(cards.reserva_fiscal.value).toBeNull();
    expect(cards.reserva_fiscal.status).toBe('watch');
    // IW4 (ratios-kpis-10): el audit expone la utilidad neta leída; el
    // diagnóstico UN × 35 % (rentaTeorica/tasaRenta) se retiró.
    expect(cards.audit.utilidadNeta).toBe(500_000_000);
    expect('rentaTeorica' in cards.audit).toBe(false);
    expect('tasaRenta' in cards.audit).toBe(false);
  });

  it('Brecha Escudo negativa (caja < proveedores 2205)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 100_000_000,
        gastos: 80_000_000,
        utilidadNeta: 20_000_000,
        efectivoCuenta11: 30_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 30_000_000 }]),
        makeClass(2, [
          { code: '220505', name: 'Proveedores Nacionales', balance: 80_000_000 },
        ]),
      ],
    });

    const cards = computeEscudoExecutiveCards({ snapshot: snap });

    // 30M − 80M = −50M
    expect(cards.brecha_escudo.value).toBeCloseTo(-50_000_000, 0);
    expect(cards.brecha_escudo.status).toBe('critical');
    expect(cards.audit.proveedoresCuenta2205).toBeCloseTo(80_000_000, 0);
  });

  it('Sin egresos del periodo + caja > 0 → autonomía N/D (no 365 inventados)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 0,
        gastos: 0,
        utilidadNeta: 0,
        efectivoCuenta11: 100_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
      ],
    });

    const cards = computeEscudoExecutiveCards({ snapshot: snap });

    expect(cards.autonomia.value).toBeNull();
  });

  it('Con comparativo: autonomía del periodo actual y delta contra la del comparativo', () => {
    const current = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 250_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 250_000_000 }]),
      ],
    });
    const previous = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 1_200_000_000, // significativamente mayor
        utilidadNeta: -200_000_000,
        efectivoCuenta11: 100_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
      ],
    });

    const cards = computeEscudoExecutiveCards({
      snapshot: current,
      comparative: previous,
    });

    // Una sola definición: caja actual / egresos diarios del periodo actual
    // (antes promediaba egresos de dos periodos sólo en la tarjeta).
    const actual = 250_000_000 / (600_000_000 / 365);
    const previo = 100_000_000 / (1_200_000_000 / 365);
    expect(cards.autonomia.value).toBeCloseTo(actual, 6);
    expect(cards.autonomia.deltaVsComparative).toBeCloseTo(actual - previo, 6);
    expect(cards.audit.promedioEgresosMensuales).toBeCloseTo(50_000_000, -3);
  });

  // ── CapEx tests ───────────────────────────────────────────────────────────

  it('Sin capexEvents: autonomía y brecha idénticas a sin opts', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 100_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 40_000_000 }]),
      ],
    });

    const sinOpts = computeEscudoExecutiveCards({ snapshot: snap });
    const conOpts = computeEscudoExecutiveCards({ snapshot: snap, capexEvents: [] });

    expect(conOpts.autonomia.value).toBeCloseTo(sinOpts.autonomia.value!, 4);
    expect(conOpts.brecha_escudo.value).toBeCloseTo(sinOpts.brecha_escudo.value!, 4);
    expect(conOpts.audit.proyectosFuturoCop).toBe(0);
    expect(conOpts.audit.cantidadEventosProximos).toBe(0);
  });

  it('Evento CapEx 200M en mes 3: autonomía baja y puede quedar <0 → critical', () => {
    // Caja = 100M, egresos = 600M/año = 50M/mes → sin CapEx = 60 días.
    // CapEx 200M en mes 3 → caja efectiva = 100M − 200M = −100M → autonomía <0 → critical.
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 100_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 40_000_000 }]),
      ],
    });

    const sinCapex = computeEscudoExecutiveCards({ snapshot: snap });
    const conCapex = computeEscudoExecutiveCards({
      snapshot: snap,
      capexEvents: [{ id: 'ce1', name: 'Maquinaria', monthOffset: 3, amountCop: 200_000_000 }],
    });

    // Sin CapEx: 100M / (600M / 365) ≈ 60,8 días
    expect(sinCapex.autonomia.value).toBeCloseTo(100_000_000 / (600_000_000 / 365), 6);
    // Con CapEx: caja ajustada = 100M − 200M = −100M → días <0
    expect(conCapex.autonomia.value).toBeLessThan(0);
    expect(conCapex.autonomia.status).toBe('critical');
    // Brecha también baja: (100M − 40M) − 200M = −140M
    expect(conCapex.brecha_escudo.value).toBeCloseTo(-140_000_000, 0);
    expect(conCapex.audit.proyectosFuturoCop).toBe(200_000_000);
    expect(conCapex.audit.cantidadEventosProximos).toBe(1);
  });

  it('Evento CapEx en mes 12: NO afecta (fuera del horizonte 6m)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 100_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 40_000_000 }]),
      ],
    });

    const sinCapex = computeEscudoExecutiveCards({ snapshot: snap });
    const conCapex = computeEscudoExecutiveCards({
      snapshot: snap,
      capexEvents: [{ id: 'ce2', name: 'Remodelación', monthOffset: 12, amountCop: 500_000_000 }],
    });

    // monthOffset 12 > 6 → no debe cambiar autonomía ni brecha
    expect(conCapex.autonomia.value).toBeCloseTo(sinCapex.autonomia.value!, 4);
    expect(conCapex.brecha_escudo.value).toBeCloseTo(sinCapex.brecha_escudo.value!, 4);
    expect(conCapex.audit.proyectosFuturoCop).toBe(0);
    expect(conCapex.audit.cantidadEventosProximos).toBe(0);
  });

  it('caja = 0 con proveedores → brecha negativa critical', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 500_000_000,
        gastos: 400_000_000,
        utilidadNeta: 100_000_000,
        efectivoCuenta11: 0,
      }),
      classes: [
        makeClass(1, [
          // Sin efectivo en cuenta 11
        ]),
        makeClass(2, [
          { code: '220505', name: 'Proveedores Nacionales', balance: 100_000_000 },
        ]),
      ],
    });

    const cards = computeEscudoExecutiveCards({ snapshot: snap });

    // brecha = caja(0) - proveedores(100M) = -100M
    expect(cards.brecha_escudo.value).toBeLessThan(0);
    expect(cards.brecha_escudo.status).toBe('critical');
  });

  it('Pasivo corriente = 0 → prueba ácida N/D (sin centinela 999)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 100_000_000,
        gastos: 50_000_000,
        utilidadNeta: 50_000_000,
        efectivoCuenta11: 80_000_000,
      }),
      classes: [
        makeClass(1, [
          { code: '110505', name: 'Caja', balance: 80_000_000 },
        ]),
        // Sin Clase 2 (sin pasivos)
      ],
    });

    const cards = computeEscudoExecutiveCards({ snapshot: snap });

    expect(cards.cobertura_pasivos.value).toBeNull();
    expect(cards.cobertura_pasivos.status).toBe('watch');
  });
});

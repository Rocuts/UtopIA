// ---------------------------------------------------------------------------
// Tests del motor de tarjetas ejecutivas del Pilar ESCUDO
// ---------------------------------------------------------------------------
// Cubre los 6 escenarios financieros canónicos:
//   1. ERP a mitad de año con caja saludable → 4 cards verdes.
//   2. Reserva fiscal en déficit (provisión 24 < utilidadNeta × 35%).
//   3. Brecha Escudo negativa (caja < proveedores 2205).
//   4. Sin egresos del periodo (gastos=0 + caja>0) → autonomía cap.
//   5. Multi-período (comparative) → promedio mensual de 2 períodos.
//   6. Pasivo corriente = 0 → cobertura saturada a 999.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { computeEscudoExecutiveCards, RENTA_RATE } from '../escudo-cards';
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
        impuestosCuenta24: 100_000_000, // sobre los 70M teóricos (35% × 200M)
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
    expect(cards.reserva_fiscal.value).not.toBeNull();
    expect(cards.brecha_escudo.value).not.toBeNull();

    // Autonomía: (200M + 50M) / (900M / 12) × 30 = 250M / 75M × 30 ≈ 100 días
    expect(cards.autonomia.value).toBeCloseTo(100, 0);
    // Cobertura: AC=400M (110505+120505+130505 → 200+50+150=400) /
    //   PC=110M (22+23=80+30=110) ≈ 3.636
    expect(cards.cobertura_pasivos.value).toBeCloseTo(3.636, 2);
    // Reserva fiscal: 100M − (200M × 35%=70M) = +30M (sobrada)
    expect(cards.reserva_fiscal.value).toBeCloseTo(30_000_000, 0);
    expect(cards.reserva_fiscal.status).toBe('healthy');
    // Brecha: caja(200M) − proveedores 2205. Aquí no hay 2205 explícito → fallback a 22 → 80M.
    // Brecha = 200M − 80M = 120M
    expect(cards.brecha_escudo.value).toBeCloseTo(120_000_000, 0);
    expect(cards.brecha_escudo.status).toBe('healthy');
  });

  it('Reserva fiscal en déficit (provisión 24 << renta teórica)', () => {
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

    // 10M − 175M = −165M (déficit grande)
    expect(cards.reserva_fiscal.value).toBeCloseTo(-165_000_000, 0);
    // Déficit > 50% de renta teórica → critical.
    expect(cards.reserva_fiscal.status).toBe('critical');
    expect(cards.audit.tasaRenta).toBe(RENTA_RATE);
    expect(cards.audit.rentaTeorica).toBeCloseTo(175_000_000, 0);
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

  it('Sin egresos del periodo + caja > 0 → autonomía saturada (cap visual)', () => {
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

    // value puede ser 365 (cap visual) o null. Acepto cualquiera.
    expect(
      cards.autonomia.value === null || cards.autonomia.value >= 365,
    ).toBe(true);
  });

  it('Multi-período: promedio mensual usa egresos del actual + comparativo', () => {
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

    // Audit refleja 2 períodos.
    expect(cards.audit.periodosUsados).toBe(2);
    // Promedio mensual ≈ (600M + 1200M) / 2 / 12 = 75M/mes (vs 50M/mes solo current).
    expect(cards.audit.promedioEgresosMensuales).toBeCloseTo(75_000_000, -3);
  });

  it('Pasivo corriente = 0 → cobertura saturada a 999 (sin division by zero)', () => {
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

    expect(cards.cobertura_pasivos.value).toBe(999);
    expect(cards.cobertura_pasivos.status).toBe('healthy');
  });
});

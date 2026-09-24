// ---------------------------------------------------------------------------
// Tests del motor de tarjetas ejecutivas del Pilar FUTURO
// ---------------------------------------------------------------------------
// Cubre los 6 escenarios canónicos del Simulador Predictivo:
//   1. Sin comparative → CAGR null; provisión tributaria N/D (ratios-kpis-10).
//   2. Con comparative ingresos crecientes → CAGR positivo + provisión > snapshot.
//   3. Con comparative ingresos decrecientes → CAGR negativo + status warning.
//   4. Caja saludable, escenario base no cae → punto_quiebre null.
//   5. Caja escasa con gastos altos → punto_quiebre <= 6 meses → critical.
//   6. Capacidad de inversión → N/D sin base fiscal verificada (ratios-kpis-19).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { computeFuturoExecutiveCards } from '../futuro-cards';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Helpers
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
  classes?: PUCClass[];
}): PeriodSnapshot {
  const ct = opts.controlTotals;
  return {
    period: opts.period,
    classes: opts.classes ?? [],
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

describe('computeFuturoExecutiveCards', () => {
  // ratios-kpis-10: la provisión tributaria era UN × (1 + CAGR ?? 5 %) × 35 %,
  // una métrica fiscal heurística sin base verificada. Ahora N/D. El audit
  // conserva el diagnóstico interno que lee single-source-validator.
  it('sin comparative → CAGR null + provisión tributaria N/D', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 700_000_000,
        utilidadNeta: 300_000_000,
        efectivoCuenta11: 200_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({ snapshot: snap });

    expect(cards.cagr.value).toBeNull();
    expect(cards.audit.cagrIngresos).toBeNull();
    // IW4 (ratios-kpis-10): sin diagnóstico UN × (1 + CAGR) × 35 %; el audit
    // expone la utilidad neta leída.
    expect(cards.audit.utilidadProyectadaAnual).toBeUndefined();
    expect(cards.audit.utilidadNeta).toBe(300_000_000);
    expect(cards.provision_tributaria.value).toBeNull();
    expect(cards.audit.provisionTributariaFutura).toBeNull();
  });

  it('con comparative ingresos crecientes 20% → CAGR positivo', () => {
    const current = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000, // +20% vs 1.0B
        gastos: 800_000_000,
        utilidadNeta: 400_000_000,
        efectivoCuenta11: 300_000_000,
      }),
    });
    const previous = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 700_000_000,
        utilidadNeta: 300_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({
      snapshot: current,
      comparative: previous,
    });

    expect(cards.cagr.value).toBeCloseTo(0.20, 2); // +20%
    expect(cards.cagr.status).toBe('healthy'); // >=10%
    expect(cards.audit.cagrIngresos).toBeCloseTo(0.20, 2);
    expect(cards.audit.periodosCagr).toBe(2);
  });

  it('con comparative ingresos decrecientes → CAGR negativo + status critical', () => {
    const current = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 800_000_000, // -20% vs 1.0B
        gastos: 700_000_000,
        utilidadNeta: 100_000_000,
      }),
    });
    const previous = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({
      snapshot: current,
      comparative: previous,
    });

    expect(cards.cagr.value).toBeCloseTo(-0.20, 2);
    expect(cards.cagr.status).toBe('critical');
  });

  it('caja saludable, escenario base no cae → punto_quiebre null', () => {
    // Caja inicial 1.000M, ingresos 1.200M/año (= 100M/mes), gastos 600M/año (50M/mes).
    // Con factor conservador 0.85: ingresoEfectivo=85M, egreso=50M → +35M/mes neto.
    // Caja siempre crece. monthsToZero = null (>36).
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 1_000_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({ snapshot: snap });

    expect(cards.punto_quiebre.value).toBeNull();
    expect(cards.audit.mesesAlQuiebreConservador).toBeNull();
    expect(cards.punto_quiebre.status).toBe('healthy');
  });

  it('caja escasa con gastos altos → punto_quiebre temprano (<= 6 meses) → critical', () => {
    // Caja 100M, ingresos 0 (peor caso), gastos 600M/año = 50M/mes.
    // Conservador: ingresos=0, egreso=50M → caja agota en 100M/50M = 2 meses.
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 0,
        gastos: 600_000_000,
        utilidadNeta: -600_000_000,
        efectivoCuenta11: 100_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({ snapshot: snap });

    expect(cards.punto_quiebre.value).not.toBeNull();
    expect(cards.punto_quiebre.value!).toBeLessThanOrEqual(6);
    expect(cards.punto_quiebre.status).toBe('critical');
  });

  // ratios-kpis-19: antes esta tarjeta (caja − max(0, UN × 35 % − PUC 24) −
  // 60 días) y el KPI del pilar (caja − UN × 35 % − 60 días) daban dos cifras
  // distintas con la misma etiqueta. Ahora una sola función, N/D sin base
  // fiscal verificada.
  it('capacidad de inversión sin base fiscal verificada → N/D (no una cifra con UN × 35 %)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_500_000_000,
        gastos: 1_200_000_000,
        utilidadNeta: 500_000_000,
        efectivoCuenta11: 50_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({ snapshot: snap });

    expect(cards.capacidad_inversion.value).toBeNull();
    expect(cards.capacidad_inversion.status).toBe('watch');
    expect(cards.audit.capacidadInversion).toBeNull();
  });

  it('utilidadNeta negativa → provisión N/D (no 0) y la utilidad leída conserva el signo', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 800_000_000,
        gastos: 1_000_000_000,
        utilidadNeta: -200_000_000,
        efectivoCuenta11: 100_000_000,
      }),
    });

    const cards = computeFuturoExecutiveCards({ snapshot: snap });

    expect(cards.provision_tributaria.value).toBeNull();
    expect(cards.audit.utilidadNeta).toBe(-200_000_000);
  });
});

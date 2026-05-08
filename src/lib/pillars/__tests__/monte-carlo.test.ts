// ---------------------------------------------------------------------------
// Monte Carlo — tests unitarios
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  runMonteCarlo,
  computeDistribution,
  mulberry32,
  normalRandom,
} from '../monte-carlo';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function makeSnapshot(
  controlTotals: ControlTotals,
  classes: PUCClass[] = [],
): PeriodSnapshot {
  return {
    period: '2025',
    classes,
    controlTotals,
    equityBreakdown: {},
    summary: {
      totalAssets: controlTotals.activo,
      totalLiabilities: controlTotals.pasivo,
      totalEquity: controlTotals.patrimonio,
      totalRevenue: controlTotals.ingresos,
      totalExpenses: 0,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: controlTotals.utilidadNeta,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: makeValidation(),
    discrepancies: [],
    missingExpectedAccounts: [],
  };
}

/** Crea una PUCClass mínima con cuentas de balance dado. */
function makeClass15(balance: number): PUCClass {
  return {
    code: 15,
    name: 'Propiedades Planta y Equipo',
    auxiliaryTotal: balance,
    reportedTotal: balance,
    discrepancy: 0,
    accounts: [
      {
        code: '1516',
        name: 'Maquinaria',
        level: 'Auxiliar',
        balance,
        isLeaf: true,
      },
    ],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('mulberry32', () => {
  it('genera secuencias reproducibles con la misma seed', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('genera valores en [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('normalRandom', () => {
  it('produce media y sigma aproximadas en N grande', () => {
    const rng = mulberry32(1);
    const values: number[] = [];
    for (let i = 0; i < 10000; i++) values.push(normalRandom(rng, 100, 15));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeCloseTo(100, 0); // dentro de 1 unidad
  });
});

describe('computeDistribution', () => {
  it('p10 < p50 < p90 para distribución no trivial', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i);
    const d = computeDistribution(values);
    expect(d.p10).toBeLessThan(d.p50);
    expect(d.p50).toBeLessThan(d.p90);
  });

  it('maneja array vacío sin excepciones', () => {
    const d = computeDistribution([]);
    expect(d.mean).toBe(0);
    expect(d.stdev).toBe(0);
  });

  it('array de un elemento: p10=p50=p90=mean, stdev=0', () => {
    const d = computeDistribution([7]);
    expect(d.p10).toBe(7);
    expect(d.p50).toBe(7);
    expect(d.p90).toBe(7);
    expect(d.mean).toBe(7);
    expect(d.stdev).toBe(0);
  });
});

describe('runMonteCarlo — determinismo', () => {
  it('dos corridas con misma seed producen exactamente el mismo output', () => {
    const ct = makeControlTotals({
      ingresos: 1_200_000_000,
      gastos: 900_000_000,
      efectivoCuenta11: 50_000_000,
      activoNoCorriente: 300_000_000,
    });
    const snap = makeSnapshot(ct);

    const r1 = runMonteCarlo(snap, { seed: 42, iterations: 200 });
    const r2 = runMonteCarlo(snap, { seed: 42, iterations: 200 });

    expect(r1.cajaFinal).toEqual(r2.cajaFinal);
    expect(r1.probabilidadQuiebre12m).toBe(r2.probabilidadQuiebre12m);
    expect(r1.mesQuiebreMediano).toBe(r2.mesQuiebreMediano);
  });

  it('seed diferente produce resultado diferente', () => {
    const ct = makeControlTotals({
      ingresos: 1_200_000_000,
      gastos: 900_000_000,
      efectivoCuenta11: 50_000_000,
    });
    const snap = makeSnapshot(ct);
    const r1 = runMonteCarlo(snap, { seed: 1 });
    const r2 = runMonteCarlo(snap, { seed: 99 });
    expect(r1.cajaFinal.mean).not.toBe(r2.cajaFinal.mean);
  });
});

describe('runMonteCarlo — configuración por defecto', () => {
  it('corre 9600 iteraciones por defecto', () => {
    const snap = makeSnapshot(makeControlTotals({ ingresos: 100_000_000, gastos: 80_000_000 }));
    const r = runMonteCarlo(snap);
    expect(r.iterations).toBe(9600);
  });

  it('usa seed 42 por defecto', () => {
    const snap = makeSnapshot(makeControlTotals({ ingresos: 100_000_000, gastos: 80_000_000 }));
    const r = runMonteCarlo(snap);
    expect(r.seed).toBe(42);
  });
});

describe('runMonteCarlo — sanity de distribuciones', () => {
  it('p10 < p50 < p90 en cajaFinal', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 900_000_000,
        efectivoCuenta11: 100_000_000,
      }),
    );
    const r = runMonteCarlo(snap);
    expect(r.cajaFinal.p10).toBeLessThan(r.cajaFinal.p50);
    expect(r.cajaFinal.p50).toBeLessThan(r.cajaFinal.p90);
  });

  it('p10 < p50 < p90 en utilidadAcumulada', () => {
    const snap = makeSnapshot(
      makeControlTotals({ ingresos: 600_000_000, gastos: 400_000_000 }),
    );
    const r = runMonteCarlo(snap);
    expect(r.utilidadAcumulada.p10).toBeLessThan(r.utilidadAcumulada.p50);
    expect(r.utilidadAcumulada.p50).toBeLessThan(r.utilidadAcumulada.p90);
  });
});

describe('runMonteCarlo — probabilidad de quiebre', () => {
  it('ingresos >> egresos → probabilidadQuiebre12m baja (<10%)', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000, // 100M/mes
        gastos: 120_000_000,     // 10M/mes — holgura enorme
        efectivoCuenta11: 500_000_000,
      }),
    );
    const r = runMonteCarlo(snap);
    expect(r.probabilidadQuiebre12m).toBeLessThan(0.1);
  });

  it('egresos >> ingresos → probabilidadQuiebre12m alta (>50%)', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 120_000_000,   // 10M/mes
        gastos: 1_200_000_000,   // 100M/mes — déficit enorme
        efectivoCuenta11: 0,
      }),
    );
    const r = runMonteCarlo(snap);
    expect(r.probabilidadQuiebre12m).toBeGreaterThan(0.5);
  });

  it('mesQuiebreMediano no nulo cuando prob >= 50%', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 120_000_000,
        gastos: 1_200_000_000,
        efectivoCuenta11: 0,
      }),
    );
    const r = runMonteCarlo(snap);
    if (r.probabilidadQuiebre12m >= 0.5) {
      expect(r.mesQuiebreMediano).not.toBeNull();
      expect(r.mesQuiebreMediano).toBeGreaterThanOrEqual(1);
      expect(r.mesQuiebreMediano).toBeLessThanOrEqual(12);
    }
  });
});

describe('runMonteCarlo — ROI probabilístico', () => {
  it('inversionPPE=0 → roiProbabilistico=null', () => {
    // Sin clase 15 y activoNoCorriente=0
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 600_000_000,
        gastos: 400_000_000,
        activoNoCorriente: 0,
      }),
    );
    const r = runMonteCarlo(snap);
    expect(r.roiProbabilistico).toBeNull();
  });

  it('inversionPPE > 0 y utilidad positiva → roiProbabilistico.mean > 0', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        activoNoCorriente: 500_000_000,
      }),
      [makeClass15(500_000_000)],
    );
    const r = runMonteCarlo(snap);
    expect(r.roiProbabilistico).not.toBeNull();
    expect(r.roiProbabilistico!.mean).toBeGreaterThan(0);
  });

  it('inversionPPE viene de clase 15 cuando existe', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 600_000_000,
        gastos: 400_000_000,
        activoNoCorriente: 999_000_000, // debe ignorarse cuando hay clase 15
      }),
      [makeClass15(200_000_000)],
    );
    const r = runMonteCarlo(snap);
    expect(r.inversionPPE).toBe(200_000_000);
  });

  it('fallback activoNoCorriente cuando no hay clase 15', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 600_000_000,
        gastos: 400_000_000,
        activoNoCorriente: 300_000_000,
      }),
      // sin clase 15
    );
    const r = runMonteCarlo(snap);
    expect(r.inversionPPE).toBe(300_000_000);
  });
});

describe('runMonteCarlo — iteraciones degeneradas', () => {
  it('iterations=1 retorna distribución degenerada (p10=p50=p90) y no crashea', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 900_000_000,
        efectivoCuenta11: 100_000_000,
      }),
    );

    const result = runMonteCarlo(snap, { iterations: 1 });

    expect(result.iterations).toBe(1);
    // Con un solo valor, p10 = p50 = p90 (distribución degenerada)
    expect(result.cajaFinal.p10).toBe(result.cajaFinal.p50);
    expect(result.cajaFinal.p50).toBe(result.cajaFinal.p90);
    // No crashea — probabilidadQuiebre es un número válido [0,1]
    expect(result.probabilidadQuiebre12m).toBeGreaterThanOrEqual(0);
    expect(result.probabilidadQuiebre12m).toBeLessThanOrEqual(1);
  });
});

describe('runMonteCarlo — performance', () => {
  it('9600 simulaciones × 12 meses completan en <500ms', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 900_000_000,
        efectivoCuenta11: 100_000_000,
      }),
    );
    const start = performance.now();
    runMonteCarlo(snap); // defaults: 9600 iters, H=12
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

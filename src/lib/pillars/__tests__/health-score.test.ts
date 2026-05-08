// ---------------------------------------------------------------------------
// Pillars Service — tests unitarios.
// ---------------------------------------------------------------------------
// Cubrimos: helpers de scoring, los 4 pilares individuales, edge cases
// (sin comparativo, gastos=0, utilidad=0), y el orquestador `aggregatePillars`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { aggregatePillars } from '../service';
import { computeEscudoPillar } from '../escudo';
import { computeValorPillar } from '../valor';
import { computeVerdadPillar } from '../verdad';
import { computeFuturoPillar } from '../futuro';
import { clampScore, kpiToScore, scoreToStatus, weightedScore } from '../health-score';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';

// ───────────────────────────────────────────────────────────────────────────
// Helpers (similar a los del curator)
// ───────────────────────────────────────────────────────────────────────────

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
      totalExpenses: 0,
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

// ───────────────────────────────────────────────────────────────────────────
// Helpers numéricos
// ───────────────────────────────────────────────────────────────────────────

describe('health-score helpers', () => {
  it('scoreToStatus mapea bandas correctamente', () => {
    expect(scoreToStatus(95)).toBe('healthy');
    expect(scoreToStatus(75)).toBe('watch');
    expect(scoreToStatus(45)).toBe('warning');
    expect(scoreToStatus(15)).toBe('critical');
  });

  it('clampScore restringe al rango [0, 100]', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(105)).toBe(100);
    expect(clampScore(73.4)).toBe(73);
    expect(clampScore(NaN)).toBe(0);
    expect(clampScore(Infinity)).toBe(100);
  });

  it('weightedScore promedia ponderado y maneja pesos cero', () => {
    expect(weightedScore([{ score: 100, weight: 0.5 }, { score: 0, weight: 0.5 }])).toBe(50);
    expect(weightedScore([])).toBe(0);
    expect(weightedScore([{ score: 80, weight: 1 }])).toBe(80);
  });

  it('kpiToScore higher-better', () => {
    const th = { healthy: 100, watch: 50, warning: 25 };
    expect(kpiToScore(120, th, 'higher-better')).toBe(95);
    expect(kpiToScore(60, th, 'higher-better')).toBe(75);
    expect(kpiToScore(30, th, 'higher-better')).toBe(50);
    expect(kpiToScore(10, th, 'higher-better')).toBe(15);
    expect(kpiToScore(null, th, 'higher-better')).toBe(50); // neutral
  });

  it('kpiToScore lower-better', () => {
    const th = { healthy: 0.01, watch: 0.05, warning: 0.10 };
    expect(kpiToScore(0.005, th, 'lower-better')).toBe(95);
    expect(kpiToScore(0.04, th, 'lower-better')).toBe(75);
    expect(kpiToScore(0.08, th, 'lower-better')).toBe(50);
    expect(kpiToScore(0.20, th, 'lower-better')).toBe(15);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pilar ESCUDO
// ───────────────────────────────────────────────────────────────────────────

describe('Escudo Pillar', () => {
  it('empresa healthy: días autonomía altos, solvencia >1.5, cobertura 100%', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        activoCorriente: 800_000_000,
        pasivoCorriente: 400_000_000, // solvencia 2.0
        efectivoCuenta11: 500_000_000,
        gastos: 600_000_000, // 1.6M/día → 304 días
        utilidadNeta: 200_000_000,
        impuestosCuenta24: 70_000_000, // 100% de la renta esperada (70M)
      }),
    });
    const out = computeEscudoPillar({ snapshot: snap });
    expect(out.healthScore).toBeGreaterThanOrEqual(85);
    expect(out.status).toMatch(/healthy|watch/);
    expect(out.kpis).toHaveLength(3);
  });

  it('empresa stress: caja baja, solvencia <1.0, cobertura mala', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        activoCorriente: 200_000_000,
        pasivoCorriente: 400_000_000, // solvencia 0.5
        efectivoCuenta11: 5_000_000,
        gastos: 600_000_000, // 5M / 1.64M = 3 días
        utilidadNeta: 200_000_000,
        impuestosCuenta24: 5_000_000, // 7% de la esperada
      }),
    });
    const out = computeEscudoPillar({ snapshot: snap });
    expect(out.healthScore).toBeLessThan(40);
    expect(out.status).toMatch(/warning|critical/);
    expect(out.alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('días autonomía null cuando gastos=0 y caja=0 (no NaN)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ gastos: 0, efectivoCuenta11: 0 }),
    });
    const out = computeEscudoPillar({ snapshot: snap });
    expect(out.kpis[0].value).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pilar VALOR
// ───────────────────────────────────────────────────────────────────────────

describe('Valor Pillar', () => {
  it('healthy: margen alto, ROE 20%, EVA positivo', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 400_000_000,
        pasivoCorriente: 200_000_000,
        patrimonio: 600_000_000,
        ingresos: 2_000_000_000,
        utilidadNeta: 300_000_000, // margen 15%
        impuestosCuenta24: 100_000_000,
      }),
    });
    const out = computeValorPillar({ snapshot: snap });
    expect(out.healthScore).toBeGreaterThanOrEqual(70);
    expect(out.kpis[0].key).toBe('margen_neto_real');
  });

  it('utilidad=0 → ROE 0, no throw', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        utilidadNeta: 0,
        patrimonio: 100_000_000,
      }),
    });
    const out = computeValorPillar({ snapshot: snap });
    expect(out.kpis[1].value).toBe(0);
  });

  it('margen negativo dispara alerta', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        utilidadNeta: -100_000_000,
      }),
    });
    const out = computeValorPillar({ snapshot: snap });
    expect(out.alerts.some((a) => a.code === 'VALUE-MARGIN-NEG')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pilar VERDAD
// ───────────────────────────────────────────────────────────────────────────

describe('Verdad Pillar', () => {
  it('healthy con cuadratura cuadrada y forensic 95', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
      }),
    });
    const out = computeVerdadPillar({
      snapshot: snap,
      forensic: { score: 95, totalAnomalies: 0, bySeverity: { low: 0, medium: 0, high: 0 } },
      conciliation: { totalEntries: 100, reconciledEntries: 90 },
    });
    expect(out.healthScore).toBeGreaterThanOrEqual(80);
  });

  it('brecha >1% → score capped a 30', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 500_000_000,
        patrimonio: 100_000_000, // gap 400M = 40% del activo
      }),
    });
    const out = computeVerdadPillar({
      snapshot: snap,
      forensic: { score: 95, totalAnomalies: 0, bySeverity: { low: 0, medium: 0, high: 0 } },
    });
    expect(out.healthScore).toBeLessThanOrEqual(30);
    expect(out.status).toBe('critical');
    expect(out.alerts.some((a) => a.code === 'TRUTH-EQ-GAP')).toBe(true);
  });

  it('sin conciliación data → KPI value null pero pilar funciona', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ activo: 1_000_000_000, pasivo: 600_000_000, patrimonio: 400_000_000 }),
    });
    const out = computeVerdadPillar({ snapshot: snap });
    const conciliacionKpi = out.kpis.find((k) => k.key === 'indice_conciliacion');
    expect(conciliacionKpi?.value).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pilar FUTURO
// ───────────────────────────────────────────────────────────────────────────

describe('Futuro Pillar', () => {
  it('runway largo (caja > gastos × 24m) → healthy', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        efectivoCuenta11: 1_000_000_000,
        ingresos: 2_400_000_000, // 200M/mes
        gastos: 1_200_000_000, // 100M/mes
        utilidadNeta: 1_200_000_000,
        activo: 2_000_000_000,
        pasivoCorriente: 100_000_000,
      }),
    });
    const out = computeFuturoPillar({ snapshot: snap });
    expect(out.healthScore).toBeGreaterThanOrEqual(70);
  });

  it('punto de inflexión <12 meses → critical (cap 30)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        efectivoCuenta11: 50_000_000,
        ingresos: 600_000_000, // 50M/mes
        gastos: 720_000_000, // 60M/mes — déficit 10M base
        utilidadNeta: 0,
      }),
    });
    const out = computeFuturoPillar({ snapshot: snap });
    expect(out.healthScore).toBeLessThanOrEqual(30);
    expect(out.status).toBe('critical');
    expect(out.alerts.some((a) => a.code === 'FUTURE-INFLECTION-NEAR')).toBe(true);
  });

  it('CapEx negativo dispara alerta', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        efectivoCuenta11: 10_000_000,
        utilidadNeta: 100_000_000,
        gastos: 100_000_000,
      }),
    });
    const out = computeFuturoPillar({ snapshot: snap });
    expect(out.alerts.some((a) => a.code === 'FUTURE-CAPEX-NEG')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Orquestador
// ───────────────────────────────────────────────────────────────────────────

describe('aggregatePillars', () => {
  it('retorna PillarsResult con los 4 pilares + overallScore', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        activoCorriente: 600_000_000,
        pasivo: 400_000_000,
        pasivoCorriente: 200_000_000,
        patrimonio: 600_000_000,
        ingresos: 2_000_000_000,
        gastos: 1_500_000_000,
        utilidadNeta: 500_000_000,
        impuestosCuenta24: 175_000_000,
        efectivoCuenta11: 300_000_000,
      }),
    });
    const out = aggregatePillars({ snapshot: snap });
    expect(out.escudo.pillarId).toBe('escudo');
    expect(out.valor.pillarId).toBe('valor');
    expect(out.verdad.pillarId).toBe('verdad');
    expect(out.futuro.pillarId).toBe('futuro');
    expect(out.overallScore).toBeGreaterThan(0);
    expect(out.overallScore).toBeLessThanOrEqual(100);
  });

  it('no muta el snapshot original', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ ingresos: 1_000_000_000, utilidadNeta: 100_000_000 }),
    });
    const before = JSON.stringify(snap);
    aggregatePillars({ snapshot: snap });
    expect(JSON.stringify(snap)).toBe(before);
  });

  it('captura errores por pilar individualmente', () => {
    // Forzar error: snapshot.controlTotals undefined → cada pilar accede a `.activo` y falla.
    const broken = {
      period: '2026',
      classes: [],
      controlTotals: undefined as unknown as ControlTotals,
      equityBreakdown: {},
      summary: {
        totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalRevenue: 0,
        totalExpenses: 0, totalCosts: 0, totalProduction: 0, netIncome: 0,
        equationBalance: 0, equationBalanced: true,
      },
      validation: makeValidation(),
      discrepancies: [],
      missingExpectedAccounts: [],
    } as PeriodSnapshot;
    const out = aggregatePillars({ snapshot: broken });
    expect(out.escudo.errors).toBeDefined();
    expect(out.valor.errors).toBeDefined();
    expect(out.verdad.errors).toBeDefined();
    expect(out.futuro.errors).toBeDefined();
    expect(out.overallScore).toBe(0);
  });
});

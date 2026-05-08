// ---------------------------------------------------------------------------
// Tests del motor de tarjetas ejecutivas del Pilar VALOR
// ---------------------------------------------------------------------------
// Cubre 8 escenarios:
//   1. EBITDA con segregación completa (5410 + 5305 + 5160 + 5165).
//   2. EBITDA fallback sin segregación (clase 5 sin 5410/5305).
//   3. WAOO = EBITDA / ingresos, status healthy ≥15%.
//   4. Ratio (gastos+costos)/ingresos, lower-better thresholds.
//   5. FCF con EFE indirecto disponible.
//   6. FCF null cuando no hay EFE (sin cashFlowIndirecto).
//   7. Edge: ingresos = 0 → WAOO y Ratio son null.
//   8. Edge: utilidadNeta negativa (pérdida real).
//   9. Audit expone utilidadNeta directamente (FIX B1).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { computeValorExecutiveCards } from '../valor-cards';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';
import type { CashFlowStatement } from '@/lib/preprocessing/curator-rules/types';

// ---------------------------------------------------------------------------
// Helpers idénticos al patrón de escudo-cards.test.ts
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
  cashFlowIndirecto?: CashFlowStatement;
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
    cashFlowIndirecto: opts.cashFlowIndirecto,
  };
}

function makeCashFlow(operatingTotal: number, varPPE: number): CashFlowStatement {
  return {
    period: '2026',
    comparativePeriod: '2025',
    operating: {
      utilidadNeta: 0,
      depreciacionAmortizacion: 0,
      varCuentasPorCobrar: 0,
      varInventarios: 0,
      varProveedores: 0,
      varCuentasPorPagar: 0,
      varImpuestosPorPagar: 0,
      varObligacionesLaborales: 0,
      total: operatingTotal,
    },
    investing: {
      varPPE,
      otros: 0,
      total: -Math.abs(varPPE),
    },
    financing: {
      varObligacionesFinancieras: 0,
      varCapitalReservas: 0,
      dividendosEstimados: 0,
      total: 0,
    },
    netChangeInCash: operatingTotal - Math.abs(varPPE),
    observedChangeInCash: operatingTotal - Math.abs(varPPE),
    reconciliationGap: 0,
    reconciled: true,
    inferred: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeValorExecutiveCards', () => {
  it('EBITDA con segregación completa (5410 + 5305 + 5160 + 5165)', () => {
    // utilidadNeta = 200M (ya incluye efecto de impuesto e intereses del P&L)
    // impuesto5410 = 70M, intereses5305 = 30M → utilidadOperacional = 300M
    // dep5160 = 40M, amort5165 = 10M → EBITDA = 350M
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 900_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(5, [
          { code: '5305001', name: 'Intereses financieros', balance: 30_000_000 },
          { code: '5410001', name: 'Impuesto de renta', balance: 70_000_000 },
          { code: '5160001', name: 'Depreciación activos', balance: 40_000_000 },
          { code: '5165001', name: 'Amortización intangibles', balance: 10_000_000 },
          { code: '5195001', name: 'Otros gastos', balance: 750_000_000 },
        ]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    // utilidadOperacional = 200M + 70M + 30M = 300M
    expect(cards.audit.utilidadOperacional).toBeCloseTo(300_000_000, 0);
    // EBITDA = 300M + 40M + 10M = 350M
    expect(cards.ebitda.value).toBeCloseTo(350_000_000, 0);
    expect(cards.audit.depreciaciones).toBeCloseTo(40_000_000, 0);
    expect(cards.audit.amortizaciones).toBeCloseTo(10_000_000, 0);
  });

  it('EBITDA fallback cuando no hay segregación 5410/5305 → utilidadNeta + dep + amort', () => {
    // Sin cuentas 5410 ni 5305 → impuesto=0, intereses=0
    // utilidadOperacional = utilidadNeta = 150M
    // EBITDA = 150M + 20M (dep) + 5M (amort) = 175M
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 150_000_000,
      }),
      classes: [
        makeClass(5, [
          { code: '5160001', name: 'Depreciación', balance: 20_000_000 },
          { code: '5165001', name: 'Amortización', balance: 5_000_000 },
          { code: '5195001', name: 'Gastos administración', balance: 575_000_000 },
        ]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.audit.utilidadOperacional).toBeCloseTo(150_000_000, 0);
    expect(cards.ebitda.value).toBeCloseTo(175_000_000, 0);
    expect(cards.ebitda.status).toBe('healthy'); // 175/800 ≈ 21.9% > 15%
  });

  it('WAOO = EBITDA / ingresos × 100; status: healthy ≥15%, watch ≥8%', () => {
    // EBITDA = 150M + 0 dep/amort = 150M, ingresos = 1.000M → WAOO = 15% → healthy
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 800_000_000,
        utilidadNeta: 150_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 800_000_000 }])],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.waoo.value).toBeCloseTo(0.15, 4); // 150M / 1000M = 0.15
    expect(cards.waoo.status).toBe('healthy');

    // Escenario watch: EBITDA = 80M / ingresos 1.000M = 8% → watch
    const snap2 = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 900_000_000,
        utilidadNeta: 80_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 900_000_000 }])],
    });
    const cards2 = computeValorExecutiveCards({ snapshot: snap2 });
    expect(cards2.waoo.status).toBe('watch');
  });

  it('Ratio = (gastos + costos) / ingresos; lower-better thresholds', () => {
    // gastos clase5 = 700M, costos clase6 = 100M, ingresos = 1.000M → ratio = 0.80 → healthy (<0.85)
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 800_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 700_000_000 }]),
        makeClass(6, [{ code: '6195001', name: 'Costos', balance: 100_000_000 }]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.ratio.value).toBeCloseTo(0.8, 4); // (700+100)/1000=0.8
    expect(cards.ratio.status).toBe('healthy');

    // Ratio ≥ 1.0 → critical
    const snap2 = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 1_050_000_000,
        utilidadNeta: -50_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 1_050_000_000 }])],
    });
    const cards2 = computeValorExecutiveCards({ snapshot: snap2 });
    expect(cards2.ratio.value).toBeCloseTo(1.05, 3);
    expect(cards2.ratio.status).toBe('critical');
  });

  it('FCF con EFE indirecto: operating - |varPPE|', () => {
    // operating = 300M, varPPE = 80M (compra de PPE) → FCF = 300M − 80M = 220M
    const efe = makeCashFlow(300_000_000, 80_000_000);
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 800_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 800_000_000 }])],
      cashFlowIndirecto: efe,
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.fcf.value).toBeCloseTo(220_000_000, 0); // 300M − 80M
    expect(cards.audit.operatingCashFlow).toBeCloseTo(300_000_000, 0);
    expect(cards.audit.capex).toBeCloseTo(80_000_000, 0);
    expect(cards.fcf.status).toBe('healthy'); // FCF > 0
  });

  it('FCF null cuando no hay cashFlowIndirecto', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 700_000_000,
        utilidadNeta: 300_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 700_000_000 }])],
      // sin cashFlowIndirecto
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.fcf.value).toBeNull();
    expect(cards.audit.operatingCashFlow).toBeNull();
    expect(cards.audit.capex).toBeNull();
    expect(cards.fcf.status).toBe('watch'); // null → watch
  });

  it('Edge: ingresos = 0 → WAOO y Ratio son null', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 0,
        gastos: 50_000_000,
        utilidadNeta: -50_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 50_000_000 }])],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.waoo.value).toBeNull();
    expect(cards.ratio.value).toBeNull();
    expect(cards.audit.totalIngresos).toBe(0);
  });

  it('Edge: utilidadNeta negativa (pérdida real) → EBITDA puede ser negativo', () => {
    // Pérdida neta = -300M, sin segregación ni dep/amort → EBITDA = -300M
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 1_300_000_000,
        utilidadNeta: -300_000_000,
      }),
      classes: [makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 1_300_000_000 }])],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.ebitda.value).toBeCloseTo(-300_000_000, 0);
    expect(cards.ebitda.status).toBe('critical'); // EBITDA < 0
    expect(cards.audit.utilidadNeta).toBeCloseTo(-300_000_000, 0);
  });

  it('Audit expone utilidadNeta directamente (FIX B1)', () => {
    // FIX audit B1: audit.utilidadNeta debe ser espejo exacto de controlTotals.utilidadNeta,
    // NO derivado de utilidadOperacional - impuesto - intereses.
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 650_000_000,
        utilidadNeta: 123_456_789,
      }),
      classes: [
        makeClass(5, [
          { code: '5410001', name: 'Impuesto', balance: 50_000_000 },
          { code: '5195001', name: 'Gastos varios', balance: 600_000_000 },
        ]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    // utilidadNeta debe ser el valor exacto del controlTotals
    expect(cards.audit.utilidadNeta).toBe(123_456_789);
    // utilidadOperacional es distinta (incluye add-backs)
    expect(cards.audit.utilidadOperacional).not.toBe(cards.audit.utilidadNeta);
  });
});

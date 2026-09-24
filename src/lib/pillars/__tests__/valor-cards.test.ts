// ---------------------------------------------------------------------------
// Tests del motor de tarjetas ejecutivas del Pilar VALOR
// ---------------------------------------------------------------------------
// Cubre 8 escenarios:
//   1. EBITDA = utilidad operacional (41 − 51 − 52) + D&A (ratios-kpis-05).
//   2. Sin grupo 41 → EBITDA N/D.
//   3. WAOO = EBITDA / ingresos operacionales netos, status healthy ≥15%.
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
  // ratios-kpis-05: estos casos codificaban EBITDA = utilidad neta + 5410 +
  // 5305 + 5160 + 5165. El impuesto de renta vive en 5405 (grupo 54), así que
  // nunca se sumaba de vuelta, y 5260/5265 se omitían. La definición única
  // (./ebitda.ts) parte de la utilidad OPERACIONAL: 41 − 4175 − clases 6/7 −
  // grupos 51/52, más D&A (5160/5165/5260/5265/7360/7365).
  it('EBITDA = utilidad operacional (41 − 51 − 52) + D&A; 53 y 54 no intervienen', () => {
    // 41 = 1.200M; 51 = 750M + dep 40M; 52 = amort 10M → EBIT = 400M
    // D&A = 50M → EBITDA = 450M (intereses 5305 y renta 5405 quedan debajo)
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 900_000_000,
        utilidadNeta: 300_000_000,
      }),
      classes: [
        makeClass(4, [{ code: '413505', name: 'Ventas', balance: 1_200_000_000 }]),
        makeClass(5, [
          { code: '5305001', name: 'Intereses financieros', balance: 30_000_000 },
          { code: '5405001', name: 'Impuesto de renta', balance: 70_000_000 },
          { code: '5160001', name: 'Depreciación activos', balance: 40_000_000 },
          { code: '5265001', name: 'Amortización intangibles', balance: 10_000_000 },
          { code: '5195001', name: 'Otros gastos', balance: 750_000_000 },
        ]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.audit.utilidadOperacional).toBe(400_000_000);
    expect(cards.ebitda.value).toBe(450_000_000);
    expect(cards.audit.depreciaciones).toBe(40_000_000);
    expect(cards.audit.amortizaciones).toBe(10_000_000);
  });

  it('sin desglose del grupo 41 → EBITDA N/D (no se aproxima desde la utilidad neta)', () => {
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

    expect(cards.audit.utilidadOperacional).toBeNull();
    expect(cards.ebitda.value).toBeNull();
    expect(cards.waoo.value).toBeNull();
    expect(cards.ebitda.descriptionEs).toMatch(/^N\/D/);
  });

  it('WAOO = EBITDA / ingresos operacionales netos; status: healthy ≥15%, watch ≥8%', () => {
    // EBITDA = 1.000 − 850 = 150M sobre ingresos operacionales 1.000M → 15 % healthy
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 850_000_000,
        utilidadNeta: 150_000_000,
      }),
      classes: [
        makeClass(4, [{ code: '413505', name: 'Ventas', balance: 1_000_000_000 }]),
        makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 850_000_000 }]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.waoo.value).toBeCloseTo(0.15, 4);
    expect(cards.waoo.status).toBe('healthy');

    // watch: EBITDA 80M / 1.000M = 8 %
    const snap2 = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 920_000_000,
        utilidadNeta: 80_000_000,
      }),
      classes: [
        makeClass(4, [{ code: '413505', name: 'Ventas', balance: 1_000_000_000 }]),
        makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 920_000_000 }]),
      ],
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

  it('Edge: pérdida operacional → EBITDA negativo y critical', () => {
    // 41 = 1.000M, 51 = 1.300M, sin D&A → EBITDA = −300M
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        ingresos: 1_000_000_000,
        gastos: 1_300_000_000,
        utilidadNeta: -300_000_000,
      }),
      classes: [
        makeClass(4, [{ code: '413505', name: 'Ventas', balance: 1_000_000_000 }]),
        makeClass(5, [{ code: '5195001', name: 'Gastos', balance: 1_300_000_000 }]),
      ],
    });

    const cards = computeValorExecutiveCards({ snapshot: snap });

    expect(cards.ebitda.value).toBe(-300_000_000);
    expect(cards.ebitda.status).toBe('critical');
    expect(cards.audit.utilidadNeta).toBe(-300_000_000);
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

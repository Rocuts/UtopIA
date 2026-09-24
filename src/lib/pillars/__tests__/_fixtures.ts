// Fixtures compartidas por las pruebas de regresión de la auditoría (WP07).
// Convención de magnitudes del preprocesador: clases 2/3/4 positivas en su
// naturaleza (crédito), clases 1/5/6/7 positivas en débito; correctoras con
// signo contrario a su clase.

import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';

export type Acc = { code: string; name?: string; balance: number };

export function makeClass(code: number, accounts: Acc[]): PUCClass {
  return {
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: accounts.reduce((s, a) => s + a.balance, 0),
    reportedTotal: null,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: a.name ?? a.code,
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  };
}

export function makeControlTotals(overrides: Partial<ControlTotals> = {}): ControlTotals {
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

function makeValidation(): ValidationResult {
  return { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] };
}

export function makeSnapshot(
  ct: ControlTotals,
  classes: PUCClass[],
  period = '2026',
): PeriodSnapshot {
  return {
    period,
    classes,
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

/**
 * P&L realista (cifras en COP) usado por la auditoría RK-02:
 *   41 ventas 2.000M, 4175 devoluciones 80M → ingresos operacionales 1.920M
 *   42 financieros 200M (no operacional)
 *   6 costo de ventas 1.100M, 7 costos de producción 100M (7360 dep 10M)
 *   51 admin 300M (5160 dep 20M), 52 ventas 150M (5260 dep 30M, 5265 amort 10M)
 *   53 financieros 30M (5305), 54 impuesto 95M (5405)
 * EBIT = 1.920 − 1.200 − 450 = 270M; D&A = 20 + 30 + 10 + 10 = 70M; EBITDA = 340M.
 * Utilidad neta = 1.920 + 200 − 1.200 − 450 − 30 − 95 = 345M.
 */
export function makePnlSnapshot(period = '2026'): PeriodSnapshot {
  const classes = [
    makeClass(1, [
      { code: '110505', balance: 400_000_000 },
      { code: '130505', balance: 300_000_000 },
      { code: '143505', balance: 200_000_000 },
      { code: '152405', balance: 500_000_000 },
      { code: '159205', balance: -100_000_000 },
    ]),
    makeClass(2, [
      { code: '210505', balance: 150_000_000 },
      { code: '220505', balance: 180_000_000 },
      { code: '240405', balance: 95_000_000 },
      { code: '240805', balance: 40_000_000 },
    ]),
    makeClass(3, [
      { code: '310505', balance: 490_000_000 },
      { code: '360505', balance: 345_000_000 },
    ]),
    makeClass(4, [
      { code: '413505', balance: 2_000_000_000 },
      { code: '417505', balance: 80_000_000 },
      { code: '421005', balance: 200_000_000 },
    ]),
    makeClass(5, [
      { code: '510506', balance: 280_000_000 },
      { code: '516005', balance: 20_000_000 },
      { code: '520506', balance: 110_000_000 },
      { code: '526005', balance: 30_000_000 },
      { code: '526505', balance: 10_000_000 },
      { code: '530520', balance: 30_000_000 },
      { code: '540505', balance: 95_000_000 },
    ]),
    makeClass(6, [{ code: '613505', balance: 1_100_000_000 }]),
    makeClass(7, [
      { code: '730505', balance: 90_000_000 },
      { code: '736005', balance: 10_000_000 },
    ]),
  ];
  const ct = makeControlTotals({
    activo: 1_300_000_000,
    activoCorriente: 900_000_000,
    activoNoCorriente: 400_000_000,
    pasivo: 465_000_000,
    pasivoCorriente: 465_000_000,
    patrimonio: 835_000_000,
    ingresos: 2_280_000_000,
    ingresosNetos: 2_120_000_000,
    gastos: 1_775_000_000,
    utilidadNeta: 345_000_000,
    efectivoCuenta11: 400_000_000,
    deudoresCuenta13: 300_000_000,
    impuestosCuenta24: 135_000_000,
    inventarios14: 200_000_000,
    gastoFinanciero5305: 30_000_000,
  });
  return makeSnapshot(ct, classes, period);
}

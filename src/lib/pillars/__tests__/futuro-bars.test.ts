// ---------------------------------------------------------------------------
// Tests del motor `buildFuturoBarSeries` con opciones interactivas (FUTURO v2)
// ---------------------------------------------------------------------------
// Cubre los 3 inputs interactivos del usuario:
//   1. growthOverride — Slider Crecimiento Estimado.
//   2. ipcRate        — Indexación automática de gastos fijos (default 4,5%).
//   3. capexEvents    — Eventos de Futuro (CapEx personalizables).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { buildFuturoBarSeries, IPC_DEFAULT, type CapexEvent } from '../futuro-bars';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  PreprocessedBalance,
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
  accounts: Array<{ code: string; name: string; balance: number }>,
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
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  };
}

function makeSnapshot(
  ct: ControlTotals,
  classes: PUCClass[] = [],
): PeriodSnapshot {
  return {
    period: '2026',
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
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: makeValidation(),
    discrepancies: [],
    missingExpectedAccounts: [],
  };
}

function makeBalance(snap: PeriodSnapshot): PreprocessedBalance {
  return {
    periods: [snap],
    primary: snap,
    comparative: null,
    rawRows: [],
    auxiliaryCount: 0,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: true,
    reclasificacionesNoCompensacion: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildFuturoBarSeries — opciones interactivas', () => {
  // Caso base: caja 1.2B, ingresos 1.2B/año (100M/mes), gastos 600M/año (50M/mes).
  // Sin opts: base flat-positivo, conservador positivo, agresivo positivo.
  const baseSnap = makeSnapshot(
    makeControlTotals({
      ingresos: 1_200_000_000,
      gastos: 600_000_000,
      utilidadNeta: 600_000_000,
      efectivoCuenta11: 1_200_000_000,
    }),
  );
  const baseBalance = makeBalance(baseSnap);

  it('default (sin opts): retorna 12 puntos con capexAplicado=0', () => {
    const series = buildFuturoBarSeries(baseBalance);
    expect(series).toHaveLength(12);
    expect(series.every((p) => p.capexAplicado === 0)).toBe(true);
    expect(series[0].monthIndex).toBe(1);
    expect(series[11].monthIndex).toBe(12);
    expect(series[11].cajaBase).toBeGreaterThan(series[0].cajaBase); // base crece
  });

  it('growthOverride positivo: cajaBase mes 12 > caja con override=0', () => {
    const sinOverride = buildFuturoBarSeries(baseBalance);
    const conOverride = buildFuturoBarSeries(baseBalance, { growthOverride: 0.10 });
    expect(conOverride[11].cajaBase).toBeGreaterThan(sinOverride[11].cajaBase);
  });

  it('growthOverride negativo: cajaBase mes 12 < caja con override=0', () => {
    const sinOverride = buildFuturoBarSeries(baseBalance);
    const conOverride = buildFuturoBarSeries(baseBalance, { growthOverride: -0.05 });
    expect(conOverride[11].cajaBase).toBeLessThan(sinOverride[11].cajaBase);
  });

  it('growthOverride NO afecta cajaConservadora ni cajaAgresiva', () => {
    const sinOverride = buildFuturoBarSeries(baseBalance);
    const conOverride = buildFuturoBarSeries(baseBalance, { growthOverride: 0.20 });
    // Las series conservadora y agresiva NO se tocan con el slider.
    expect(conOverride[11].cajaConservadora).toBeCloseTo(sinOverride[11].cajaConservadora, 0);
    expect(conOverride[11].cajaAgresiva).toBeCloseTo(sinOverride[11].cajaAgresiva, 0);
  });

  it('IPC default (4,5%) indexa gastos fijos automáticamente', () => {
    // Snapshot con gastos casi todos fijos (5105 nómina = 600M, igual al total).
    const snapConFijos = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 1_200_000_000,
      }),
      [makeClass(5, [{ code: '510505', name: 'Nómina', balance: 600_000_000 }])],
    );
    const balanceConFijos = makeBalance(snapConFijos);

    // Con IPC default vs sin IPC.
    const conIpc = buildFuturoBarSeries(balanceConFijos);
    const sinIpc = buildFuturoBarSeries(balanceConFijos, { ipcRate: 0 });

    // Con IPC, los gastos fijos suben mes a mes → caja al mes 12 debe ser MENOR.
    expect(conIpc[11].cajaBase).toBeLessThan(sinIpc[11].cajaBase);
  });

  it('ipcRate=0 sobreescribe el default y no aplica indexación', () => {
    const snapConFijos = makeSnapshot(
      makeControlTotals({
        ingresos: 1_200_000_000,
        gastos: 600_000_000,
        utilidadNeta: 600_000_000,
        efectivoCuenta11: 1_200_000_000,
      }),
      [makeClass(5, [{ code: '510505', name: 'Nómina', balance: 600_000_000 }])],
    );
    const balance = makeBalance(snapConFijos);

    const sinIpc = buildFuturoBarSeries(balance, { ipcRate: 0 });
    // Sin IPC, todos los meses tienen el mismo flujo neto:
    //   ingresoMes (100M × 1.0) − egresoMes (50M) = +50M/mes.
    // caja[1] = 1.200M + 50M = 1.250M → caja[12] = 1.200M + 12 × 50M = 1.800M.
    expect(sinIpc[11].cajaBase).toBeCloseTo(1_800_000_000, -3);
  });

  it('capexEvents: resta el monto en el mes correcto en TODOS los escenarios', () => {
    const evento: CapexEvent = {
      id: 'cap-1',
      name: 'Compra Maquinaria',
      monthOffset: 6,
      amountCop: 200_000_000,
    };

    const sinEventos = buildFuturoBarSeries(baseBalance);
    const conEvento = buildFuturoBarSeries(baseBalance, {
      capexEvents: [evento],
      ipcRate: 0, // aislamos el efecto del CapEx
    });

    // El mes 6 muestra capexAplicado = 200M.
    expect(conEvento[5].capexAplicado).toBe(200_000_000);
    expect(conEvento[5].monthIndex).toBe(6);

    // Las cajas (los 3 escenarios) en M+6 son menores con el evento.
    // (Sin IPC, el delta entre con y sin debe ser ≈ 200M en todos.)
    const baseSinIpc = buildFuturoBarSeries(baseBalance, { ipcRate: 0 });
    expect(baseSinIpc[5].cajaBase - conEvento[5].cajaBase).toBeCloseTo(200_000_000, -3);
    expect(baseSinIpc[5].cajaConservadora - conEvento[5].cajaConservadora).toBeCloseTo(200_000_000, -3);
    expect(baseSinIpc[5].cajaAgresiva - conEvento[5].cajaAgresiva).toBeCloseTo(200_000_000, -3);

    // Y el efecto ARRASTRA en los meses siguientes (caja sigue 200M más baja).
    expect(baseSinIpc[11].cajaBase - conEvento[11].cajaBase).toBeCloseTo(200_000_000, -3);

    // Meses sin evento mantienen capexAplicado=0.
    expect(conEvento[0].capexAplicado).toBe(0);
    expect(conEvento[7].capexAplicado).toBe(0);
    void sinEventos;
  });

  it('múltiples capexEvents en el mismo mes: suman al capexAplicado', () => {
    const e1: CapexEvent = { id: 'a', name: 'CapEx 1', monthOffset: 3, amountCop: 100_000_000 };
    const e2: CapexEvent = { id: 'b', name: 'CapEx 2', monthOffset: 3, amountCop: 50_000_000 };

    const series = buildFuturoBarSeries(baseBalance, { capexEvents: [e1, e2] });
    expect(series[2].capexAplicado).toBe(150_000_000);
  });

  it('capexEvent con monthOffset fuera de [1,12] se ignora silenciosamente', () => {
    const eFuera: CapexEvent = { id: 'x', name: 'Mal mes', monthOffset: 99, amountCop: 1_000_000 };
    const series = buildFuturoBarSeries(baseBalance, { capexEvents: [eFuera] });
    expect(series.every((p) => p.capexAplicado === 0)).toBe(true);
  });

  it('IPC_DEFAULT exportada como 4,5%', () => {
    expect(IPC_DEFAULT).toBeCloseTo(0.045, 5);
  });
});

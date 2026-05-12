// ---------------------------------------------------------------------------
// Wave 2.F4 — smoke tests para los 4 fixes deterministicos del worker.
// ---------------------------------------------------------------------------
// Cubre:
//   Fix #1 — Devoluciones 4175 (ingresosNetos + totalDevoluciones en ControlTotals).
//   Fix #2 — periodoTipo: 'cerrado' | 'parcial' | 'indeterminado'.
//   Fix #3 — 14 KPIs deterministicos (Razón Corriente, ROE, Días de cartera, etc.).
//   Fix #4 — R17 (proveedores Cta 22 saldo débito), R18 (patrimonio negativo),
//            R19 (margen neto > 70%).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { runCurator } from '../balance-curator';
import { runR17 } from '../curator-rules/r17-supplier-debit-balance';
import { runR18 } from '../curator-rules/r18-equity-negative';
import { runR19 } from '../curator-rules/r19-net-margin-over-70';
import {
  inferPeriodoTipo,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PUCClass,
  type PeriodSnapshot,
} from '../trial-balance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildClass(
  code: number,
  accounts: Array<{ code: string; balance: number; name?: string }>,
): PUCClass {
  return {
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: accounts.reduce((s, a) => s + a.balance, 0),
    reportedTotal: null,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: a.name ?? `Cuenta ${a.code}`,
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  };
}

function buildSnapshot(opts: {
  period?: string;
  classes?: PUCClass[];
  patrimonio?: number;
  ingresos?: number;
  utilidadNeta?: number;
  ingresosNetos?: number;
  capitalSuscritoPagado?: number;
  costoVentas6?: number;
  costoProduccion7?: number;
}): PeriodSnapshot {
  return {
    period: opts.period ?? '2025',
    classes: opts.classes ?? [buildClass(1, []), buildClass(2, []), buildClass(3, [])],
    controlTotals: {
      activo: 100_000_000,
      activoCorriente: 0,
      activoNoCorriente: 0,
      pasivo: 0,
      pasivoCorriente: 0,
      pasivoNoCorriente: 0,
      patrimonio: opts.patrimonio ?? 100_000_000,
      ingresos: opts.ingresos ?? 0,
      gastos: 0,
      utilidadNeta: opts.utilidadNeta ?? 0,
      efectivoCuenta11: 0,
      deudoresCuenta13: 0,
      cuentasPorPagar23: 0,
      impuestosCuenta24: 0,
      obligacionesLaborales25: 0,
      ingresosNetos: opts.ingresosNetos,
      costoVentas6: opts.costoVentas6,
      costoProduccion7: opts.costoProduccion7,
    },
    equityBreakdown: {
      capitalSuscritoPagado: opts.capitalSuscritoPagado,
    },
    summary: {
      totalAssets: 100_000_000,
      totalLiabilities: 0,
      totalEquity: opts.patrimonio ?? 100_000_000,
      totalRevenue: opts.ingresos ?? 0,
      totalExpenses: 0,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: opts.utilidadNeta ?? 0,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
    findings: {},
  };
}

// ---------------------------------------------------------------------------
// Fix #2 — inferPeriodoTipo (pure function)
// ---------------------------------------------------------------------------

describe('Wave 2.F4 — Fix #2 — inferPeriodoTipo', () => {
  it('"2025-12" → cerrado', () => {
    expect(inferPeriodoTipo('2025-12')).toBe('cerrado');
  });
  it('"2025-06" → parcial', () => {
    expect(inferPeriodoTipo('2025-06')).toBe('parcial');
  });
  it('"Ene-Dic 2025" → cerrado', () => {
    expect(inferPeriodoTipo('Ene-Dic 2025')).toBe('cerrado');
  });
  it('"Enero-Diciembre 2025" → cerrado', () => {
    expect(inferPeriodoTipo('Enero-Diciembre 2025')).toBe('cerrado');
  });
  it('"Junio 2025" → parcial', () => {
    expect(inferPeriodoTipo('Junio 2025')).toBe('parcial');
  });
  it('"2025" (solo año) → indeterminado', () => {
    expect(inferPeriodoTipo('2025')).toBe('indeterminado');
  });
  it('null / "" → indeterminado', () => {
    expect(inferPeriodoTipo(null)).toBe('indeterminado');
    expect(inferPeriodoTipo('')).toBe('indeterminado');
    expect(inferPeriodoTipo(undefined)).toBe('indeterminado');
  });
});

// ---------------------------------------------------------------------------
// Fix #1 — Devoluciones 4175 (end-to-end via preprocessTrialBalance)
// ---------------------------------------------------------------------------

describe('Wave 2.F4 — Fix #1 — Devoluciones 4175 → ingresosNetos', () => {
  it('CSV con 410505 (ventas $100M) + 417505 (devolución $10M positiva) → bruto $110M, netos $100M', () => {
    // Spec v2.0 Parte 1.3: devoluciones 4175 entran como saldos POSITIVOS en
    // Clase 4 (la convención del parser ya las suma al bruto). El detector
    // las identifica + las RESTA del bruto para producir ingresosNetos.
    //   totalRevenue (auxiliar sum) = 100M + 10M = 110M
    //   totalDevoluciones = 10M
    //   ingresosNetos = |110M| − 10M = 100M (= ventas reales sin retornos)
    const csv = [
      'codigo,nombre,nivel,saldo 2025',
      '4,Ingresos,Clase,110000000',
      '41,Ingresos operacionales,Grupo,100000000',
      '410505,Comercio al por mayor,Auxiliar,100000000',
      '4175,Devoluciones en ventas,Grupo,10000000',
      '417505,Devoluciones rebajas,Auxiliar,10000000',
    ].join('\n');

    const rows = parseTrialBalanceCSV(csv);
    const pre = preprocessTrialBalance(rows);
    const ct = pre.primary.controlTotals;

    expect(ct.totalDevoluciones).toBe(10_000_000);
    expect(ct.ingresosNetos).toBe(100_000_000);
    // raw + cents poblados (cents = pesos × 100).
    expect(ct.cents?.totalDevoluciones).toBe(BigInt(1_000_000_000));
    expect(ct.cents?.ingresosNetos).toBe(BigInt(10_000_000_000));
  });

  it('CSV sin devoluciones 4175 → totalDevoluciones = 0, ingresosNetos = |ingresos|', () => {
    const csv = [
      'codigo,nombre,nivel,saldo 2025',
      '4,Ingresos,Clase,50000000',
      '41,Ingresos operacionales,Grupo,50000000',
      '410505,Servicios,Auxiliar,50000000',
    ].join('\n');

    const rows = parseTrialBalanceCSV(csv);
    const pre = preprocessTrialBalance(rows);
    const ct = pre.primary.controlTotals;

    expect(ct.totalDevoluciones).toBe(0);
    expect(ct.ingresosNetos).toBe(50_000_000);
  });
});

// ---------------------------------------------------------------------------
// Fix #3 — 14 KPIs deterministicos
// ---------------------------------------------------------------------------

describe('Wave 2.F4 — Fix #3 — 14 KPIs deterministicos en ControlTotals', () => {
  it('CSV con datos sintéticos → KPIs poblados con ratios coherentes', () => {
    const csv = [
      'codigo,nombre,nivel,saldo 2025',
      // Activo
      '1,Activos,Clase,200000000',
      '11,Disponible,Grupo,50000000',
      '110505,Caja,Auxiliar,50000000',
      '13,Deudores,Grupo,40000000',
      '130505,Clientes,Auxiliar,40000000',
      '14,Inventarios,Grupo,60000000',
      '143505,Mercancías,Auxiliar,60000000',
      '15,PPE,Grupo,50000000',
      '152405,Equipo oficina,Auxiliar,50000000',
      // Pasivo
      '2,Pasivos,Clase,80000000',
      '21,Obligaciones financieras,Grupo,30000000',
      '210505,Bancos nacionales,Auxiliar,30000000',
      '22,Proveedores,Grupo,30000000',
      '220505,Proveedores nacionales,Auxiliar,30000000',
      '24,Impuestos,Grupo,20000000',
      '240405,Renta,Auxiliar,20000000',
      // Patrimonio
      '3,Patrimonio,Clase,120000000',
      '31,Capital social,Grupo,100000000',
      '311505,Capital suscrito,Auxiliar,100000000',
      '3705,Utilidades acumuladas,Cuenta,20000000',
      // P&L: ingresos $300M, costo $150M, gastos $30M (51 admin + 53 financ).
      '4,Ingresos,Clase,300000000',
      '41,Ingresos operacionales,Grupo,300000000',
      '410505,Ventas,Auxiliar,300000000',
      '5,Gastos,Clase,30000000',
      '51,Operacionales,Grupo,20000000',
      '510505,Sueldos,Auxiliar,20000000',
      '5305,Financieros,Cuenta,10000000',
      '530505,Intereses,Auxiliar,10000000',
      '6,Costos de ventas,Clase,150000000',
      '6135,CMV,Grupo,150000000',
      '613505,Costo mercancías,Auxiliar,150000000',
    ].join('\n');

    const rows = parseTrialBalanceCSV(csv);
    const pre = preprocessTrialBalance(rows);
    const ct = pre.primary.controlTotals;

    // Razón corriente = activoCorriente (110+40+60 = 150) / pasivoCorriente (30+20 = 50)
    // = 150 / 50 = 3.00 (sin Cta 22 que sale en pasivoCorriente... let me compute)
    // Actually activoCorriente = 50 (caja) + 40 (clientes) + 60 (inv) = 150M
    //         pasivoCorriente = 30 (Cta 22) + 20 (Cta 24) = 50M (Cta 21 no es corriente)
    // Wait — Cta 21 (Obligaciones financieras) está en PASIVO_CORRIENTE_GROUPS? Yes (21 está).
    // Let me re-check: PASIVO_CORRIENTE_GROUPS = ['21','22','23','24','25','26']
    // So pasivoCorriente = 30+30+20 = 80M
    // Razón corriente = 150/80 = 1.875
    expect(ct.razonCorriente).toBeCloseTo(1.875, 2);
    // Prueba ácida = (AC - Inventarios) / PC = (150 - 60) / 80 = 1.125
    expect(ct.pruebaAcida).toBeCloseTo(1.125, 2);
    // Endeudamiento total = pasivo / activo × 100 = 80 / 200 × 100 = 40%
    expect(ct.endeudamientoTotal).toBeCloseTo(40, 1);
    // Apalancamiento = pasivo / patrimonio = 80 / 120 = 0.667
    expect(ct.apalancamientoFinanciero).toBeCloseTo(0.667, 2);
    // EBIT = utilidadBruta - gastosOp51 - gastosAdmin52
    //      = (ingresosNetos - costos) - gastosOp51 - gastosAdmin52
    //      = (300 - 150) - 20 - 0 = 130M
    expect(ct.ebit).toBe(130_000_000);
    // Cobertura intereses = ebit / |gastoFinanciero5305| = 130 / 10 = 13.00
    expect(ct.coberturaIntereses).toBeCloseTo(13.0, 1);
    // Margen operativo = ebit / ingresosNetos × 100 = 130 / 300 × 100 = 43.33%
    expect(ct.margenOperativo).toBeCloseTo(43.33, 1);
    // Utilidad neta = 300 - 30 - 150 - 0 = 120M
    // Margen neto = 120 / 300 × 100 = 40%
    expect(ct.margenNeto).toBeCloseTo(40.0, 1);
    // En single-period, ROE = utilidadNeta / patrimonio × 100 = 120 / 120 × 100 = 100%
    expect(ct.roe).toBeCloseTo(100.0, 1);
    // ROA = utilidadNeta / activo × 100 = 120 / 200 × 100 = 60%
    expect(ct.roa).toBeCloseTo(60.0, 1);
    // Rotación de activos = ingresosNetos / activo = 300 / 200 = 1.5
    expect(ct.rotacionActivos).toBeCloseTo(1.5, 2);
    // Días de cartera = (deudores 13 / ingresosNetos) × 365 = (40 / 300) × 365 = 48.67
    expect(ct.diasCartera).toBeCloseTo(48.67, 1);
    // Días de inventario = (inv 14 / (costo6+7)) × 365 = (60 / 150) × 365 = 146 días
    expect(ct.diasInventario).toBeCloseTo(146, 0);
    // Días de proveedores = (Cta 22 / costos) × 365 = (30 / 150) × 365 = 73
    expect(ct.diasProveedores).toBeCloseTo(73, 0);
  });

  it('Cobertura de intereses con gasto financiero = 0 → null (ND)', () => {
    const csv = [
      'codigo,nombre,nivel,saldo 2025',
      '4,Ingresos,Clase,100000000',
      '410505,Ventas,Auxiliar,100000000',
      '6,Costos,Clase,50000000',
      '613505,CMV,Auxiliar,50000000',
    ].join('\n');

    const rows = parseTrialBalanceCSV(csv);
    const pre = preprocessTrialBalance(rows);
    expect(pre.primary.controlTotals.coberturaIntereses).toBeNull();
  });

  it('Días de inventario con costos anómalos (< 1% ingresos) → null', () => {
    // Empresa solo de servicios sin costos: días de inventario = ND.
    const csv = [
      'codigo,nombre,nivel,saldo 2025',
      '4,Ingresos,Clase,1000000000',
      '410505,Servicios,Auxiliar,1000000000',
      '14,Inventarios,Grupo,5000000',
      '143505,Mercancías,Auxiliar,5000000',
    ].join('\n');

    const rows = parseTrialBalanceCSV(csv);
    const pre = preprocessTrialBalance(rows);
    expect(pre.primary.controlTotals.diasInventario).toBeNull();
    expect(pre.primary.controlTotals.diasProveedores).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix #4 — R17 / R18 / R19
// ---------------------------------------------------------------------------

describe('Wave 2.F4 — Fix #4 — R17 (Proveedores Cta 22 saldo débito)', () => {
  it('Cuenta 220505 con saldo $1M (débito) → emite finding informativo', () => {
    const snap = buildSnapshot({
      classes: [
        buildClass(1, []),
        buildClass(2, [{ code: '220505', balance: 1_000_000, name: 'Proveedores nacionales' }]),
        buildClass(3, []),
      ],
    });
    const r = runR17(snap);
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].code).toBe('CUR-R17');
    expect(r.findings[0].severity).toBe('informativo');
    expect(r.affectedAccounts).toHaveLength(1);
  });

  it('Sin clase 2 → no emite findings', () => {
    const snap = buildSnapshot({ classes: [buildClass(1, [])] });
    const r = runR17(snap);
    expect(r.findings.length).toBe(0);
  });

  it('Saldo < $50K (materialidad) → no emite findings', () => {
    const snap = buildSnapshot({
      classes: [
        buildClass(1, []),
        buildClass(2, [{ code: '220505', balance: 10_000 }]),
        buildClass(3, []),
      ],
    });
    const r = runR17(snap);
    expect(r.findings.length).toBe(0);
  });
});

describe('Wave 2.F4 — Fix #4 — R18 (Patrimonio negativo)', () => {
  it('Patrimonio = -$50M → emite finding crítico going concern', () => {
    const snap = buildSnapshot({ patrimonio: -50_000_000 });
    const r = runR18(snap);
    expect(r.patrimonioNegativo).toBe(true);
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].severity).toBe('critico');
    expect(r.findings[0].normReference).toContain('NIC 1');
    expect(r.findings[0].normReference).toContain('NIA 570');
  });

  it('Patrimonio negativo material vs Capital Suscrito → cita Art. 459 C.Co.', () => {
    const snap = buildSnapshot({
      patrimonio: -60_000_000,
      capitalSuscritoPagado: 100_000_000,
    });
    const r = runR18(snap);
    expect(r.findings[0].description).toContain('Art. 459 C.Co.');
    expect(r.findings[0].normReference).toContain('Art. 459');
  });

  it('Patrimonio = $0 (con tolerancia centavos) → no dispara', () => {
    const snap = buildSnapshot({ patrimonio: 0 });
    const r = runR18(snap);
    expect(r.patrimonioNegativo).toBe(false);
    expect(r.findings.length).toBe(0);
  });
});

describe('Wave 2.F4 — Fix #4 — R19 (Margen neto > 70%)', () => {
  it('Margen 80% (sobre ingresos materiales) → emite finding medio', () => {
    const snap = buildSnapshot({
      ingresosNetos: 100_000_000,
      utilidadNeta: 80_000_000,
      ingresos: 100_000_000,
    });
    const r = runR19(snap);
    expect(r.exceedsThreshold).toBe(true);
    expect(r.netMarginRatio).toBeCloseTo(0.8, 2);
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].severity).toBe('medio');
    expect(r.findings[0].normReference).toContain('NIA 240');
  });

  it('Margen 50% → no dispara', () => {
    const snap = buildSnapshot({
      ingresosNetos: 100_000_000,
      utilidadNeta: 50_000_000,
      ingresos: 100_000_000,
    });
    const r = runR19(snap);
    expect(r.exceedsThreshold).toBe(false);
    expect(r.findings.length).toBe(0);
  });

  it('Utilidad negativa → no dispara (es la patología opuesta)', () => {
    const snap = buildSnapshot({
      ingresosNetos: 100_000_000,
      utilidadNeta: -20_000_000,
      ingresos: 100_000_000,
    });
    const r = runR19(snap);
    expect(r.exceedsThreshold).toBe(false);
    expect(r.findings.length).toBe(0);
  });

  it('Ingresos < $10M → no aplicable (empresa start-up)', () => {
    const snap = buildSnapshot({
      ingresosNetos: 5_000_000,
      utilidadNeta: 4_000_000,
      ingresos: 5_000_000,
    });
    const r = runR19(snap);
    expect(r.netMarginRatio).toBeNull();
    expect(r.findings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integración — runCurator dispara R17/R18/R19 al final del pipeline
// ---------------------------------------------------------------------------

describe('Wave 2.F4 — runCurator integra R17/R18/R19', () => {
  it('R17 + R19 disparan sobre un snapshot con margen alto y proveedores anómalos', () => {
    // R17: cuenta 220505 saldo débito $5M.
    // R19: margen neto $95M / $100M = 95% > 70% (subregistro de costos).
    // R18 NO: el patrimonio post-R8 sería positivo (capital + utility).
    const snap = buildSnapshot({
      classes: [
        buildClass(1, [{ code: '110505', balance: 50_000_000, name: 'Caja' }]),
        buildClass(2, [
          { code: '220505', balance: 5_000_000, name: 'Proveedores' }, // R17
        ]),
        buildClass(3, []),
        buildClass(4, [{ code: '410505', balance: 100_000_000, name: 'Ventas' }]),
        buildClass(6, [{ code: '613505', balance: 5_000_000, name: 'CMV' }]),
      ],
      patrimonio: 50_000_000,
      ingresos: 100_000_000,
      ingresosNetos: 100_000_000,
      utilidadNeta: 95_000_000, // 95% margen → R19
    });

    const result = runCurator(snap, null);
    const codes = result.findings.map((f) => f.code);

    expect(codes).toContain('CUR-R17');
    expect(codes).toContain('CUR-R19');
  });

  it('R18 dispara cuando el patrimonio POST-R8 (autoritativo) queda negativo', () => {
    // Fixture: pasivos GIGANTES superan al activo + utility, patrimonio sigue
    // negativo aún tras R8. Esto representa la patología real (going concern).
    const snap = buildSnapshot({
      classes: [
        buildClass(1, [{ code: '110505', balance: 10_000_000, name: 'Caja' }]),
        buildClass(2, [
          { code: '210505', balance: 100_000_000, name: 'Bancos' }, // pasivo enorme
        ]),
        buildClass(3, [
          { code: '311505', balance: -90_000_000, name: 'Patrimonio neg' },
        ]),
      ],
      patrimonio: -90_000_000,
    });

    const result = runCurator(snap, null);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('CUR-R18');
  });
});

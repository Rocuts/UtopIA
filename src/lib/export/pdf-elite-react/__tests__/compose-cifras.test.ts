// compose-cifras.test.ts — Auditoría 2026-08, grupo "PDF Élite y Excel".
// ----------------------------------------------------------------------------
// Regresiones de CIFRAS del composer del PDF editorial. Cada bloque fija un
// defecto que hacía que el PDF imprimiera un número distinto del HTML/Excel
// para el mismo concepto, o un número simplemente falso:
//
//   1. Waterfall — restaba el SALDO del pasivo fiscal (PUC 24) como si fuera el
//      GASTO de impuestos del periodo, doble-contándolo (ya venía dentro de
//      `gastos`) y dejando el puente sin cerrar contra Utilidad Neta.
//   2. KPI grid — recalculaba ROE / margen neto / endeudamiento con fórmulas
//      propias en vez de consumir los campos de `controlTotals` (fuente única
//      que el HTML usa por contrato), imprimiendo dos ROE distintos.
//   3. Dial de endeudamiento — heurística `> 1 ? /100 : v` que pintaba una
//      empresa con 0,8 % de endeudamiento como 80 %, en zona crítica.
//   4. Ledger de ajustes — parseaba "$1.234.567,89" a 0 y "$1.234" a 1,234.
//   5. Formato de dinero — convención de negativos divergente dentro del
//      mismo PDF (`-$X` en KPIs vs `($X)` en los estados financieros).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { composeEditorialReport, parseCopAmount } from '../compose';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type {
  ControlTotals,
  ControlTotalsCents,
  PeriodSnapshot,
  PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stubCents(overrides: Partial<ControlTotalsCents> = {}): ControlTotalsCents {
  return {
    activo: BigInt(100_000_000_000),
    pasivo: BigInt(40_000_000_000),
    patrimonio: BigInt(60_000_000_000),
    ingresos: BigInt(150_000_000_000),
    gastos: BigInt(130_000_000_000),
    utilidadNeta: BigInt(20_000_000_000),
    utilidadAntesImpuestos: BigInt(30_000_000_000),
    // $100.000.000 de impuesto causado del periodo (grupo 54, dentro de gastos).
    impuestoCausado: BigInt(10_000_000_000),
    efectivoCuenta11: BigInt(15_000_000_000),
    totalDevoluciones: BigInt(0),
    ingresosNetos: BigInt(150_000_000_000),
    saldoAFavorImpuesto: BigInt(0),
    ...overrides,
  };
}

function stubControlTotals(overrides: Partial<ControlTotals> = {}): ControlTotals {
  return {
    activo: 1_000_000_000,
    activoCorriente: 600_000_000,
    activoNoCorriente: 400_000_000,
    pasivo: 400_000_000,
    pasivoCorriente: 300_000_000,
    pasivoNoCorriente: 100_000_000,
    patrimonio: 600_000_000,
    ingresos: 1_500_000_000,
    gastos: 1_300_000_000,
    utilidadNeta: 200_000_000,
    efectivoCuenta11: 150_000_000,
    deudoresCuenta13: 250_000_000,
    cuentasPorPagar23: 80_000_000,
    // SALDO del pasivo fiscal al cierre — NO es el gasto del periodo.
    impuestosCuenta24: 70_000_000,
    obligacionesLaborales25: 30_000_000,
    cents: stubCents(),
    ...overrides,
  };
}

function stubPreprocessed(totals: ControlTotals): PreprocessedBalance {
  const snap: PeriodSnapshot = {
    period: '2026',
    classes: [],
    controlTotals: totals,
    equityBreakdown: {},
    summary: {
      totalAssets: totals.activo,
      totalLiabilities: totals.pasivo,
      totalEquity: totals.patrimonio,
      totalRevenue: totals.ingresos,
      totalExpenses: totals.gastos,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: totals.utilidadNeta,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
  };
  return {
    periods: [snap],
    primary: snap,
    comparative: null,
    rawRows: [],
    auxiliaryCount: 0,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: false,
    reclasificacionesNoCompensacion: [],
  };
}

function stubReport(overrides?: Partial<FinancialReport>): FinancialReport {
  return {
    company: { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', fiscalPeriod: '2026' },
    niifAnalysis: {
      balanceSheet: '',
      incomeStatement: '',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: '',
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '',
      fullContent: '',
    },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport: '',
    generatedAt: '2026-08-07T12:00:00.000Z',
    ...overrides,
  };
}

function compose(totals: ControlTotals, report = stubReport()) {
  return composeEditorialReport({
    report,
    preprocessed: stubPreprocessed(totals),
    pillars: null,
    language: 'es',
  });
}

function kpiValue(out: ReturnType<typeof compose>, label: string): string | undefined {
  return out.kpiGrid.kpis.find((k) => k.label === label)?.value;
}

// ─── 1. Waterfall ────────────────────────────────────────────────────────────

describe('buildWaterfall — el puente cierra en Utilidad Neta', () => {
  it('la suma acumulada de las barras aterriza exactamente en la barra total', () => {
    const totals = stubControlTotals();
    const items = compose(totals).waterfall.items;

    let running = 0;
    for (const it of items) {
      if (it.sign === 'total') {
        // Misma aritmética que WaterfallPnL: el total se dibuja desde cero, por
        // eso un puente descuadrado es invisible en el gráfico.
        expect(running).toBeCloseTo(it.amount, 6);
        expect(it.amount).toBeCloseTo(totals.utilidadNeta, 6);
        continue;
      }
      running += it.sign === 'pos' ? it.amount : -Math.abs(it.amount);
    }
  });

  it('la barra de impuestos usa el impuesto CAUSADO del periodo, no el saldo PUC 24', () => {
    const totals = stubControlTotals();
    const items = compose(totals).waterfall.items;
    const impuestos = items.find((i) => i.label === '(Impuestos)');
    expect(impuestos).toBeDefined();
    // cents.impuestoCausado = 10_000_000_000 centavos = $100.000.000
    expect(Math.abs(impuestos!.amount)).toBeCloseTo(100_000_000, 6);
    // El saldo del pasivo fiscal ($70.000.000) NO debe aparecer en el puente.
    expect(Math.abs(impuestos!.amount)).not.toBeCloseTo(totals.impuestosCuenta24, 6);
  });

  it('la barra de gastos excluye el impuesto para no doble-contarlo', () => {
    const totals = stubControlTotals();
    const items = compose(totals).waterfall.items;
    const gastos = items.find((i) => i.label === '(Gastos + Costos)');
    expect(Math.abs(gastos!.amount)).toBeCloseTo(1_300_000_000 - 100_000_000, 6);
  });

  it('sin ancla `cents` emite una sola barra de deducción y sigue cerrando', () => {
    const totals = stubControlTotals({ cents: undefined });
    const items = compose(totals).waterfall.items;
    expect(items.find((i) => i.label === '(Impuestos)')).toBeUndefined();

    let running = 0;
    for (const it of items) {
      if (it.sign === 'total') {
        expect(running).toBeCloseTo(it.amount, 6);
        continue;
      }
      running += it.sign === 'pos' ? it.amount : -Math.abs(it.amount);
    }
  });
});

// ─── 2. KPI grid vs controlTotals ────────────────────────────────────────────

describe('buildKpiGrid — consume los ratios pre-calculados de controlTotals', () => {
  it('ROE sale de controlTotals.roe (patrimonio promedio), no de utilidadNeta/patrimonio', () => {
    // roe pre-calculado = 15 % (patrimonio promedio). El cálculo local sobre
    // patrimonio de cierre daría 200/600 = 33,3 % — dos cifras para el mismo KPI.
    const out = compose(stubControlTotals({ roe: 15 }));
    expect(kpiValue(out, 'ROE')).toBe('15,0%');
  });

  it('Margen Neto sale de controlTotals.margenNeto (ingresos NETOS de devoluciones)', () => {
    const out = compose(stubControlTotals({ margenNeto: 12 }));
    expect(kpiValue(out, 'Margen Neto')).toBe('12,0%');
  });

  it('Endeudamiento sale de controlTotals.endeudamientoTotal', () => {
    const out = compose(stubControlTotals({ endeudamientoTotal: 33.5 }));
    expect(kpiValue(out, 'Endeudamiento')).toBe('33,5%');
  });

  it('Razón Corriente sale de controlTotals.razonCorriente', () => {
    const out = compose(stubControlTotals({ razonCorriente: 1.75 }));
    expect(kpiValue(out, 'Razón Corriente')).toBe('1,75');
  });

  it('sin campos pre-calculados cae al fallback local (balances pre-F4)', () => {
    const out = compose(stubControlTotals());
    // 200.000.000 / 600.000.000 = 33,3 %
    expect(kpiValue(out, 'ROE')).toBe('33,3%');
  });

  it('el KPI de endeudamiento y su dial imprimen el MISMO valor', () => {
    const out = compose(stubControlTotals({ endeudamientoTotal: 0.8 }));
    const gauge = out.dialGauges.gauges.find((g) => g.label === 'Endeudamiento')!;
    expect(kpiValue(out, 'Endeudamiento')).toBe('0,8%');
    expect(gauge.value * 100).toBeCloseTo(0.8, 6);
  });
});

// ─── 3. Dial de endeudamiento ────────────────────────────────────────────────

describe('buildDialGauges — escala del dial de endeudamiento', () => {
  it('una SAS con 0,8 % de endeudamiento NO se pinta en zona crítica', () => {
    const out = compose(stubControlTotals({ endeudamientoTotal: 0.8 }));
    const gauge = out.dialGauges.gauges.find((g) => g.label === 'Endeudamiento')!;
    // Escala 0-1 con umbrales [0,3 / 0,5 / 0,7]: 0,8 % → 0,008, zona sana.
    expect(gauge.value).toBeCloseTo(0.008, 9);
    expect(gauge.value).toBeLessThan(gauge.thresholds[0]);
  });

  it('un endeudamiento de 40 % se mantiene en 0,40', () => {
    const out = compose(stubControlTotals({ endeudamientoTotal: 40 }));
    const gauge = out.dialGauges.gauges.find((g) => g.label === 'Endeudamiento')!;
    expect(gauge.value).toBeCloseTo(0.4, 9);
  });

  it('sin campo pre-calculado el fallback también entrega escala 0-1', () => {
    const out = compose(stubControlTotals());
    const gauge = out.dialGauges.gauges.find((g) => g.label === 'Endeudamiento')!;
    // pasivo 400M / activo 1.000M = 0,40
    expect(gauge.value).toBeCloseTo(0.4, 9);
  });
});

// ─── 4. Ledger de ajustes ────────────────────────────────────────────────────

describe('parseCopAmount — convención es-CO', () => {
  it('interpreta el punto como separador de MILES y la coma como decimal', () => {
    expect(parseCopAmount('$1.234.567,89')).toBeCloseTo(1_234_567.89, 6);
  });

  it('no divide por mil un monto sin decimales', () => {
    expect(parseCopAmount('$1.234')).toBeCloseTo(1234, 6);
  });

  it('los paréntesis marcan negativo (convención contable)', () => {
    expect(parseCopAmount('($500,50)')).toBeCloseTo(-500.5, 6);
  });

  it('acepta el guion como signo', () => {
    expect(parseCopAmount('-$2.000')).toBeCloseTo(-2000, 6);
  });

  it('devuelve null cuando no hay monto interpretable', () => {
    expect(parseCopAmount('n/d')).toBeNull();
    expect(parseCopAmount('')).toBeNull();
    expect(parseCopAmount(undefined)).toBeNull();
  });
});

describe('buildAppendix — tabla de ajustes desde markdown COP', () => {
  const ledgerMd = `| Cuenta | Descripción | Ajuste | Norma |
|--------|-------------|--------|-------|
| 1435 | Ajuste inventario NIIF | $1.234.567,89 | NIC 2 |
| 2205 | Reclasificación proveedores | $1.234 | NIIF Secc. 11 |
| 3705 | Corrección resultados | ($500,50) | NIC 8 |
| 5305 | Fila ilegible | pendiente | NIC 8 |
`;

  function appendixRows() {
    const report = stubReport();
    (report.governance as unknown as { adjustmentsLedger: string }).adjustmentsLedger = ledgerMd;
    return compose(stubControlTotals(), report).appendix.adjustmentsTable ?? [];
  }

  it('no aplana los montos COP a cero ni los divide por mil', () => {
    const rows = appendixRows();
    expect(rows[0].ajuste).toBeCloseTo(1_234_567.89, 6);
    expect(rows[1].ajuste).toBeCloseTo(1234, 6);
    expect(rows[2].ajuste).toBeCloseTo(-500.5, 6);
  });

  it('un monto ilegible queda anotado en la descripción, no silenciado como $0', () => {
    const rows = appendixRows();
    expect(rows[3].descripcion).toContain('monto no interpretable');
    expect(rows[3].descripcion).toContain('pendiente');
  });
});

// ─── 5. Convención de negativos ──────────────────────────────────────────────

describe('formatCop — convención NIIF única (paréntesis)', () => {
  it('un patrimonio negativo se imprime entre paréntesis, no con -$', () => {
    const out = compose(stubControlTotals({ patrimonio: -50_000_000 }));
    expect(kpiValue(out, 'Patrimonio')).toBe('($50.000.000,00)');
  });

  it('los positivos conservan el formato $1.234.567,89', () => {
    const out = compose(stubControlTotals());
    expect(kpiValue(out, 'Activo Total')).toBe('$1.000.000.000,00');
  });

  it('el bloque de totales vinculantes usa la misma convención', () => {
    const out = compose(stubControlTotals({ utilidadNeta: -1_234.56 }));
    expect(out.appendix.bindingTotalsBlock).toContain('($1.234,56)');
  });
});

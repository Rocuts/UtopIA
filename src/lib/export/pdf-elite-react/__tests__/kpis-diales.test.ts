// Regresiones de la auditoría de exportes 2026-09 sobre KPIs, cascada y diales
// del PDF Élite (compose.ts):
//   ratios-kpis-04     — "Ingresos" = Σ clase 4 (bruto + devoluciones + 42).
//   reportes-export-05 — diales imprimían el valor recortado y N/D como 0.
//   reportes-export-12 — ROE/margen N/D sustituidos por un cálculo local.
//   reportes-export-18 — categorías por posición y KPIs 10–12 descartados.
import { describe, expect, it } from 'vitest';
import { composeEditorialReport } from '../compose';
import { groupKpisByCategory } from '../pages/KPIGridPage';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { ControlTotals, PeriodSnapshot, PreprocessedBalance, PUCClass } from '@/lib/preprocessing/trial-balance';
import type { PillarsResult } from '@/lib/pillars/types';

const M = 1_000_000;

function clase4(accounts: Array<[string, number]>): PUCClass {
  return {
    code: 4, name: 'Ingresos', auxiliaryTotal: accounts.reduce((a, [, b]) => a + b, 0), reportedTotal: null, discrepancy: 0,
    accounts: accounts.map(([code, balance]) => ({ code, name: code, level: 'Auxiliar', balance, isLeaf: true })),
  };
}

function totals(over: Partial<ControlTotals> = {}): ControlTotals {
  return {
    activo: 1_000 * M, activoCorriente: 600 * M, activoNoCorriente: 400 * M,
    pasivo: 400 * M, pasivoCorriente: 300 * M, pasivoNoCorriente: 100 * M, patrimonio: 600 * M,
    // Σ clase 4 = 2.000 + 120 (4175 con el mismo signo) + 50 (grupo 42)
    ingresos: 2_170 * M, ingresosNetos: 1_930 * M, totalDevoluciones: 120 * M,
    gastos: 1_780 * M, utilidadNeta: 150 * M,
    efectivoCuenta11: 150 * M, deudoresCuenta13: 250 * M, cuentasPorPagar23: 80 * M,
    impuestosCuenta24: 70 * M, obligacionesLaborales25: 30 * M,
    ...over,
  };
}

function preprocessed(ct: ControlTotals, classes: PUCClass[] = [clase4([['413505', 2_000 * M], ['417505', 120 * M], ['421005', 50 * M]])]): PreprocessedBalance {
  const snap = {
    period: '2025', classes, controlTotals: ct, equityBreakdown: {},
    summary: { totalAssets: ct.activo, totalLiabilities: ct.pasivo, totalEquity: ct.patrimonio, totalRevenue: ct.ingresos,
      totalExpenses: ct.gastos, totalCosts: 0, totalProduction: 0, netIncome: ct.utilidadNeta, equationBalance: 0, equationBalanced: true },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [], missingExpectedAccounts: [],
  } as unknown as PeriodSnapshot;
  return { periods: [snap], primary: snap, comparative: null } as unknown as PreprocessedBalance;
}

const report = {
  company: { name: 'Demo SAS', nit: '900', fiscalPeriod: '2025' },
  niifAnalysis: { balanceSheet: '', incomeStatement: '', cashFlowStatement: '', equityChangesStatement: '', technicalNotes: '', fullContent: '' },
  strategicAnalysis: { kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '', strategicRecommendations: '', fullContent: '' },
  governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
  consolidatedReport: '', generatedAt: '2026-09-01T00:00:00Z',
} as unknown as FinancialReport;

const compose = (ct: ControlTotals, classes?: PUCClass[], pillars: PillarsResult | null = null) =>
  composeEditorialReport({ report, preprocessed: preprocessed(ct, classes), pillars, language: 'es' });
const kpi = (out: ReturnType<typeof compose>, label: string) => out.kpiGrid.kpis.find((k) => k.label === label);
const gauge = (out: ReturnType<typeof compose>, label: string) => out.dialGauges.gauges.find((g) => g.label === label)!;

describe('ratios-kpis-04 — "Ingresos" = ingresos operacionales netos (41 − 4175)', () => {
  it('el KPI no es la Σ de la clase 4', () => {
    const out = compose(totals());
    expect(kpi(out, 'Ingresos operacionales netos')?.value).toBe('$1.880.000.000,00');
    expect(out.kpiGrid.kpis.some((k) => k.value === '$2.170.000.000,00')).toBe(false);
  });

  it('la cascada parte de los ingresos operacionales, separa los no operacionales y cierra en la utilidad neta', () => {
    const items = compose(totals()).waterfall.items;
    expect(items[0]).toMatchObject({ label: 'Ingresos operacionales netos', amount: 1_880 * M, sign: 'pos' });
    expect(items.find((i) => i.label === 'Otros ingresos (no operacionales)')?.amount).toBe(50 * M);
    let running = 0;
    for (const it of items) {
      if (it.sign === 'total') {
        expect(running).toBeCloseTo(it.amount, 2);
        expect(it.amount).toBe(150 * M);
      } else running += it.sign === 'pos' ? it.amount : -Math.abs(it.amount);
    }
  });

  it('sin detalle PUC de la clase 4 el KPI es N/D, no la Σ de la clase', () => {
    const out = compose(totals(), []);
    expect(kpi(out, 'Ingresos operacionales netos')?.value).toBe('N/D');
  });
});

describe('reportes-export-05 — diales con el valor real y N/D explícito', () => {
  it('razón corriente 10 imprime "10,00" (la aguja se recorta y se rotula fuera de escala)', () => {
    const out = compose(totals({ razonCorriente: 10 }));
    const g = gauge(out, 'Razón Corriente');
    expect(g.displayValue).toBe('10,00');
    expect(g.value).toBe(5);
    expect(g.outOfScale).toBe(true);
    expect(kpi(out, 'Razón Corriente')?.value).toBe('10,00');
  });

  it('ratio null → "N/D" sin aguja, nunca 0 en zona crítica', () => {
    const out = compose(totals({ pruebaAcida: null, coberturaIntereses: null }));
    expect(gauge(out, 'Prueba Ácida')).toMatchObject({ displayValue: 'N/D', noData: true });
    expect(gauge(out, 'Cobertura Intereses')).toMatchObject({ displayValue: 'N/D', noData: true });
  });

  it('endeudamiento se imprime en porcentaje es-CO, igual que la tarjeta', () => {
    const out = compose(totals({ endeudamientoTotal: 10 }));
    expect(gauge(out, 'Endeudamiento').displayValue).toBe('10,0%');
    expect(kpi(out, 'Endeudamiento')?.value).toBe('10,0%');
  });
});

describe('reportes-export-12 — null del preprocesador es N/D, no un fallback silencioso', () => {
  it('ROE null (patrimonio promedio 0) → N/D, no 200 %', () => {
    const out = compose(totals({ roe: null, patrimonio: 10 * M, utilidadNeta: 20 * M }));
    expect(kpi(out, 'ROE')?.value).toBe('N/D');
  });

  it('margen neto y razón corriente null → N/D visibles', () => {
    const out = compose(totals({ margenNeto: null, razonCorriente: null }));
    expect(kpi(out, 'Margen Neto')?.value).toBe('N/D');
    expect(kpi(out, 'Razón Corriente')?.value).toBe('N/D');
  });

  it('campo ausente (balance pre-F4) conserva el fallback y marca la base de cierre (△)', () => {
    const out = compose(totals());
    expect(kpi(out, 'ROE')?.value).toBe('25,0%');
    expect(kpi(out, 'ROE')?.note).toMatch(/△.*patrimonio de cierre/);
  });

  it('ROE sobre patrimonio promedio = cierre (sin comparativo) también se marca △', () => {
    const out = compose(totals({ roe: 25, patrimonioPromedio: 600 * M }));
    expect(kpi(out, 'ROE')?.note).toMatch(/△/);
    const avg = compose(totals({ roe: 20, patrimonioPromedio: 750 * M }));
    expect(kpi(avg, 'ROE')?.note).toBeUndefined();
  });
});

describe('reportes-export-18 — categorías por tipo de KPI y sin descartes', () => {
  const pillars = {
    valor: { pillarId: 'valor', healthScore: 80, kpis: [{ key: 'ebitda', value: 300 * M, unit: 'cop' }] },
    escudo: { pillarId: 'escudo', healthScore: 80, kpis: [{ key: 'autonomia', value: 47, unit: 'days' }] },
    futuro: { pillarId: 'futuro', healthScore: 80, kpis: [{ key: 'cagr', value: 0.12, unit: 'pct' }] },
    verdad: { pillarId: 'verdad', healthScore: 80, kpis: [] },
    overallScore: 80,
  } as unknown as PillarsResult;

  it('cada KPI lleva categoría y ninguno se pierde al agrupar (10 del balance + 3 de pilares)', () => {
    const out = compose(totals({ roe: 25, margenNeto: 7.7, razonCorriente: 2, endeudamientoTotal: 40 }), undefined, pillars);
    expect(out.kpiGrid.kpis).toHaveLength(13);
    expect(out.kpiGrid.kpis.map((k) => k.label)).toContain('Crecimiento Ingresos');
    expect(out.kpiGrid.kpis.every((k) => k.category)).toBe(true);
    const groups = groupKpisByCategory(out.kpiGrid.kpis);
    expect(groups.flatMap((g) => g.kpis)).toHaveLength(13);
    const liquidez = groups.find((g) => g.label === 'Liquidez y solvencia')!;
    expect(liquidez.kpis.map((k) => k.label)).toEqual(expect.arrayContaining(['Razón Corriente', 'Endeudamiento', 'Días Autonomía']));
    const estructura = groups.find((g) => g.label === 'Estructura financiera')!;
    expect(estructura.kpis.map((k) => k.label)).toEqual(['Activo Total', 'Pasivo Total', 'Patrimonio']);
  });
});

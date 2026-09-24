// Regresiones de la auditoría de exportes 2026-09 sobre la pestaña KPIs, el
// bloque comparativo del Resumen y el P&G de respaldo del Excel:
//   ratios-kpis-04     — "Total Ingresos" = Σ clase 4 (bruto + 4175 + grupo 42).
//   reportes-export-12 — null del preprocesador sustituido por un cálculo local;
//                        ROE de bases distintas comparado sin △; 0 % y N/D
//                        indistinguibles ('—').
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { generateFinancialExcel } from '../excel-export';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { ControlTotals, PeriodSnapshot, PreprocessedBalance, PUCClass } from '@/lib/preprocessing/trial-balance';

const M = 1_000_000;

function cls(code: number, accounts: Array<[string, number]>): PUCClass {
  return {
    code, name: String(code), auxiliaryTotal: accounts.reduce((a, [, b]) => a + b, 0), reportedTotal: null, discrepancy: 0,
    accounts: accounts.map(([c, balance]) => ({ code: c, name: c, level: 'Auxiliar', balance, isLeaf: true })),
  };
}

function ct(over: Partial<ControlTotals> = {}): ControlTotals {
  return {
    activo: 1_000 * M, activoCorriente: 600 * M, activoNoCorriente: 400 * M, pasivo: 400 * M,
    pasivoCorriente: 300 * M, pasivoNoCorriente: 100 * M, patrimonio: 600 * M,
    ingresos: 2_170 * M, ingresosNetos: 1_930 * M, gastos: 1_780 * M, utilidadNeta: 150 * M,
    efectivoCuenta11: 0, deudoresCuenta13: 0, cuentasPorPagar23: 0, impuestosCuenta24: 0, obligacionesLaborales25: 0,
    ...over,
  };
}

function snap(period: string, totals: ControlTotals): PeriodSnapshot {
  return {
    period,
    classes: [cls(4, [['413505', 2_000 * M], ['417505', 120 * M], ['421005', 50 * M]])],
    controlTotals: totals,
    equityBreakdown: {},
    summary: {
      totalAssets: totals.activo, totalLiabilities: totals.pasivo, totalEquity: totals.patrimonio,
      totalRevenue: totals.ingresos, totalExpenses: totals.gastos, totalCosts: 0, totalProduction: 0,
      netIncome: totals.utilidadNeta, equationBalance: 0, equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [], missingExpectedAccounts: [],
  } as unknown as PeriodSnapshot;
}

function pre(primary: PeriodSnapshot, comparative: PeriodSnapshot | null = null): PreprocessedBalance {
  return {
    periods: comparative ? [comparative, primary] : [primary], primary, comparative,
    rawRows: [], auxiliaryCount: 0, cleanData: '', validationReport: '',
    comparativos_impracticables: false, reclasificacionesNoCompensacion: [],
  } as unknown as PreprocessedBalance;
}

async function sheet(report: FinancialReport, p: PreprocessedBalance, name: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generateFinancialExcel({ report, preprocessed: p }) as never);
  return wb.getWorksheet(name)!;
}

function rowStarting(ws: ExcelJS.Worksheet, prefix: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((r) => { if (!found && String(r.getCell(1).value ?? '').startsWith(prefix)) found = r; });
  return found;
}

describe('ratios-kpis-04 — Ingresos operacionales netos en el Excel', () => {
  it('la pestaña KPIs no publica la Σ de la clase 4', async () => {
    const ws = await sheet(makeExportableReport(), pre(snap('2025', ct())), 'KPIs');
    expect(rowStarting(ws, 'Total Ingresos')).toBeUndefined();
    expect(rowStarting(ws, 'Ingresos operacionales netos')!.getCell(2).value).toBe(1_880 * M);
  });

  it('el comparativo del Resumen también usa los ingresos operacionales', async () => {
    const ws = await sheet(makeExportableReport(), pre(snap('2025', ct()), snap('2024', ct())), 'Resumen');
    const r = rowStarting(ws, 'Ingresos operacionales netos')!;
    expect(r.getCell(2).value).toBe(1_880 * M);
    expect(r.getCell(3).value).toBe(1_880 * M);
  });

  it('P&G de respaldo (sin JSON): utilidad bruta sobre ingresos operacionales y grupo 42 aparte', async () => {
    const report = makeExportableReport();
    report.niifAnalysis = { ...report.niifAnalysis, json: undefined };
    const ws = await sheet(report, pre(snap('2025', ct())), 'Estado Resultados');
    let op: unknown; let otros: unknown; let neta: unknown;
    ws.eachRow((r) => {
      if (r.getCell(2).value === 'INGRESOS OPERACIONALES NETOS (41 − 4175)') op = r.getCell(3).value;
      if (r.getCell(2).value === 'OTROS INGRESOS NO OPERACIONALES') otros = r.getCell(3).value;
      if (r.getCell(2).value === 'UTILIDAD NETA') neta = r.getCell(3).value;
    });
    expect(op).toBe(1_880 * M);
    expect(otros).toBe(50 * M);
    expect(neta).toBe(150 * M);
  });
});

describe('reportes-export-12 — N/D explícito y bases del ROE', () => {
  it('ROE null → "N/D" (texto), no un ROE sobre patrimonio de cierre', async () => {
    const ws = await sheet(makeExportableReport(), pre(snap('2025', ct({ roe: null }))), 'KPIs');
    expect(rowStarting(ws, 'ROE')!.getCell(2).value).toBe('N/D');
  });

  it('fallback con denominador 0 → N/D, no 0 %', async () => {
    const ws = await sheet(makeExportableReport(), pre(snap('2025', ct({ ingresosNetos: 0 }))), 'KPIs');
    expect(rowStarting(ws, 'Margen Neto')!.getCell(2).value).toBe('N/D');
  });

  it('comparativo con ROE sobre bases distintas: rotulado △ y sin variación calculada', async () => {
    const prev = snap('2024', ct({ roe: 25, patrimonioPromedio: 600 * M })); // cierre
    const curr = snap('2025', ct({ roe: 20, patrimonioPromedio: 750 * M })); // promedio
    const ws = await sheet(makeExportableReport(), pre(curr, prev), 'KPIs');
    const r = rowStarting(ws, 'ROE')!;
    expect(String(r.getCell(6).value)).toMatch(/△ Bases distintas: 2024 sobre patrimonio de cierre, 2025 sobre patrimonio promedio/);
    expect(r.getCell(4).value).toBe('N/D');
    expect(r.getCell(5).value).toBe('N/D');
  });

  it('periodo único con ROE sobre patrimonio de cierre lleva la marca △', async () => {
    const ws = await sheet(makeExportableReport(), pre(snap('2025', ct())), 'KPIs');
    expect(String(rowStarting(ws, 'ROE')!.getCell(3).value)).toMatch(/△ Calculado sobre patrimonio de cierre/);
  });

  it('el formato de porcentaje distingue 0 % de N/D', async () => {
    const ws = await sheet(makeExportableReport(), pre(snap('2025', ct({ margenNeto: 0 }))), 'KPIs');
    const cell = rowStarting(ws, 'Margen Neto')!.getCell(2);
    expect(cell.value).toBe(0);
    expect(String(cell.numFmt)).not.toContain('—');
  });
});

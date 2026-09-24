// Regresiones de la auditoría de exportes 2026-09 sobre las hojas de estados del
// Excel (excel-export.ts): correctoras en positivo (reportes-export-17), rótulo
// de pérdida (reportes-export-01, paridad con el PDF), ORI y resultado integral
// (reportes-export-15), EFE/ECP sin leyenda de comparativo (reportes-export-13),
// fecha de corte y moneda (reportes-export-14), identidad de la cabecera
// (reportes-export-10) y notas estructuradas del JSON (reportes-export-11).
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { generateFinancialExcel } from '../excel-export';
import {
  makeCoherentNiifReport,
  makeExportableReport,
} from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const line = (account: string | null, amountPrimary: string, extra: Record<string, unknown> = {}) => ({
  account, label: account ?? 'Ajuste', amountPrimary, amountComparative: null,
  level: 2 as const, isAbsolute: false, confidence: null, anomalyFlag: null, ...extra,
});

function reportWith(json: NiifReportJson): FinancialReport {
  const r = makeExportableReport();
  return { ...r, niifAnalysis: { ...r.niifAnalysis, json } };
}

async function workbook(report: FinancialReport, preprocessed?: PreprocessedBalance) {
  const buf = await generateFinancialExcel({ report, preprocessed });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

function cellTexts(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string') out.push(c.value); }));
  return out;
}

function rowByLabel(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => { if (!found && row.getCell(2).value === label) found = row; });
  return found;
}

function rowByCode(ws: ExcelJS.Worksheet, code: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => { if (!found && row.getCell(1).value === code) found = row; });
  return found;
}

describe('reportes-export-17 — correctoras restan en el Excel', () => {
  it('1592 con isAbsolute se escribe negativo y la columna suma el TOTAL ACTIVO', async () => {
    const json = makeCoherentNiifReport();
    json.balanceSheet.assets = [
      line('11', '170000'), line('1524', '1000000', { isAbsolute: true }),
      line('1592', '200000', { isAbsolute: true }), line('13', '30000'),
    ];
    const ws = (await workbook(reportWith(json))).getWorksheet('Balance NIIF')!;
    expect(rowByCode(ws, '1592')!.getCell(3).value).toBe(-2000);
    const sum = ['11', '1524', '1592', '13']
      .reduce((a, c) => a + Number(rowByCode(ws, c)!.getCell(3).value), 0);
    expect(sum).toBe(Number(rowByLabel(ws, 'TOTAL ACTIVO')!.getCell(3).value));
  });
});

describe('reportes-export-01 / -15 — rótulos del ERI y resultado integral', () => {
  it('pérdida neta rotulada PÉRDIDA y con signo; ORI y resultado integral total presentes', async () => {
    const json = makeCoherentNiifReport();
    json.incomeStatement.lines = [line('4', '100000'), line('6', '150000'), line('51', '100000'), line('53', '50000')];
    Object.assign(json.incomeStatement, {
      grossProfitPrimary: '-50000', operatingProfitPrimary: '-150000', netIncomePrimary: '-200000', oriPrimary: '30000',
    });
    const ws = (await workbook(reportWith(json))).getWorksheet('Estado Resultados')!;
    expect(rowByLabel(ws, 'PÉRDIDA NETA DEL PERÍODO')!.getCell(3).value).toBe(-2000);
    expect(rowByLabel(ws, 'OTRO RESULTADO INTEGRAL')!.getCell(3).value).toBe(300);
    expect(rowByLabel(ws, 'RESULTADO INTEGRAL TOTAL')!.getCell(3).value).toBe(-1700);
  });
});

describe('reportes-export-13 / -14 — leyendas, fecha de corte y moneda', () => {
  it('EFE y ECP declaran el comparativo no presentado', async () => {
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    const wb = await workbook(reportWith(json));
    expect(cellTexts(wb.getWorksheet('Flujos de Efectivo')!).join(' ')).toMatch(/comparativa 2024 no presentada/);
    expect(cellTexts(wb.getWorksheet('Cambios en Patrimonio')!).join(' ')).toMatch(/comparativa 2024 no presentada/);
  });

  it('cabeceras con fecha de corte (año cerrado) y moneda', async () => {
    const report = reportWith(makeCoherentNiifReport());
    const pre = {
      periods: [], primary: { period: '2025', periodoTipo: 'cerrado', classes: [], controlTotals: undefined,
        summary: { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalRevenue: 0, totalExpenses: 0, totalCosts: 0, totalProduction: 0, netIncome: 0, equationBalance: 0, equationBalanced: true },
        discrepancies: [], missingExpectedAccounts: [] },
      comparative: null,
    } as unknown as PreprocessedBalance;
    const wb = await workbook(report, pre);
    const bal = cellTexts(wb.getWorksheet('Balance NIIF')!).join(' | ');
    expect(bal).toMatch(/Al 31 de diciembre de 2025/);
    expect(bal).toMatch(/pesos colombianos \(COP\)/);
    const eri = cellTexts(wb.getWorksheet('Estado Resultados')!).join(' | ');
    expect(eri).toMatch(/Por el año terminado el 31 de diciembre de 2025/);
    const efe = cellTexts(wb.getWorksheet('Flujos de Efectivo')!).join(' | ');
    expect(efe).toMatch(/Por el año terminado el 31 de diciembre de 2025/);
  });

  it('sin preprocesado no afirma el 31 de diciembre', async () => {
    const wb = await workbook(reportWith(makeCoherentNiifReport()));
    const bal = cellTexts(wb.getWorksheet('Balance NIIF')!).join(' | ');
    expect(bal).toMatch(/fecha de corte no identificada/);
    expect(bal).not.toMatch(/31 de diciembre/);
  });
});

describe('reportes-export-10 — identidad del encabezado desde el JSON validado', () => {
  it('la cabecera usa json.company (nombre, NIT, periodo) igual que las columnas', async () => {
    const report = reportWith(makeCoherentNiifReport());
    report.company = { ...report.company, name: 'Otra Empresa SAS', nit: '800999888', fiscalPeriod: '2024' };
    const ws = (await workbook(report)).getWorksheet('Balance NIIF')!;
    expect(ws.getRow(3).getCell(1).value).toBe('Empresa Prueba SAS | NIT: 900123456 | Periodo: 2025');
  });
});

describe('reportes-export-11 — notas estructuradas del JSON en el Excel', () => {
  it('exporta technicalNotes y las notas de cada estado', async () => {
    const json = makeCoherentNiifReport();
    json.technicalNotes = [{ ref: null, norma: 'Decreto 2650/1993', body: 'Mapeo PUC → NIIF.' }];
    json.balanceSheet.notes = [{ ref: 'Nota 3', norma: null, body: 'PPE al costo.' }];
    const wb = await workbook(reportWith(json));
    expect(cellTexts(wb.getWorksheet('Balance NIIF')!)).toContain('Nota 3 — PPE al costo.');
    const all = cellTexts(wb.getWorksheet('Notas Técnicas')!);
    expect(all).toContain('Mapeo PUC → NIIF. (Decreto 2650/1993)');
  });

  it('la narrativa del LLM se marca como no auditada contra los estados', async () => {
    const wb = await workbook(reportWith(makeCoherentNiifReport()));
    expect(cellTexts(wb.getWorksheet('Resumen')!).join(' ')).toMatch(/Narrativa generada por IA/);
    expect(cellTexts(wb.getWorksheet('KPIs')!).join(' ')).toMatch(/Narrativa generada por IA/);
  });
});

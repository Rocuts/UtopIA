// ---------------------------------------------------------------------------
// Comparativo de saldos de apertura en Excel y PDF (ingesta-09, W3-A)
// ---------------------------------------------------------------------------
// Un archivo "Saldo inicial 2025 | Saldo final 2025" produce un comparativo
// 2024 desde la columna de APERTURA (`saldosDeApertura`). Su ESF es el de
// apertura, pero su P&G no es el del ejercicio 2024 (en una apertura al 1 de
// enero es $0). Excel y PDF lo presentaban como P&G comparativo ($0) y
// calculaban variaciones de resultados contra él; ahora sale N/D con leyenda.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { generateFinancialExcel } from '../excel-export';
import { composeEditorialReport } from '../pdf-elite-react/compose';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo inicial 2025,saldo final 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,0,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,20000000,20000000',
  '410505,Ventas,Auxiliar,1,0,150000000',
  '510505,Sueldos,Auxiliar,1,0,110000000',
].join('\n');

function openingPreprocessed(): PreprocessedBalance {
  const parsed = parseTrialBalanceCSVWithMeta(CSV);
  const openingPeriods = parsed.balanceColumns.filter((c) => c.kind === 'opening').map((c) => c.period);
  expect(openingPeriods).toEqual(['2024']);
  const pp = preprocessTrialBalance(parsed.rows, { openingPeriods });
  expect(pp.comparative?.saldosDeApertura).toBe(true);
  return pp;
}

function reportWithComparative(): FinancialReport {
  const report = makeExportableReport();
  const json = report.niifAnalysis.json!;
  return {
    ...report,
    niifAnalysis: { ...report.niifAnalysis, json: { ...json, company: { ...json.company, comparativePeriod: '2024' } } },
  };
}

async function workbook(report: FinancialReport, preprocessed: PreprocessedBalance | undefined) {
  const buffer = await generateFinancialExcel({ report, preprocessed });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

function findRow(ws: ExcelJS.Worksheet, col: number, label: RegExp): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (!found && typeof row.getCell(col).value === 'string' && label.test(row.getCell(col).value as string)) {
      found = row;
    }
  });
  return found;
}

function sheetText(ws: ExcelJS.Worksheet): string {
  const out: string[] = [];
  ws.eachRow((row) => row.eachCell((cell) => out.push(String(cell.value ?? ''))));
  return out.join('\n');
}

describe('Excel — P&G comparativo de saldos de apertura', () => {
  it('ERI desde el JSON: comparativo N/D, sin variaciones y con leyenda', async () => {
    const wb = await workbook(reportWithComparative(), openingPreprocessed());
    const ws = wb.getWorksheet('Estado Resultados')!;
    const net = findRow(ws, 2, /^(UTILIDAD|PÉRDIDA) NETA/);
    expect(net).toBeDefined();
    expect(net!.getCell(3).value).toBe('N/D');
    expect(net!.getCell(5).value ?? null).toBeNull();
    expect(net!.getCell(6).value ?? null).toBeNull();
    expect(sheetText(ws)).toMatch(/saldo inicial\/anterior/);
  });

  it('ERI desde la balanza (sin JSON): comparativo N/D en cuentas y totales', async () => {
    const report = reportWithComparative();
    const withoutJson: FinancialReport = {
      ...report,
      niifAnalysis: { ...report.niifAnalysis, json: undefined },
    };
    const wb = await workbook(withoutJson, openingPreprocessed());
    const ws = wb.getWorksheet('Estado Resultados')!;
    const ventas = findRow(ws, 2, /^Ventas$/);
    expect(ventas!.getCell(3).value).toBe('N/D');
    expect(ventas!.getCell(5).value ?? null).toBeNull();
    const net = findRow(ws, 2, /^UTILIDAD NETA$/);
    expect(net!.getCell(3).value).toBe('N/D');
    expect(net!.getCell(5).value ?? null).toBeNull();
    // El ESF de apertura sí es comparable.
    const balance = wb.getWorksheet('Balance NIIF')!;
    const caja = findRow(balance, 2, /^Caja$/);
    expect(caja!.getCell(3).value).toBe(50_000_000);
  });

  it('KPIs y resumen: resultados del comparativo N/D, saldos sí', async () => {
    const wb = await workbook(reportWithComparative(), openingPreprocessed());
    const kpis = wb.getWorksheet('KPIs')!;
    const utilidad = findRow(kpis, 1, /^Utilidad Neta$/);
    expect(utilidad!.getCell(2).value).toBe('N/D');
    expect(utilidad!.getCell(4).value).toBe('N/D');
    const ingresos = findRow(kpis, 1, /^Ingresos operacionales netos$/);
    expect(ingresos!.getCell(2).value).toBe('N/D');
    const activo = findRow(kpis, 1, /^Total Activo$/);
    expect(activo!.getCell(2).value).toBe(90_000_000);

    const resumen = wb.getWorksheet('Resumen')!;
    const util = findRow(resumen, 1, /^Utilidad Neta$/);
    expect(util!.getCell(2).value).toBe('N/D');
    expect(util!.getCell(4).value).toBe('N/D');
  });
});

describe('PDF — P&G comparativo de saldos de apertura', () => {
  it('composeEditorialReport marca el ERI comparativo N/D', () => {
    const doc = composeEditorialReport({
      report: reportWithComparative(),
      preprocessed: openingPreprocessed(),
      pillars: null,
      language: 'es',
    });
    const dataRows = doc.statements.income.rows.filter((r) => r.cells.length === 2);
    expect(dataRows.length).toBeGreaterThan(0);
    for (const r of dataRows) expect(r.cells[1]).toBe('N/D');
    expect((doc.statements.income.footnotes ?? []).join(' ')).toMatch(/saldo inicial\/anterior/);
  });
});

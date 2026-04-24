// ---------------------------------------------------------------------------
// Excel Export Engine — generates professional .xlsx from financial reports
// ---------------------------------------------------------------------------
// Uses ExcelJS (already in package.json). No Python, no pandas.
// Produces a multi-tab workbook with corporate formatting.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Brand colors (1+1 corporate palette)
// ---------------------------------------------------------------------------

const COLORS = {
  gold: 'FFD4A017',       // 1+1 gold
  darkNavy: 'FF0A0A0A',   // Primary dark
  white: 'FFFFFFFF',
  lightGray: 'FFF5F5F5',
  mediumGray: 'FFE5E5E5',
  textDark: 'FF333333',
  textMuted: 'FF999999',
  green: 'FF22C55E',
  red: 'FFEF4444',
  orange: 'FFF97316',
};

const FONT_MAIN = 'Calibri';

// Colombian currency format codes.
// The [$-es-CO] LCID prefix forces Excel to render with Colombian locale rules:
//   thousands separator = "."  |  decimal separator = ","
// producing: $1.234.567,89  (regardless of the viewer's OS regional settings).
const NUM_FMT_COP = '[$-es-CO]"$"#,##0.00';
const NUM_FMT_COP_INT = '[$-es-CO]"$"#,##0';

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export interface ExcelExportOptions {
  report: FinancialReport;
  preprocessed?: PreprocessedBalance;
  language?: 'es' | 'en';
}

/**
 * Generate a professional Excel workbook from a FinancialReport.
 * Returns an ExcelJS Buffer ready for download.
 */
export async function generateFinancialExcel(options: ExcelExportOptions): Promise<Buffer> {
  const { report, preprocessed } = options;
  const wb = new ExcelJS.Workbook();

  wb.creator = '1+1 Financial Orchestrator';
  wb.created = new Date();
  wb.modified = new Date();

  // Tab 1: Balance / Estado de Situacion Financiera
  addBalanceSheet(wb, report, preprocessed);

  // Tab 2: P&L / Estado de Resultados
  addIncomeStatement(wb, report, preprocessed);

  // Tab 3: KPIs / Indicadores
  addKPISheet(wb, report);

  // Tab 4: Validated Data (if preprocessed data available)
  if (preprocessed) {
    addValidationSheet(wb, preprocessed);
  }

  // Tab 5: Report Summary
  addSummarySheet(wb, report);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Tab 1: Balance / Estado de Situacion Financiera
// ---------------------------------------------------------------------------

function addBalanceSheet(wb: ExcelJS.Workbook, report: FinancialReport, prep?: PreprocessedBalance): void {
  const ws = wb.addWorksheet('Balance NIIF', { properties: { tabColor: { argb: COLORS.gold } } });
  ws.properties.defaultColWidth = 18;

  // Header
  addSheetHeader(ws, 'ESTADO DE SITUACION FINANCIERA', report);

  let row = 6;

  if (prep) {
    // Use preprocessed data for precise numbers
    const assets = prep.classes.find((c) => c.code === 1);
    const liabilities = prep.classes.find((c) => c.code === 2);
    const equity = prep.classes.find((c) => c.code === 3);

    // ACTIVO
    row = addSectionHeader(ws, row, 'ACTIVO');
    if (assets) {
      for (const acc of assets.accounts) {
        row = addAccountRow(ws, row, acc.code, acc.name, acc.balance, acc.previousBalance);
      }
    }
    row = addTotalRow(ws, row, 'TOTAL ACTIVO', prep.summary.totalAssets);
    row++;

    // PASIVO
    row = addSectionHeader(ws, row, 'PASIVO');
    if (liabilities) {
      for (const acc of liabilities.accounts) {
        row = addAccountRow(ws, row, acc.code, acc.name, acc.balance, acc.previousBalance);
      }
    }
    row = addTotalRow(ws, row, 'TOTAL PASIVO', prep.summary.totalLiabilities);
    row++;

    // PATRIMONIO
    row = addSectionHeader(ws, row, 'PATRIMONIO');
    if (equity) {
      for (const acc of equity.accounts) {
        row = addAccountRow(ws, row, acc.code, acc.name, acc.balance, acc.previousBalance);
      }
    }
    row = addTotalRow(ws, row, 'TOTAL PATRIMONIO', prep.summary.totalEquity);
    row++;

    // Verification
    row = addTotalRow(ws, row, 'TOTAL PASIVO + PATRIMONIO', prep.summary.totalLiabilities + prep.summary.totalEquity);
    row++;
    const diff = prep.summary.equationBalance;
    const verRow = ws.getRow(row);
    verRow.getCell(2).value = 'VERIFICACION';
    verRow.getCell(3).value = prep.summary.equationBalanced ? 'CUADRA' : `DIFERENCIA: $${diff.toFixed(2)}`;
    verRow.getCell(2).font = { name: FONT_MAIN, bold: true, size: 10 };
    verRow.getCell(3).font = {
      name: FONT_MAIN, bold: true, size: 10,
      color: { argb: prep.summary.equationBalanced ? COLORS.green : COLORS.red },
    };
  } else {
    // Fallback: paste the NIIF analyst's Markdown as text
    ws.getRow(row).getCell(1).value = 'Datos del reporte NIIF (ver pestaña Resumen para el contenido completo):';
    ws.getRow(row).getCell(1).font = { name: FONT_MAIN, italic: true, size: 10 };
    row++;
    const lines = report.niifAnalysis.fullContent.split('\n').slice(0, 100);
    for (const line of lines) {
      if (line.trim()) {
        ws.getRow(row).getCell(1).value = line;
        ws.getRow(row).getCell(1).font = { name: FONT_MAIN, size: 9 };
        row++;
      }
    }
  }

  // Column widths
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
}

// ---------------------------------------------------------------------------
// Tab 2: P&L / Estado de Resultados
// ---------------------------------------------------------------------------

function addIncomeStatement(wb: ExcelJS.Workbook, report: FinancialReport, prep?: PreprocessedBalance): void {
  const ws = wb.addWorksheet('Estado Resultados', { properties: { tabColor: { argb: COLORS.darkNavy } } });
  ws.properties.defaultColWidth = 18;

  addSheetHeader(ws, 'ESTADO DE RESULTADOS INTEGRAL', report);

  let row = 6;

  if (prep) {
    const revenue = prep.classes.find((c) => c.code === 4);
    const expenses = prep.classes.find((c) => c.code === 5);
    const costs = prep.classes.find((c) => c.code === 6);

    // INGRESOS
    row = addSectionHeader(ws, row, 'INGRESOS OPERACIONALES');
    if (revenue) {
      for (const acc of revenue.accounts) {
        row = addAccountRow(ws, row, acc.code, acc.name, acc.balance, acc.previousBalance);
      }
    }
    row = addTotalRow(ws, row, 'TOTAL INGRESOS', prep.summary.totalRevenue);
    row++;

    // COSTOS
    row = addSectionHeader(ws, row, 'COSTO DE VENTAS');
    if (costs) {
      for (const acc of costs.accounts) {
        row = addAccountRow(ws, row, acc.code, acc.name, acc.balance, acc.previousBalance);
      }
    }
    row = addTotalRow(ws, row, 'TOTAL COSTOS', prep.summary.totalCosts);
    row++;

    // UTILIDAD BRUTA
    const grossProfit = prep.summary.totalRevenue - prep.summary.totalCosts;
    row = addTotalRow(ws, row, 'UTILIDAD BRUTA', grossProfit);
    row++;

    // GASTOS
    row = addSectionHeader(ws, row, 'GASTOS OPERACIONALES');
    if (expenses) {
      for (const acc of expenses.accounts) {
        row = addAccountRow(ws, row, acc.code, acc.name, acc.balance, acc.previousBalance);
      }
    }
    row = addTotalRow(ws, row, 'TOTAL GASTOS', prep.summary.totalExpenses);
    row++;

    // UTILIDAD NETA
    row = addTotalRow(ws, row, 'UTILIDAD NETA', prep.summary.netIncome);
  } else {
    ws.getRow(row).getCell(1).value = report.niifAnalysis.incomeStatement || report.niifAnalysis.fullContent;
    ws.getRow(row).getCell(1).font = { name: FONT_MAIN, size: 9 };
  }

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
}

// ---------------------------------------------------------------------------
// Tab 3: KPIs
// ---------------------------------------------------------------------------

function addKPISheet(wb: ExcelJS.Workbook, report: FinancialReport): void {
  const ws = wb.addWorksheet('KPIs', { properties: { tabColor: { argb: COLORS.green } } });

  addSheetHeader(ws, 'DASHBOARD EJECUTIVO DE KPIs', report);

  let row = 6;

  // Parse KPI content from the strategy analysis
  const content = report.strategicAnalysis.fullContent;
  const sections = content.split('\n');

  for (const line of sections) {
    if (line.trim()) {
      const r = ws.getRow(row);
      r.getCell(1).value = line.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      const isHeader = line.trim().startsWith('#');
      r.getCell(1).font = {
        name: FONT_MAIN,
        bold: isHeader,
        size: isHeader ? 11 : 9,
        color: { argb: isHeader ? COLORS.darkNavy : COLORS.textDark },
      };
      row++;
    }
  }

  ws.getColumn(1).width = 80;
}

// ---------------------------------------------------------------------------
// Tab 4: Validation (preprocessed data)
// ---------------------------------------------------------------------------

function addValidationSheet(wb: ExcelJS.Workbook, prep: PreprocessedBalance): void {
  const ws = wb.addWorksheet('Validacion', { properties: { tabColor: { argb: COLORS.orange } } });

  // Header
  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = 'INFORME DE VALIDACION ARITMETICA';
  headerRow.getCell(1).font = { name: FONT_MAIN, bold: true, size: 14, color: { argb: COLORS.darkNavy } };
  ws.mergeCells('A1:E1');

  // Summary table
  let row = 3;
  const headers = ['Clase', 'Nombre', 'Total Auxiliares', 'Total Reportado', 'Estado'];
  const hRow = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    cell.alignment = { horizontal: 'center' };
  });
  row++;

  for (const c of prep.classes) {
    const r = ws.getRow(row);
    r.getCell(1).value = c.code;
    r.getCell(2).value = c.name;
    r.getCell(3).value = c.auxiliaryTotal;
    r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(4).value = c.reportedTotal ?? 'N/A';
    if (typeof r.getCell(4).value === 'number') r.getCell(4).numFmt = NUM_FMT_COP;
    r.getCell(5).value = c.discrepancy > 1 ? 'DISCREPANCIA' : 'OK';
    r.getCell(5).font = {
      name: FONT_MAIN, bold: true,
      color: { argb: c.discrepancy > 1 ? COLORS.red : COLORS.green },
    };

    if (row % 2 === 0) {
      for (let i = 1; i <= 5; i++) {
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
      }
    }
    row++;
  }

  // Discrepancies
  if (prep.discrepancies.length > 0) {
    row += 2;
    ws.getRow(row).getCell(1).value = 'DISCREPANCIAS DETECTADAS';
    ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 12, color: { argb: COLORS.red } };
    row++;

    for (const d of prep.discrepancies) {
      ws.getRow(row).getCell(1).value = d.location;
      ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true };
      ws.getRow(row).getCell(2).value = d.description;
      ws.getRow(row).getCell(3).value = d.difference;
      ws.getRow(row).getCell(3).numFmt = NUM_FMT_COP;
      row++;
    }
  }

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 18;
}

// ---------------------------------------------------------------------------
// Tab 5: Full Report Summary
// ---------------------------------------------------------------------------

function addSummarySheet(wb: ExcelJS.Workbook, report: FinancialReport): void {
  const ws = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: COLORS.gold } } });

  addSheetHeader(ws, 'REPORTE FINANCIERO CONSOLIDADO', report);

  let row = 6;
  const content = report.consolidatedReport;
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim()) {
      const r = ws.getRow(row);
      r.getCell(1).value = line.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      const isHeader = line.trim().startsWith('#');
      r.getCell(1).font = {
        name: FONT_MAIN,
        bold: isHeader,
        size: isHeader ? 11 : 9,
      };
      row++;
    }
  }

  ws.getColumn(1).width = 100;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function addSheetHeader(ws: ExcelJS.Worksheet, title: string, report: FinancialReport): void {
  // Gold bar effect
  const r1 = ws.getRow(1);
  r1.getCell(1).value = '1+1 | Reporte Financiero Elite';
  r1.getCell(1).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.gold } };

  const r2 = ws.getRow(2);
  r2.getCell(1).value = title;
  r2.getCell(1).font = { name: FONT_MAIN, bold: true, size: 14, color: { argb: COLORS.darkNavy } };

  const r3 = ws.getRow(3);
  r3.getCell(1).value = `${report.company.name} | NIT: ${report.company.nit} | Periodo: ${report.company.fiscalPeriod}`;
  r3.getCell(1).font = { name: FONT_MAIN, size: 10, color: { argb: COLORS.textMuted } };

  ws.getRow(4).getCell(1).value = '';
}

function addSectionHeader(ws: ExcelJS.Worksheet, row: number, title: string): number {
  const r = ws.getRow(row);
  r.getCell(2).value = title;
  r.getCell(2).font = { name: FONT_MAIN, bold: true, size: 11, color: { argb: COLORS.darkNavy } };
  r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
  r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
  r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
  return row + 1;
}

function addAccountRow(
  ws: ExcelJS.Worksheet,
  row: number,
  code: string,
  name: string,
  balance: number,
  previousBalance?: number,
): number {
  const r = ws.getRow(row);
  r.getCell(1).value = code;
  r.getCell(1).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  r.getCell(2).value = name;
  r.getCell(2).font = { name: FONT_MAIN, size: 9 };
  r.getCell(3).value = balance;
  r.getCell(3).numFmt = NUM_FMT_COP;
  r.getCell(3).font = { name: FONT_MAIN, size: 9 };
  if (previousBalance !== undefined) {
    r.getCell(4).value = previousBalance;
    r.getCell(4).numFmt = NUM_FMT_COP;
    r.getCell(4).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  }

  // Alternate row shading
  if (row % 2 === 0) {
    for (let i = 1; i <= 4; i++) {
      r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
    }
  }

  return row + 1;
}

function addTotalRow(ws: ExcelJS.Worksheet, row: number, label: string, amount: number): number {
  const r = ws.getRow(row);
  r.getCell(2).value = label;
  r.getCell(2).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.darkNavy } };
  r.getCell(3).value = amount;
  r.getCell(3).numFmt = NUM_FMT_COP;
  r.getCell(3).font = { name: FONT_MAIN, bold: true, size: 10 };

  // Top border for total rows
  r.getCell(2).border = { top: { style: 'thin', color: { argb: COLORS.darkNavy } } };
  r.getCell(3).border = { top: { style: 'thin', color: { argb: COLORS.darkNavy } } };

  return row + 1;
}

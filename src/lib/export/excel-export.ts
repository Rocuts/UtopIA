// ---------------------------------------------------------------------------
// Excel Export Engine — generates professional .xlsx from financial reports
// ---------------------------------------------------------------------------
// Uses ExcelJS (already in package.json). No Python, no pandas.
// Produces a multi-tab workbook with corporate formatting.
//
// Multiperiodo (T1 contract): consume preprocessed.primary, preprocessed.comparative
// y preprocessed.periods[]. NUNCA acceder a preprocessed.summary, preprocessed.classes,
// preprocessed.controlTotals o preprocessed.equityBreakdown — esas formas legacy
// fueron eliminadas; todo vive ahora en cada PeriodSnapshot.
//
// Layout multiperiodo (cuando preprocessed.periods.length >= 2):
//   Balance / P&L: Cuenta | Saldo {comparative} | Saldo {primary} | Variacion $ | Variacion %
//   KPIs: bloque por periodo con columnas paralelas
//   Validacion: una seccion por periodo
//   Resumen: bloque comparativo si aplica
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type {
  PreprocessedBalance,
  PUCClass,
  Discrepancy,
} from '@/lib/preprocessing/trial-balance';

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
const NUM_FMT_PCT = '0.00%;-0.00%;"—"';

// ---------------------------------------------------------------------------
// Multiperiodo helpers
// ---------------------------------------------------------------------------

interface PeriodView {
  period: string;
  classes: PUCClass[];
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalRevenue: number;
    totalExpenses: number;
    totalCosts: number;
    totalProduction: number;
    netIncome: number;
    equationBalance: number;
    equationBalanced: boolean;
  };
  discrepancies: Discrepancy[];
  missingExpectedAccounts: string[];
}

interface PeriodLayout {
  /** Periodo primario (corriente) — siempre presente. */
  primary: PeriodView;
  /** Periodo comparativo (anterior) — solo si hay 2+ periodos. */
  comparative: PeriodView | null;
  /** Todos los periodos (orden cronologico). */
  all: PeriodView[];
  /** True si hay >= 2 periodos. */
  isMultiPeriod: boolean;
}

/**
 * Construye un PeriodLayout consumible desde el contrato T1
 * (preprocessed.primary, preprocessed.comparative, preprocessed.periods[]).
 */
function buildPeriodLayout(prep: PreprocessedBalance): PeriodLayout {
  const all: PeriodView[] = prep.periods.map((p) => ({
    period: p.period,
    classes: p.classes,
    summary: p.summary,
    discrepancies: p.discrepancies,
    missingExpectedAccounts: p.missingExpectedAccounts,
  }));

  const primary: PeriodView = {
    period: prep.primary.period,
    classes: prep.primary.classes,
    summary: prep.primary.summary,
    discrepancies: prep.primary.discrepancies,
    missingExpectedAccounts: prep.primary.missingExpectedAccounts,
  };

  const comparative: PeriodView | null = prep.comparative
    ? {
        period: prep.comparative.period,
        classes: prep.comparative.classes,
        summary: prep.comparative.summary,
        discrepancies: prep.comparative.discrepancies,
        missingExpectedAccounts: prep.comparative.missingExpectedAccounts,
      }
    : null;

  return {
    primary,
    comparative,
    all,
    isMultiPeriod: comparative !== null,
  };
}

/**
 * Para un PUC class de un periodo, busca su contraparte por codigo en otro periodo.
 */
function findClass(classes: PUCClass[], code: number): PUCClass | undefined {
  return classes.find((c) => c.code === code);
}

/**
 * Para una cuenta de un periodo, busca el saldo equivalente (mismo codigo) en otro periodo.
 */
function findAccountBalance(classes: PUCClass[], accountCode: string): number | null {
  for (const cl of classes) {
    const acc = cl.accounts.find((a) => a.code === accountCode);
    if (acc) return acc.balance;
  }
  return null;
}

/**
 * Une la lista de codigos de cuentas que existen entre dos periodos para una clase
 * (union ordenada por codigo). Retorna metadata desde el periodo primario, con
 * fallback al comparativo si la cuenta solo existe alli.
 */
function unionAccounts(
  primaryCl: PUCClass | undefined,
  comparativeCl: PUCClass | undefined,
): Array<{ code: string; name: string; level: string }> {
  const map = new Map<string, { code: string; name: string; level: string }>();
  if (primaryCl) {
    for (const a of primaryCl.accounts) {
      map.set(a.code, { code: a.code, name: a.name, level: a.level });
    }
  }
  if (comparativeCl) {
    for (const a of comparativeCl.accounts) {
      if (!map.has(a.code)) {
        map.set(a.code, { code: a.code, name: a.name, level: a.level });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

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

  const layout = preprocessed ? buildPeriodLayout(preprocessed) : null;

  // Tab 1: Balance / Estado de Situacion Financiera
  addBalanceSheet(wb, report, layout);

  // Tab 2: P&L / Estado de Resultados
  addIncomeStatement(wb, report, layout);

  // Tab 3: KPIs / Indicadores
  addKPISheet(wb, report, layout);

  // Tab 4: Validated Data (if preprocessed data available)
  if (layout) {
    addValidationSheet(wb, layout);
  }

  // Tab 5: Report Summary
  addSummarySheet(wb, report, layout);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Tab 1: Balance / Estado de Situacion Financiera
// ---------------------------------------------------------------------------

function addBalanceSheet(
  wb: ExcelJS.Workbook,
  report: FinancialReport,
  layout: PeriodLayout | null,
): void {
  const ws = wb.addWorksheet('Balance NIIF', { properties: { tabColor: { argb: COLORS.gold } } });
  ws.properties.defaultColWidth = 18;

  // Header
  addSheetHeader(ws, 'ESTADO DE SITUACION FINANCIERA', report);

  let row = 6;

  if (layout) {
    const { primary, comparative, isMultiPeriod } = layout;

    // Column header row depends on multiperiodo
    row = addStatementColumnHeader(ws, row, primary.period, comparative?.period ?? null);

    // ACTIVO
    row = addSectionHeader(ws, row, 'ACTIVO', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 1);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL ACTIVO',
      primary.summary.totalAssets,
      comparative?.summary.totalAssets,
      isMultiPeriod,
    );
    row++;

    // PASIVO
    row = addSectionHeader(ws, row, 'PASIVO', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 2);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL PASIVO',
      primary.summary.totalLiabilities,
      comparative?.summary.totalLiabilities,
      isMultiPeriod,
    );
    row++;

    // PATRIMONIO
    row = addSectionHeader(ws, row, 'PATRIMONIO', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 3);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL PATRIMONIO',
      primary.summary.totalEquity,
      comparative?.summary.totalEquity,
      isMultiPeriod,
    );
    row++;

    // Verification
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL PASIVO + PATRIMONIO',
      primary.summary.totalLiabilities + primary.summary.totalEquity,
      comparative ? comparative.summary.totalLiabilities + comparative.summary.totalEquity : undefined,
      isMultiPeriod,
    );
    row++;
    const diff = primary.summary.equationBalance;
    const verRow = ws.getRow(row);
    verRow.getCell(2).value = `VERIFICACION (${primary.period})`;
    verRow.getCell(3).value = primary.summary.equationBalanced ? 'CUADRA' : `DIFERENCIA: $${diff.toFixed(2)}`;
    verRow.getCell(2).font = { name: FONT_MAIN, bold: true, size: 10 };
    verRow.getCell(3).font = {
      name: FONT_MAIN, bold: true, size: 10,
      color: { argb: primary.summary.equationBalanced ? COLORS.green : COLORS.red },
    };
    if (comparative) {
      row++;
      const verRow2 = ws.getRow(row);
      const diff2 = comparative.summary.equationBalance;
      verRow2.getCell(2).value = `VERIFICACION (${comparative.period})`;
      verRow2.getCell(3).value = comparative.summary.equationBalanced ? 'CUADRA' : `DIFERENCIA: $${diff2.toFixed(2)}`;
      verRow2.getCell(2).font = { name: FONT_MAIN, bold: true, size: 10 };
      verRow2.getCell(3).font = {
        name: FONT_MAIN, bold: true, size: 10,
        color: { argb: comparative.summary.equationBalanced ? COLORS.green : COLORS.red },
      };
    }
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
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 14;
}

// ---------------------------------------------------------------------------
// Tab 2: P&L / Estado de Resultados
// ---------------------------------------------------------------------------

function addIncomeStatement(
  wb: ExcelJS.Workbook,
  report: FinancialReport,
  layout: PeriodLayout | null,
): void {
  const ws = wb.addWorksheet('Estado Resultados', { properties: { tabColor: { argb: COLORS.darkNavy } } });
  ws.properties.defaultColWidth = 18;

  addSheetHeader(ws, 'ESTADO DE RESULTADOS INTEGRAL', report);

  let row = 6;

  if (layout) {
    const { primary, comparative, isMultiPeriod } = layout;

    row = addStatementColumnHeader(ws, row, primary.period, comparative?.period ?? null);

    // INGRESOS
    row = addSectionHeader(ws, row, 'INGRESOS OPERACIONALES', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 4);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL INGRESOS',
      primary.summary.totalRevenue,
      comparative?.summary.totalRevenue,
      isMultiPeriod,
    );
    row++;

    // COSTOS (Clase 6)
    row = addSectionHeader(ws, row, 'COSTO DE VENTAS', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 6);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL COSTOS',
      primary.summary.totalCosts,
      comparative?.summary.totalCosts,
      isMultiPeriod,
    );
    row++;

    // UTILIDAD BRUTA
    const grossPrim = primary.summary.totalRevenue - primary.summary.totalCosts;
    const grossComp = comparative
      ? comparative.summary.totalRevenue - comparative.summary.totalCosts
      : undefined;
    row = addStatementTotalRow(ws, row, 'UTILIDAD BRUTA', grossPrim, grossComp, isMultiPeriod);
    row++;

    // GASTOS
    row = addSectionHeader(ws, row, 'GASTOS OPERACIONALES', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 5);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL GASTOS',
      primary.summary.totalExpenses,
      comparative?.summary.totalExpenses,
      isMultiPeriod,
    );
    row++;

    // UTILIDAD NETA
    row = addStatementTotalRow(
      ws,
      row,
      'UTILIDAD NETA',
      primary.summary.netIncome,
      comparative?.summary.netIncome,
      isMultiPeriod,
    );
  } else {
    ws.getRow(row).getCell(1).value = report.niifAnalysis.incomeStatement || report.niifAnalysis.fullContent;
    ws.getRow(row).getCell(1).font = { name: FONT_MAIN, size: 9 };
  }

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 14;
}

// ---------------------------------------------------------------------------
// Tab 3: KPIs
// ---------------------------------------------------------------------------

function addKPISheet(
  wb: ExcelJS.Workbook,
  report: FinancialReport,
  layout: PeriodLayout | null,
): void {
  const ws = wb.addWorksheet('KPIs', { properties: { tabColor: { argb: COLORS.green } } });

  addSheetHeader(ws, 'DASHBOARD EJECUTIVO DE KPIs', report);

  let row = 6;

  // Bloque comparativo derivado del preprocessed (deterministico, NO LLM)
  if (layout && layout.isMultiPeriod && layout.comparative) {
    row = addKPIComparativeBlock(ws, row, layout.primary, layout.comparative);
    row += 2;
  } else if (layout) {
    row = addKPISinglePeriodBlock(ws, row, layout.primary);
    row += 2;
  }

  // KPIs narrativos del Strategy Director (mantenemos contenido del reporte)
  ws.getRow(row).getCell(1).value = 'KPIs del Analisis Estrategico (narrativa)';
  ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 12, color: { argb: COLORS.darkNavy } };
  row += 2;

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

  ws.getColumn(1).width = 50;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 14;
}

/**
 * Tabla comparativa de KPIs deterministicos derivados del preprocessed.
 * Layout: KPI | <comparative.period> | <primary.period> | Variacion $ | Variacion %
 */
function addKPIComparativeBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  primary: PeriodView,
  comparative: PeriodView,
): number {
  let row = startRow;
  ws.getRow(row).getCell(1).value = 'KPIs Determinísticos (calculados desde el balance preprocesado)';
  ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 12, color: { argb: COLORS.darkNavy } };
  row += 2;

  // Headers
  const headers = ['KPI', comparative.period, primary.period, 'Variacion', 'Variacion %'];
  const hRow = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    cell.alignment = { horizontal: 'center' };
  });
  row++;

  const kpis = computeKPIs(primary, comparative);
  for (const k of kpis) {
    const r = ws.getRow(row);
    r.getCell(1).value = k.label;
    r.getCell(1).font = { name: FONT_MAIN, size: 10 };
    r.getCell(2).value = k.prev;
    r.getCell(3).value = k.curr;
    r.getCell(4).value = k.delta;
    r.getCell(5).value = k.deltaPct;

    if (k.isPct) {
      r.getCell(2).numFmt = NUM_FMT_PCT;
      r.getCell(3).numFmt = NUM_FMT_PCT;
      r.getCell(4).numFmt = NUM_FMT_PCT;
    } else if (k.isMoney) {
      r.getCell(2).numFmt = NUM_FMT_COP_INT;
      r.getCell(3).numFmt = NUM_FMT_COP_INT;
      r.getCell(4).numFmt = NUM_FMT_COP_INT;
    } else {
      r.getCell(2).numFmt = '0.00';
      r.getCell(3).numFmt = '0.00';
      r.getCell(4).numFmt = '0.00';
    }
    r.getCell(5).numFmt = NUM_FMT_PCT;

    if (row % 2 === 0) {
      for (let i = 1; i <= 5; i++) {
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
      }
    }
    row++;
  }

  return row;
}

function addKPISinglePeriodBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  primary: PeriodView,
): number {
  let row = startRow;
  ws.getRow(row).getCell(1).value = `KPIs Determinísticos — ${primary.period}`;
  ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 12, color: { argb: COLORS.darkNavy } };
  row += 2;

  const headers = ['KPI', primary.period];
  const hRow = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    cell.alignment = { horizontal: 'center' };
  });
  row++;

  const kpis = computeKPIs(primary, null);
  for (const k of kpis) {
    const r = ws.getRow(row);
    r.getCell(1).value = k.label;
    r.getCell(2).value = k.curr;

    if (k.isPct) {
      r.getCell(2).numFmt = NUM_FMT_PCT;
    } else if (k.isMoney) {
      r.getCell(2).numFmt = NUM_FMT_COP_INT;
    } else {
      r.getCell(2).numFmt = '0.00';
    }

    if (row % 2 === 0) {
      for (let i = 1; i <= 2; i++) {
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
      }
    }
    row++;
  }

  return row;
}

interface KPIRow {
  label: string;
  curr: number;
  prev: number;
  delta: number;
  deltaPct: number;
  isPct: boolean;
  isMoney: boolean;
}

function computeKPIs(primary: PeriodView, comparative: PeriodView | null): KPIRow[] {
  const kpiOf = (label: string, currVal: number, prevVal: number, opts: { isPct?: boolean; isMoney?: boolean }): KPIRow => {
    const delta = currVal - prevVal;
    const deltaPct = prevVal !== 0 ? delta / Math.abs(prevVal) : 0;
    return { label, curr: currVal, prev: prevVal, delta, deltaPct, isPct: !!opts.isPct, isMoney: !!opts.isMoney };
  };

  const p = primary.summary;
  const c = comparative?.summary ?? {
    totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalRevenue: 0,
    totalExpenses: 0, totalCosts: 0, totalProduction: 0, netIncome: 0,
    equationBalance: 0, equationBalanced: true,
  };

  const margenNetoP = p.totalRevenue !== 0 ? p.netIncome / p.totalRevenue : 0;
  const margenNetoC = c.totalRevenue !== 0 ? c.netIncome / c.totalRevenue : 0;

  const endeudamientoP = p.totalAssets !== 0 ? p.totalLiabilities / p.totalAssets : 0;
  const endeudamientoC = c.totalAssets !== 0 ? c.totalLiabilities / c.totalAssets : 0;

  const roaP = p.totalAssets !== 0 ? p.netIncome / p.totalAssets : 0;
  const roaC = c.totalAssets !== 0 ? c.netIncome / c.totalAssets : 0;

  const roeP = p.totalEquity !== 0 ? p.netIncome / p.totalEquity : 0;
  const roeC = c.totalEquity !== 0 ? c.netIncome / c.totalEquity : 0;

  return [
    kpiOf('Total Activo', p.totalAssets, c.totalAssets, { isMoney: true }),
    kpiOf('Total Pasivo', p.totalLiabilities, c.totalLiabilities, { isMoney: true }),
    kpiOf('Total Patrimonio', p.totalEquity, c.totalEquity, { isMoney: true }),
    kpiOf('Total Ingresos', p.totalRevenue, c.totalRevenue, { isMoney: true }),
    kpiOf('Utilidad Neta', p.netIncome, c.netIncome, { isMoney: true }),
    kpiOf('Margen Neto', margenNetoP, margenNetoC, { isPct: true }),
    kpiOf('Endeudamiento', endeudamientoP, endeudamientoC, { isPct: true }),
    kpiOf('ROA', roaP, roaC, { isPct: true }),
    kpiOf('ROE', roeP, roeC, { isPct: true }),
  ];
}

// ---------------------------------------------------------------------------
// Tab 4: Validation (preprocessed data)
// ---------------------------------------------------------------------------

function addValidationSheet(wb: ExcelJS.Workbook, layout: PeriodLayout): void {
  const ws = wb.addWorksheet('Validacion', { properties: { tabColor: { argb: COLORS.orange } } });

  // Header
  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = 'INFORME DE VALIDACION ARITMETICA';
  headerRow.getCell(1).font = { name: FONT_MAIN, bold: true, size: 14, color: { argb: COLORS.darkNavy } };
  ws.mergeCells('A1:E1');

  let row = 3;

  // Una seccion por periodo
  for (let i = 0; i < layout.all.length; i++) {
    const p = layout.all[i];
    if (i > 0) row += 2;

    // Periodo header
    const pRow = ws.getRow(row);
    pRow.getCell(1).value = `Periodo: ${p.period}`;
    pRow.getCell(1).font = { name: FONT_MAIN, bold: true, size: 12, color: { argb: COLORS.gold } };
    pRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    ws.mergeCells(`A${row}:E${row}`);
    row += 2;

    // Headers de tabla por clase
    const headers = ['Clase', 'Nombre', 'Total Auxiliares', 'Total Reportado', 'Estado'];
    const hRow = ws.getRow(row);
    headers.forEach((h, idx) => {
      const cell = hRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
      cell.alignment = { horizontal: 'center' };
    });
    row++;

    for (const c of p.classes) {
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
        for (let idx = 1; idx <= 5; idx++) {
          r.getCell(idx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
        }
      }
      row++;
    }

    // Discrepancias del periodo
    if (p.discrepancies.length > 0) {
      row += 1;
      ws.getRow(row).getCell(1).value = `DISCREPANCIAS DETECTADAS — ${p.period}`;
      ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 11, color: { argb: COLORS.red } };
      row++;

      for (const d of p.discrepancies) {
        ws.getRow(row).getCell(1).value = d.location;
        ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true };
        ws.getRow(row).getCell(2).value = d.description;
        ws.getRow(row).getCell(3).value = d.difference;
        ws.getRow(row).getCell(3).numFmt = NUM_FMT_COP;
        row++;
      }
    }

    // Cuentas faltantes esperadas
    if (p.missingExpectedAccounts.length > 0) {
      row += 1;
      ws.getRow(row).getCell(1).value = `CUENTAS PUC ESPERADAS AUSENTES — ${p.period}`;
      ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 11, color: { argb: COLORS.orange } };
      row++;
      for (const m of p.missingExpectedAccounts) {
        ws.getRow(row).getCell(1).value = m;
        ws.getRow(row).getCell(1).font = { name: FONT_MAIN, size: 9 };
        row++;
      }
    }
  }

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 35;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 18;
}

// ---------------------------------------------------------------------------
// Tab 5: Full Report Summary
// ---------------------------------------------------------------------------

function addSummarySheet(
  wb: ExcelJS.Workbook,
  report: FinancialReport,
  layout: PeriodLayout | null,
): void {
  const ws = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: COLORS.gold } } });

  addSheetHeader(ws, 'REPORTE FINANCIERO CONSOLIDADO', report);

  let row = 6;

  // Bloque comparativo de cabecera (si aplica)
  if (layout && layout.isMultiPeriod && layout.comparative) {
    row = addComparativeSummaryBlock(ws, row, layout.primary, layout.comparative);
    row += 2;
  }

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

function addComparativeSummaryBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  primary: PeriodView,
  comparative: PeriodView,
): number {
  let row = startRow;
  ws.getRow(row).getCell(1).value = `COMPARATIVO ${comparative.period} vs ${primary.period}`;
  ws.getRow(row).getCell(1).font = { name: FONT_MAIN, bold: true, size: 13, color: { argb: COLORS.gold } };
  row += 2;

  const lines: Array<[string, number, number]> = [
    ['Total Activo', comparative.summary.totalAssets, primary.summary.totalAssets],
    ['Total Pasivo', comparative.summary.totalLiabilities, primary.summary.totalLiabilities],
    ['Total Patrimonio', comparative.summary.totalEquity, primary.summary.totalEquity],
    ['Ingresos', comparative.summary.totalRevenue, primary.summary.totalRevenue],
    ['Utilidad Neta', comparative.summary.netIncome, primary.summary.netIncome],
  ];

  // Header
  const headers = ['Concepto', comparative.period, primary.period, 'Variacion', '% Var'];
  const hRow = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    cell.alignment = { horizontal: 'center' };
  });
  row++;

  for (const [label, prev, curr] of lines) {
    const r = ws.getRow(row);
    r.getCell(1).value = label;
    r.getCell(2).value = prev;
    r.getCell(2).numFmt = NUM_FMT_COP_INT;
    r.getCell(3).value = curr;
    r.getCell(3).numFmt = NUM_FMT_COP_INT;
    r.getCell(4).value = curr - prev;
    r.getCell(4).numFmt = NUM_FMT_COP_INT;
    r.getCell(5).value = prev !== 0 ? (curr - prev) / Math.abs(prev) : 0;
    r.getCell(5).numFmt = NUM_FMT_PCT;
    if (row % 2 === 0) {
      for (let i = 1; i <= 5; i++) {
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
      }
    }
    row++;
  }
  return row;
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

/**
 * Encabezado de columnas de un estado financiero. En multiperiodo:
 *   col 1: Codigo | col 2: Cuenta | col 3: <comparative> | col 4: <primary> | col 5: Var $ | col 6: Var %
 * En periodo unico:
 *   col 1: Codigo | col 2: Cuenta | col 3: Saldo
 */
function addStatementColumnHeader(
  ws: ExcelJS.Worksheet,
  row: number,
  primaryPeriod: string,
  comparativePeriod: string | null,
): number {
  const r = ws.getRow(row);
  r.getCell(1).value = 'Codigo';
  r.getCell(2).value = 'Cuenta';
  if (comparativePeriod) {
    r.getCell(3).value = `Saldo ${comparativePeriod}`;
    r.getCell(4).value = `Saldo ${primaryPeriod}`;
    r.getCell(5).value = 'Variacion $';
    r.getCell(6).value = 'Variacion %';
  } else {
    r.getCell(3).value = `Saldo ${primaryPeriod}`;
  }
  for (let i = 1; i <= (comparativePeriod ? 6 : 3); i++) {
    r.getCell(i).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    r.getCell(i).alignment = { horizontal: 'center' };
  }
  return row + 1;
}

function addSectionHeader(
  ws: ExcelJS.Worksheet,
  row: number,
  title: string,
  isMultiPeriod: boolean,
): number {
  const r = ws.getRow(row);
  r.getCell(2).value = title;
  r.getCell(2).font = { name: FONT_MAIN, bold: true, size: 11, color: { argb: COLORS.darkNavy } };
  const span = isMultiPeriod ? 6 : 4;
  for (let i = 2; i <= span; i++) {
    r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
  }
  return row + 1;
}

/**
 * Anade filas de cuentas de una clase, uniendo cuentas entre primary y comparative
 * cuando hay multiperiodo.
 */
function addClassRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  primary: PeriodView,
  comparative: PeriodView | null,
  classCode: number,
): number {
  let row = startRow;
  const primaryCl = findClass(primary.classes, classCode);
  const comparativeCl = comparative ? findClass(comparative.classes, classCode) : undefined;

  if (comparative) {
    const merged = unionAccounts(primaryCl, comparativeCl);
    for (const meta of merged) {
      const currBal = primaryCl ? findAccountBalance([primaryCl], meta.code) ?? 0 : 0;
      const prevBal = comparativeCl ? findAccountBalance([comparativeCl], meta.code) ?? 0 : 0;
      row = addAccountRowMulti(ws, row, meta.code, meta.name, prevBal, currBal);
    }
  } else if (primaryCl) {
    for (const acc of primaryCl.accounts) {
      row = addAccountRowSingle(ws, row, acc.code, acc.name, acc.balance);
    }
  }
  return row;
}

function addAccountRowSingle(
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

  if (row % 2 === 0) {
    for (let i = 1; i <= 4; i++) {
      r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
    }
  }
  return row + 1;
}

/**
 * Fila de cuenta con layout multiperiodo:
 *   Codigo | Cuenta | Saldo {prev} | Saldo {curr} | Variacion $ | Variacion %
 */
function addAccountRowMulti(
  ws: ExcelJS.Worksheet,
  row: number,
  code: string,
  name: string,
  prevBalance: number,
  currBalance: number,
): number {
  const r = ws.getRow(row);
  r.getCell(1).value = code;
  r.getCell(1).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  r.getCell(2).value = name;
  r.getCell(2).font = { name: FONT_MAIN, size: 9 };
  r.getCell(3).value = prevBalance;
  r.getCell(3).numFmt = NUM_FMT_COP;
  r.getCell(3).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  r.getCell(4).value = currBalance;
  r.getCell(4).numFmt = NUM_FMT_COP;
  r.getCell(4).font = { name: FONT_MAIN, size: 9 };
  const delta = currBalance - prevBalance;
  r.getCell(5).value = delta;
  r.getCell(5).numFmt = NUM_FMT_COP;
  r.getCell(5).font = {
    name: FONT_MAIN,
    size: 9,
    color: { argb: delta >= 0 ? COLORS.green : COLORS.red },
  };
  r.getCell(6).value = prevBalance !== 0 ? delta / Math.abs(prevBalance) : 0;
  r.getCell(6).numFmt = NUM_FMT_PCT;
  r.getCell(6).font = {
    name: FONT_MAIN,
    size: 9,
    color: { argb: delta >= 0 ? COLORS.green : COLORS.red },
  };

  if (row % 2 === 0) {
    for (let i = 1; i <= 6; i++) {
      r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
    }
  }
  return row + 1;
}

/**
 * Fila de total con layout que respeta multiperiodo.
 */
function addStatementTotalRow(
  ws: ExcelJS.Worksheet,
  row: number,
  label: string,
  primaryAmount: number,
  comparativeAmount: number | undefined,
  isMultiPeriod: boolean,
): number {
  const r = ws.getRow(row);
  r.getCell(2).value = label;
  r.getCell(2).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.darkNavy } };

  if (isMultiPeriod && comparativeAmount !== undefined) {
    r.getCell(3).value = comparativeAmount;
    r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(3).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.textMuted } };
    r.getCell(4).value = primaryAmount;
    r.getCell(4).numFmt = NUM_FMT_COP;
    r.getCell(4).font = { name: FONT_MAIN, bold: true, size: 10 };
    const delta = primaryAmount - comparativeAmount;
    r.getCell(5).value = delta;
    r.getCell(5).numFmt = NUM_FMT_COP;
    r.getCell(5).font = {
      name: FONT_MAIN, bold: true, size: 10,
      color: { argb: delta >= 0 ? COLORS.green : COLORS.red },
    };
    r.getCell(6).value = comparativeAmount !== 0 ? delta / Math.abs(comparativeAmount) : 0;
    r.getCell(6).numFmt = NUM_FMT_PCT;
    r.getCell(6).font = {
      name: FONT_MAIN, bold: true, size: 10,
      color: { argb: delta >= 0 ? COLORS.green : COLORS.red },
    };

    for (let i = 2; i <= 6; i++) {
      r.getCell(i).border = { top: { style: 'thin', color: { argb: COLORS.darkNavy } } };
    }
  } else {
    r.getCell(3).value = primaryAmount;
    r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(3).font = { name: FONT_MAIN, bold: true, size: 10 };
    r.getCell(2).border = { top: { style: 'thin', color: { argb: COLORS.darkNavy } } };
    r.getCell(3).border = { top: { style: 'thin', color: { argb: COLORS.darkNavy } } };
  }

  return row + 1;
}

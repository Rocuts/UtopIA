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
import { formatCopFromCents, parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { StatementLineJson } from '@/lib/agents/financial/contracts/base';
import type {
  ControlTotals,
  PreprocessedBalance,
  PUCClass,
  Discrepancy,
} from '@/lib/preprocessing/trial-balance';
import type {
  Reclassification,
  ConvergenceAdjustment,
  CashFlowClosureAdjustment,
  PresumedCostWarning,
  VirtualCloseAdjustment,
} from '@/lib/preprocessing/curator-rules/types';

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
//
// La sección negativa usa PARÉNTESIS — misma convención NIIF que
// `formatCopFromCents` (contracts/money.ts) y que los estados financieros del
// PDF Élite. Antes el workbook heredaba el formato por defecto (`-$1.234,56`)
// y el cliente veía dos tipografías del mismo signo entre entregables.
// Que el negativo sea legible es lo que permite dejar de aplicar `Math.abs`
// sobre pasivo y patrimonio: un patrimonio negativo es causal de disolución
// (Art. 457 num. 2 C.Co.) y debe verse como tal.
const NUM_FMT_COP = '[$-es-CO]"$"#,##0.00;[$-es-CO]("$"#,##0.00)';
const NUM_FMT_COP_INT = '[$-es-CO]"$"#,##0;[$-es-CO]("$"#,##0)';
const NUM_FMT_PCT = '0.00%;-0.00%;"—"';

/**
 * MoneyCop (string de centavos) → pesos como `number` para la celda de Excel.
 *
 * Excel necesita un número nativo para poder aplicar `numFmt` y permitir que el
 * cliente opere sobre la celda; los centavos exactos se convierten aquí, en el
 * único punto de frontera. `Number(bigint)` es exacto hasta 2^53 centavos
 * (≈ $90 billones COP), muy por encima del segmento.
 */
function centsToPesos(value: string): number {
  return Number(parseMoneyCop(value)) / 100;
}

/**
 * Pesos (number) → texto COP, delegando en el helper canónico
 * `formatCopFromCents`. Se usa SÓLO donde la cifra viaja embebida en una frase
 * (notas al pie, verificaciones) y no puede llevar `numFmt` propio; las celdas
 * numéricas siempre se escriben como número + `NUM_FMT_COP`.
 *
 * Why: había tres formatters de dinero conviviendo con convenciones de negativo
 * distintas (`-$X`, `($X)`, `toLocaleString` a secas). Toda cifra de este
 * workbook sale ahora de la misma aritmética exacta en centavos.
 */
function fmtCopPesos(pesos: number): string {
  if (!Number.isFinite(pesos)) return 'N/D';
  return formatCopFromCents(Math.round(pesos * 100), false);
}

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
  /**
   * Totales de control del periodo — contrato numérico vinculante y fuente
   * única de los ratios (Wave 2.F4). La pestaña de KPIs los consume en lugar de
   * recalcular con fórmulas propias: recalcular ROE sobre patrimonio de cierre
   * hacía que el .xlsx imprimiera un ROE distinto al del HTML/PDF, que usan
   * `controlTotals.roe` (patrimonio promedio).
   */
  controlTotals?: ControlTotals;
}

interface PeriodLayout {
  /** Periodo primario (corriente) — siempre presente. */
  primary: PeriodView & {
    reclassifications?: Reclassification[];
    equityAnchorAdjustment?: number;
    cashFlowClosureAdjustment?: number;
    presumedCostWarning?: PresumedCostWarning;
    equityBreakdown?: { convergenceAdjustment?: number };
    curatorConvergenceAdjustment?: ConvergenceAdjustment;
    curatorCashFlowClosure?: CashFlowClosureAdjustment;
    virtualCloseAdjustment?: VirtualCloseAdjustment;
  };
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
    controlTotals: p.controlTotals,
  }));

  const primary: PeriodLayout['primary'] = {
    period: prep.primary.period,
    classes: prep.primary.classes,
    summary: prep.primary.summary,
    discrepancies: prep.primary.discrepancies,
    missingExpectedAccounts: prep.primary.missingExpectedAccounts,
    controlTotals: prep.primary.controlTotals,
    reclassifications: prep.primary.reclassifications ?? prep.primary.curator?.reclassifications,
    equityAnchorAdjustment: prep.primary.equityAnchorAdjustment ?? undefined,
    cashFlowClosureAdjustment:
      typeof prep.primary.cashFlowClosureAdjustment === 'number'
        ? prep.primary.cashFlowClosureAdjustment
        : undefined,
    presumedCostWarning: prep.primary.presumedCostWarning ?? prep.primary.curator?.presumedCostWarning,
    equityBreakdown: prep.primary.equityBreakdown,
    curatorConvergenceAdjustment: prep.primary.curator?.convergenceAdjustment,
    curatorCashFlowClosure: prep.primary.curator?.cashFlowClosureAdjustment,
    virtualCloseAdjustment:
      prep.primary.virtualCloseAdjustment ?? prep.primary.curator?.virtualCloseAdjustment,
  };

  const comparative: PeriodView | null = prep.comparative
    ? {
        period: prep.comparative.period,
        classes: prep.comparative.classes,
        summary: prep.comparative.summary,
        discrepancies: prep.comparative.discrepancies,
        missingExpectedAccounts: prep.comparative.missingExpectedAccounts,
        controlTotals: prep.comparative.controlTotals,
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

  // Complete the four structured statements from the same validated JSON.
  if (report.niifAnalysis.json) addCashFlowAndEquitySheets(wb, report);

  // Tab 3: KPIs / Indicadores
  addKPISheet(wb, report, layout);

  // Tab 4: Validated Data (if preprocessed data available)
  if (layout) {
    addValidationSheet(wb, layout);
  }

  // Tab 5: Report Summary
  addSummarySheet(wb, report, layout);

  // Tab 6: Ajustes Pulido Diamante (only when at least one mutation is present)
  if (layout && hasPulidoDiamanteData(layout)) {
    addPulidoDiamanteSheet(wb, layout);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function addCashFlowAndEquitySheets(wb: ExcelJS.Workbook, report: FinancialReport): void {
  const json = report.niifAnalysis.json!;
  const cash = wb.addWorksheet('Flujos de Efectivo');
  cash.columns = [{ width: 58 }, { width: 24 }];
  cash.addRow(['ESTADO DE FLUJOS DE EFECTIVO', json.company.fiscalPeriod]);
  cash.addRow([report.company.name, 'COP']);
  const addCash = (label: string, cents: string, bold = false) => {
    const row = cash.addRow([label, centsToPesos(cents)]);
    row.font = { name: FONT_MAIN, bold };
    row.getCell(2).numFmt = NUM_FMT_COP;
  };
  addCash('Efectivo al inicio', json.cashFlow.cashOpening, true);
  const sectionNames = { operating: 'Operación', investing: 'Inversión', financing: 'Financiación' };
  for (const section of json.cashFlow.sections) {
    cash.addRow([sectionNames[section.section]]).font = { name: FONT_MAIN, bold: true };
    for (const line of section.lines) addCash(line.label, line.amountPrimary);
    addCash(`Flujo neto de ${sectionNames[section.section]}`, section.netFlow, true);
  }
  addCash('Variación neta del efectivo', json.cashFlow.netChange, true);
  addCash('Efectivo al cierre', json.cashFlow.cashClosing, true);
  cash.addRow([json.cashFlow.methodNote]);

  const equity = wb.addWorksheet('Cambios en Patrimonio');
  equity.columns = [{ width: 46 }, ...Array.from({ length: 8 }, () => ({ width: 23 }))];
  equity.addRow(['ESTADO DE CAMBIOS EN EL PATRIMONIO', json.company.fiscalPeriod]);
  equity.addRow([report.company.name, 'COP']);
  equity.addRow(['Movimiento', 'Capital social', 'Prima colocación', 'Reserva legal',
    'Otras reservas', 'Resultados acumulados', 'Resultado ejercicio', 'ORI', 'Total'])
    .font = { name: FONT_MAIN, bold: true };
  const keys = ['capitalSocial', 'primaColocacion', 'reservaLegal', 'otrasReservas',
    'resultadosAcumulados', 'resultadoEjercicio', 'ori', 'total'] as const;
  for (const movement of json.equityChanges.rows) {
    const row = equity.addRow([movement.label, ...keys.map(key => centsToPesos(movement[key]))]);
    row.font = { name: FONT_MAIN, bold: ['opening_balance', 'closing_balance'].includes(movement.kind) };
    for (let col = 2; col <= 9; col++) row.getCell(col).numFmt = NUM_FMT_COP;
  }
  for (const sheet of [cash, equity]) {
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
    sheet.pageSetup = { orientation: sheet === equity ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
}

/** Returns true if any Pulido Diamante mutation data exists in the primary snapshot. */
function hasPulidoDiamanteData(layout: PeriodLayout): boolean {
  const p = layout.primary;
  return (
    (Array.isArray(p.reclassifications) && p.reclassifications.length > 0) ||
    (p.equityAnchorAdjustment !== undefined && p.equityAnchorAdjustment !== 0) ||
    (p.cashFlowClosureAdjustment !== undefined && p.cashFlowClosureAdjustment !== 0) ||
    p.presumedCostWarning !== undefined ||
    (p.curatorConvergenceAdjustment !== undefined) ||
    (p.curatorCashFlowClosure !== undefined)
  );
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

  const json = report.niifAnalysis.json;

  if (json) {
    // ── Fuente canónica: JSON-strict validado del NIIF Analyst ──────────────
    // Es el MISMO objeto que alimentan el PDF Élite (compose-statements-from-
    // json.ts) y el HTML del Editor Jefe. Antes esta rama sólo corría cuando
    // faltaba el preprocesado, de modo que en el caso normal el .xlsx mostraba
    // agregados de la balanza CRUDA (pre-analista) mientras PDF y HTML
    // mostraban los estados ya ajustados —reclasificaciones, convergencia
    // patrimonial, cierre virtual—. Ante cualquier ajuste del analista los tres
    // entregables del mismo informe decían cifras distintas para el mismo
    // rubro. El preprocesado sigue alimentando las pestañas de trazabilidad
    // (Validacion, Pulido Diamante) y los ratios de la pestaña KPIs.
    row = addBalanceSheetFromJson(ws, row, json);
  } else if (layout) {
    const { primary, comparative, isMultiPeriod } = layout;

    // Column header row depends on multiperiodo
    const hasReclassifications = Array.isArray(primary.reclassifications) && primary.reclassifications.length > 0;
    row = addStatementColumnHeader(ws, row, primary.period, comparative?.period ?? null, hasReclassifications);

    // ACTIVO
    row = addSectionHeader(ws, row, 'ACTIVO', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 1, { reclassifications: primary.reclassifications });
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
    // Sin Math.abs: el saldo contrario de una cuenta de pasivo (p. ej. un
    // impuesto sobrepagado) es información, no ruido, y el total firmado es el
    // que cuadra contra 'TOTAL PASIVO + PATRIMONIO'. El formato contable con
    // paréntesis (NUM_FMT_COP) preserva la convención NIIF de presentación.
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
    // Mismo criterio: un patrimonio (o una cuenta patrimonial) negativo es
    // causal de disolución (Art. 457 num. 2 C.Co.) y bandera de empresa en
    // marcha (NIA 570). Imprimirlo en valor absoluto lo convertía en su
    // contrario justo en el renglón que el socio mira primero, y además hacía
    // que las líneas no sumaran el total firmado de más abajo.
    row = addSectionHeader(ws, row, 'PATRIMONIO', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 3);

    // Línea de convergencia patrimonial R5 (si aplica)
    const convAdj = primary.curatorConvergenceAdjustment ?? primary.equityBreakdown?.convergenceAdjustment;
    const convAdjAmount = typeof convAdj === 'object' && convAdj !== null
      ? (convAdj as ConvergenceAdjustment).gapCop
      : typeof convAdj === 'number'
        ? convAdj
        : undefined;
    if (convAdjAmount !== undefined && convAdjAmount !== 0) {
      const label =
        typeof convAdj === 'object' && convAdj !== null && 'virtualAccountName' in convAdj
          ? (convAdj as ConvergenceAdjustment).virtualAccountName
          : 'Ajustes de Convergencia / Resultados Acumulados';
      const r = ws.getRow(row);
      r.getCell(1).value = '3710ZZ';
      r.getCell(1).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted }, italic: true };
      r.getCell(2).value = label;
      r.getCell(2).font = { name: FONT_MAIN, size: 9, italic: true };
      // Convergence row preserves sign (can be negative) — NO Math.abs
      if (isMultiPeriod) {
        r.getCell(3).value = 0;
        r.getCell(3).numFmt = NUM_FMT_COP;
        r.getCell(4).value = convAdjAmount;
        r.getCell(4).numFmt = NUM_FMT_COP;
        r.getCell(4).font = { name: FONT_MAIN, size: 9, italic: true };
      } else {
        r.getCell(3).value = convAdjAmount;
        r.getCell(3).numFmt = NUM_FMT_COP;
        r.getCell(3).font = { name: FONT_MAIN, size: 9, italic: true };
      }
      for (let i = 1; i <= (isMultiPeriod ? 6 : 4); i++) {
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.orange } };
      }
      row++;
    }

    // El patrimonio conserva su signo. Un patrimonio NEGATIVO es una causal de
    // disolución (Art. 457 num. 2 C.Co.) y una bandera de empresa en marcha
    // (NIA 570): imprimirlo en valor absoluto lo convertía en su contrario
    // justo en el renglón que el socio mira primero.
    // Auditoría 2026-08 — mismo defecto que en `agents/renderer.ts`.
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL PATRIMONIO',
      primary.summary.totalEquity,
      comparative?.summary.totalEquity,
      isMultiPeriod,
    );
    row++;

    // Nota informativa de Cierre Virtual (R8) — siempre que aplique.
    const vca = primary.virtualCloseAdjustment;
    if (vca) {
      const noteRow = ws.getRow(row);
      noteRow.getCell(2).value =
        `R8 Cierre Virtual: utilidad transitoria de ${fmtCopPesos(vca.dynamicNetIncome)} ` +
        `trasladada a Patrimonio (cuenta virtual ${vca.virtualCurrentCode})` +
        (vca.reclassifiedFrom3605
          ? ` · saldo histórico 3605 (${fmtCopPesos(vca.csvUtilidadEjercicio)}) reclasificado a ${vca.virtualRetainedCode}`
          : '') +
        (vca.centsAdjustment !== 0 && !vca.reclassifiedFrom3605
          ? ` · ajuste de centavos ${fmtCopPesos(vca.centsAdjustment)} en ${vca.virtualRetainedCode}`
          : '') +
        '.';
      noteRow.getCell(2).font = {
        name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.textMuted },
      };
      for (let i = 1; i <= (isMultiPeriod ? 6 : 4); i++) {
        noteRow.getCell(i).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray },
        };
      }
      row++;
    }

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
    verRow.getCell(3).value = primary.summary.equationBalanced ? 'CUADRA' : `DIFERENCIA: ${fmtCopPesos(diff)}`;
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
      verRow2.getCell(3).value = comparative.summary.equationBalanced ? 'CUADRA' : `DIFERENCIA: ${fmtCopPesos(diff2)}`;
      verRow2.getCell(2).font = { name: FONT_MAIN, bold: true, size: 10 };
      verRow2.getCell(3).font = {
        name: FONT_MAIN, bold: true, size: 10,
        color: { argb: comparative.summary.equationBalanced ? COLORS.green : COLORS.red },
      };
    }
  } else {
    // Último fallback: markdown crudo (compat con reportes pre-Fase-2).
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
  ws.getColumn(7).width = 50; // Notas de Reclasificación (col 7, solo si hay reclasificaciones)
}

// ---------------------------------------------------------------------------
// Render desde el JSON-strict validado del NIIF Analyst (fuente canónica)
// ---------------------------------------------------------------------------
// Estas funciones son el equivalente Excel de `compose-statements-from-json.ts`
// (PDF Élite): misma entrada, mismas líneas, mismos totales. Es lo que hace que
// las tres superficies —HTML, PDF y .xlsx— emitan la misma cifra para el mismo
// concepto.
//
// Layout de columnas idéntico al de la rama del preprocesado:
//   col 1: Código PUC | col 2: Concepto | col 3: comparativo | col 4: primario
//   col 5: Variación $ | col 6: Variación %
// En periodo único sólo se usa col 3 para el saldo primario.

/** Escribe una línea de estado financiero proveniente del JSON validado. */
function addJsonStatementRow(
  ws: ExcelJS.Worksheet,
  row: number,
  account: string | null,
  label: string,
  amountPrimary: string,
  amountComparative: string | null,
  hasComparative: boolean,
  emphasis: 'plain' | 'subtotal' | 'total',
): number {
  const r = ws.getRow(row);
  const bold = emphasis !== 'plain';
  const size = emphasis === 'total' ? 10 : 9;

  r.getCell(1).value = account ?? '';
  r.getCell(1).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  r.getCell(2).value = label;
  r.getCell(2).font = {
    name: FONT_MAIN, size, bold,
    color: { argb: emphasis === 'total' ? COLORS.darkNavy : COLORS.textDark },
  };

  const primary = centsToPesos(amountPrimary);
  // `n/c` (no comparativo) hace visible el hueco cuando el informe DECLARA
  // comparativo pero la línea no lo trae — misma convención que el PDF.
  const comparative = amountComparative !== null ? centsToPesos(amountComparative) : null;

  if (hasComparative) {
    r.getCell(3).value = comparative ?? 'n/c';
    if (comparative !== null) r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(3).font = { name: FONT_MAIN, size, bold, color: { argb: COLORS.textMuted } };
    r.getCell(4).value = primary;
    r.getCell(4).numFmt = NUM_FMT_COP;
    r.getCell(4).font = { name: FONT_MAIN, size, bold };
    if (comparative !== null) {
      const delta = primary - comparative;
      r.getCell(5).value = delta;
      r.getCell(5).numFmt = NUM_FMT_COP;
      r.getCell(5).font = {
        name: FONT_MAIN, size, bold,
        color: { argb: delta >= 0 ? COLORS.green : COLORS.red },
      };
      r.getCell(6).value = comparative !== 0 ? delta / Math.abs(comparative) : 0;
      r.getCell(6).numFmt = NUM_FMT_PCT;
      r.getCell(6).font = {
        name: FONT_MAIN, size, bold,
        color: { argb: delta >= 0 ? COLORS.green : COLORS.red },
      };
    }
  } else {
    r.getCell(3).value = primary;
    r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(3).font = { name: FONT_MAIN, size, bold };
  }

  if (emphasis === 'total') {
    const lastCol = hasComparative ? 6 : 3;
    for (let i = 2; i <= lastCol; i++) {
      r.getCell(i).border = { top: { style: 'thin', color: { argb: COLORS.darkNavy } } };
    }
  }
  return row + 1;
}

/** `level` del contrato: 0=sección 1=subgrupo 2=detalle 3=subtotal 4=total. */
function emphasisForLevel(level: number): 'plain' | 'subtotal' | 'total' {
  if (level === 4) return 'total';
  if (level === 3) return 'subtotal';
  return 'plain';
}

function addJsonLines(
  ws: ExcelJS.Worksheet,
  startRow: number,
  lines: StatementLineJson[],
  hasComparative: boolean,
): number {
  let row = startRow;
  for (const line of lines) {
    row = addJsonStatementRow(
      ws, row, line.account, line.label,
      line.amountPrimary, line.amountComparative,
      hasComparative, emphasisForLevel(line.level),
    );
  }
  return row;
}

function addBalanceSheetFromJson(
  ws: ExcelJS.Worksheet,
  startRow: number,
  json: NiifReportJson,
): number {
  const b = json.balanceSheet;
  const hasComparative = json.company.comparativePeriod !== null;
  let row = startRow;

  row = addStatementColumnHeader(
    ws, row, json.company.fiscalPeriod, json.company.comparativePeriod,
  );

  row = addSectionHeader(ws, row, 'ACTIVO', hasComparative);
  row = addJsonLines(ws, row, b.assets, hasComparative);
  row = addJsonStatementRow(
    ws, row, null, 'TOTAL ACTIVO',
    b.totalAssetsPrimary, b.totalAssetsComparative, hasComparative, 'total',
  );
  row++;

  row = addSectionHeader(ws, row, 'PASIVO', hasComparative);
  row = addJsonLines(ws, row, b.liabilities, hasComparative);
  row = addJsonStatementRow(
    ws, row, null, 'TOTAL PASIVO',
    b.totalLiabilitiesPrimary, b.totalLiabilitiesComparative, hasComparative, 'total',
  );
  row++;

  row = addSectionHeader(ws, row, 'PATRIMONIO', hasComparative);
  row = addJsonLines(ws, row, b.equity, hasComparative);
  row = addJsonStatementRow(
    ws, row, null, 'TOTAL PATRIMONIO',
    b.totalEquityPrimary, b.totalEquityComparative, hasComparative, 'total',
  );
  row++;

  // Cierre A = P + C, con la diferencia FIRMADA para que un descuadre sea
  // visible en la celda en vez de quedar implícito. Aritmética en centavos
  // (BigInt) — sin float — igual que el trailer del PDF.
  const sumPrimary = (
    parseMoneyCop(b.totalLiabilitiesPrimary) + parseMoneyCop(b.totalEquityPrimary)
  ).toString(10);
  const sumComparative =
    b.totalLiabilitiesComparative !== null && b.totalEquityComparative !== null
      ? (
          parseMoneyCop(b.totalLiabilitiesComparative) +
          parseMoneyCop(b.totalEquityComparative)
        ).toString(10)
      : null;
  row = addJsonStatementRow(
    ws, row, null, 'TOTAL PASIVO + PATRIMONIO',
    sumPrimary, sumComparative, hasComparative, 'total',
  );

  const diffPrimary = parseMoneyCop(b.totalAssetsPrimary) - parseMoneyCop(sumPrimary);
  const diffComparative =
    b.totalAssetsComparative !== null && sumComparative !== null
      ? (parseMoneyCop(b.totalAssetsComparative) - parseMoneyCop(sumComparative)).toString(10)
      : null;
  row = addJsonStatementRow(
    ws, row, null, 'DIFERENCIA (debe ser $0,00)',
    diffPrimary.toString(10), diffComparative, hasComparative, 'subtotal',
  );
  const verRow = ws.getRow(row - 1);
  verRow.getCell(2).font = {
    name: FONT_MAIN, size: 9, bold: true,
    color: { argb: diffPrimary === BigInt(0) ? COLORS.green : COLORS.red },
  };

  if (b.modeBanner) {
    row++;
    const banner = ws.getRow(row);
    banner.getCell(2).value = b.modeBanner;
    banner.getCell(2).font = {
      name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.textMuted },
    };
    row++;
  }
  return row;
}

function addIncomeStatementFromJson(
  ws: ExcelJS.Worksheet,
  startRow: number,
  json: NiifReportJson,
): number {
  const p = json.incomeStatement;
  const hasComparative = json.company.comparativePeriod !== null;
  let row = startRow;

  row = addStatementColumnHeader(
    ws, row, json.company.fiscalPeriod, json.company.comparativePeriod,
  );
  row = addJsonLines(ws, row, p.lines, hasComparative);

  // Totales vinculantes del contrato. Se anexan sólo si el analista no los
  // emitió ya como línea — misma regla que `niifJsonToIncomeTable` en el PDF,
  // para que ambos entregables listen exactamente las mismas filas.
  const emitted = new Set(p.lines.map((l) => l.label.trim().toUpperCase()));
  const pushTotal = (label: string, primary: string, comp: string | null) => {
    if (emitted.has(label.toUpperCase())) return;
    row = addJsonStatementRow(ws, row, null, label, primary, comp, hasComparative, 'total');
  };
  pushTotal('UTILIDAD BRUTA', p.grossProfitPrimary, p.grossProfitComparative);
  pushTotal('UTILIDAD OPERATIVA (EBIT)', p.operatingProfitPrimary, p.operatingProfitComparative);
  pushTotal('UTILIDAD NETA DEL PERÍODO', p.netIncomePrimary, p.netIncomeComparative);

  if (p.modeBanner) {
    row++;
    const banner = ws.getRow(row);
    banner.getCell(2).value = p.modeBanner;
    banner.getCell(2).font = {
      name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.textMuted },
    };
    row++;
  }
  return row;
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

  const json = report.niifAnalysis.json;

  // Banner de Advertencia R7 (costo presunto) — vive en el preprocesado y es
  // independiente de la fuente de las cifras, así que se pinta en ambas ramas.
  if (layout?.primary.presumedCostWarning) {
    const warn = layout.primary.presumedCostWarning;
    const bannerTitle = ws.getRow(row);
    bannerTitle.getCell(1).value = `⚠ ${warn.calloutTitle}`;
    bannerTitle.getCell(1).font = { name: FONT_MAIN, bold: true, size: 11, color: { argb: COLORS.darkNavy } };
    for (let i = 1; i <= 6; i++) {
      bannerTitle.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.orange } };
    }
    ws.mergeCells(`A${row}:F${row}`);
    row++;

    const bannerBody = ws.getRow(row);
    bannerBody.getCell(1).value = warn.calloutBody;
    bannerBody.getCell(1).font = { name: FONT_MAIN, size: 9, italic: true };
    for (let i = 1; i <= 6; i++) {
      bannerBody.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    }
    ws.mergeCells(`A${row}:F${row}`);
    row += 2;
  }

  if (json) {
    // Misma fuente canónica que el Balance y que PDF/HTML: el P&L validado del
    // NIIF Analyst. Recalcular la UTILIDAD BRUTA localmente
    // (`totalRevenue − totalCosts`) omitía el costo de producción (clase 7) y
    // las devoluciones en ventas (4175), de modo que el .xlsx podía imprimir
    // una utilidad bruta distinta de la del HTML para el mismo informe.
    row = addIncomeStatementFromJson(ws, row, json);
  } else if (layout) {
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

    // UTILIDAD BRUTA — ingresos menos costo de ventas (clase 6) Y costo de
    // producción (clase 7). Omitir la clase 7 sobreestimaba la utilidad bruta
    // de cualquier empresa manufacturera respecto del HTML/PDF.
    const grossOf = (s: PeriodView['summary']) =>
      s.totalRevenue - s.totalCosts - s.totalProduction;
    row = addStatementTotalRow(
      ws,
      row,
      'UTILIDAD BRUTA',
      grossOf(primary.summary),
      comparative ? grossOf(comparative.summary) : undefined,
      isMultiPeriod,
    );
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

/**
 * Ratio de un periodo, con la MISMA precedencia que usan el PDF y el HTML:
 * primero el campo pre-calculado de `controlTotals` (Wave 2.F4, fuente única),
 * y sólo si viene null/ausente —balances cacheados pre-F4— el cálculo local.
 *
 * `controlTotals` guarda los porcentajes en escala 0-100; las celdas de Excel
 * llevan `NUM_FMT_PCT`, que espera una fracción, de ahí el /100.
 */
function ratioFromControlTotals(
  view: PeriodView | null,
  pick: (ct: ControlTotals) => number | null | undefined,
  fallback: () => number,
  isPercentScale: boolean,
): number {
  const ct = view?.controlTotals;
  const pre = ct ? pick(ct) : null;
  if (typeof pre === 'number' && Number.isFinite(pre)) {
    return isPercentScale ? pre / 100 : pre;
  }
  return fallback();
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

  const margenNetoP = ratioFromControlTotals(
    primary, (ct) => ct.margenNeto,
    () => (p.totalRevenue !== 0 ? p.netIncome / p.totalRevenue : 0), true,
  );
  const margenNetoC = ratioFromControlTotals(
    comparative, (ct) => ct.margenNeto,
    () => (c.totalRevenue !== 0 ? c.netIncome / c.totalRevenue : 0), true,
  );

  const endeudamientoP = ratioFromControlTotals(
    primary, (ct) => ct.endeudamientoTotal,
    () => (p.totalAssets !== 0 ? p.totalLiabilities / p.totalAssets : 0), true,
  );
  const endeudamientoC = ratioFromControlTotals(
    comparative, (ct) => ct.endeudamientoTotal,
    () => (c.totalAssets !== 0 ? c.totalLiabilities / c.totalAssets : 0), true,
  );

  const roaP = ratioFromControlTotals(
    primary, (ct) => ct.roa,
    () => (p.totalAssets !== 0 ? p.netIncome / p.totalAssets : 0), true,
  );
  const roaC = ratioFromControlTotals(
    comparative, (ct) => ct.roa,
    () => (c.totalAssets !== 0 ? c.netIncome / c.totalAssets : 0), true,
  );

  // ROE: `controlTotals.roe` usa patrimonio PROMEDIO. Recalcularlo aquí sobre
  // el patrimonio de cierre imprimía en el .xlsx un ROE distinto al del HTML y
  // al del PDF para el mismo informe.
  const roeP = ratioFromControlTotals(
    primary, (ct) => ct.roe,
    () => (p.totalEquity !== 0 ? p.netIncome / p.totalEquity : 0), true,
  );
  const roeC = ratioFromControlTotals(
    comparative, (ct) => ct.roe,
    () => (c.totalEquity !== 0 ? c.netIncome / c.totalEquity : 0), true,
  );

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
  showReclassNotes = false,
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
  const lastDataCol = comparativePeriod ? 6 : 3;
  for (let i = 1; i <= lastDataCol; i++) {
    r.getCell(i).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    r.getCell(i).alignment = { horizontal: 'center' };
  }
  if (showReclassNotes) {
    r.getCell(7).value = 'Notas de Reclasificación';
    r.getCell(7).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.white } };
    r.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.orange } };
    r.getCell(7).alignment = { horizontal: 'center' };
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
 *
 * Todos los saldos se escriben FIRMADOS. La opción `absValues` que aplicaba
 * Math.abs a las clases 2 y 3 se eliminó: convertía saldos contrarios (pérdidas
 * acumuladas, pasivos sobrepagados) en su opuesto y hacía que las líneas no
 * sumaran el total firmado. La convención NIIF de negativos entre paréntesis la
 * aporta ahora `NUM_FMT_COP`.
 *
 * @param opts.reclassifications — lista de reclasificaciones para mostrar notas en col 7.
 */
function addClassRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  primary: PeriodView,
  comparative: PeriodView | null,
  classCode: number,
  opts: { reclassifications?: Reclassification[] } = {},
): number {
  let row = startRow;
  const { reclassifications } = opts;
  const primaryCl = findClass(primary.classes, classCode);
  const comparativeCl = comparative ? findClass(comparative.classes, classCode) : undefined;

  // Build a footnote map: accountCode → balanceFootnoteText
  const footnoteMap = new Map<string, string>();
  if (reclassifications) {
    for (const r of reclassifications) {
      if (r.balanceFootnoteText) {
        footnoteMap.set(r.accountCode, r.balanceFootnoteText);
      }
    }
  }

  if (comparative) {
    const merged = unionAccounts(primaryCl, comparativeCl);
    for (const meta of merged) {
      const currBal = primaryCl ? findAccountBalance([primaryCl], meta.code) ?? 0 : 0;
      const prevBal = comparativeCl ? findAccountBalance([comparativeCl], meta.code) ?? 0 : 0;
      row = addAccountRowMulti(ws, row, meta.code, meta.name, prevBal, currBal, footnoteMap.get(meta.code));
    }
  } else if (primaryCl) {
    for (const acc of primaryCl.accounts) {
      row = addAccountRowSingle(ws, row, acc.code, acc.name, acc.balance, undefined, footnoteMap.get(acc.code));
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
  footnote?: string,
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
  if (footnote) {
    r.getCell(7).value = footnote;
    r.getCell(7).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
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
 *   Codigo | Cuenta | Saldo {prev} | Saldo {curr} | Variacion $ | Variacion % | Nota Reclasificación?
 */
function addAccountRowMulti(
  ws: ExcelJS.Worksheet,
  row: number,
  code: string,
  name: string,
  prevBalance: number,
  currBalance: number,
  footnote?: string,
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
  if (footnote) {
    r.getCell(7).value = footnote;
    r.getCell(7).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
  }

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

// ---------------------------------------------------------------------------
// Tab 6: Ajustes Pulido Diamante
// ---------------------------------------------------------------------------

/**
 * Hoja de resumen de las 4 mutaciones que el Curator Pulido Diamante aplicó
 * al snapshot. Solo se genera cuando al menos una mutación está presente.
 *
 * Secciones:
 *   R1 — Reclasificaciones de saldos negativos en activos
 *   R5 — Convergencia patrimonial (Balance ↔ ECP)
 *   R6 — Cierre del Flujo de Efectivo (EFE ↔ PUC 11)
 *   R7 — Advertencia de costo presunto (no muta cifras)
 */
function addPulidoDiamanteSheet(wb: ExcelJS.Workbook, layout: PeriodLayout): void {
  const ws = wb.addWorksheet('Pulido Diamante', {
    properties: { tabColor: { argb: COLORS.orange } },
  });
  ws.properties.defaultColWidth = 22;

  // ── Sheet header ──────────────────────────────────────────────────────────
  const h1 = ws.getRow(1);
  h1.getCell(1).value = 'AJUSTES PULIDO DIAMANTE — CURATOR NIIF';
  h1.getCell(1).font = { name: FONT_MAIN, bold: true, size: 14, color: { argb: COLORS.orange } };
  ws.mergeCells('A1:F1');

  const h2 = ws.getRow(2);
  h2.getCell(1).value =
    'Mutaciones determinísticas aplicadas por el Curator antes del pipeline financiero.';
  h2.getCell(1).font = { name: FONT_MAIN, size: 10, italic: true, color: { argb: COLORS.textMuted } };
  ws.mergeCells('A2:F2');

  let row = 4;

  const p = layout.primary;

  // ── Helper: sección header ─────────────────────────────────────────────
  const addPDSectionHeader = (title: string): void => {
    const r = ws.getRow(row);
    r.getCell(1).value = title;
    r.getCell(1).font = { name: FONT_MAIN, bold: true, size: 11, color: { argb: COLORS.white } };
    for (let i = 1; i <= 6; i++) {
      r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkNavy } };
    }
    ws.mergeCells(`A${row}:F${row}`);
    row++;
  };

  const addPDTableHeader = (cols: string[]): void => {
    const r = ws.getRow(row);
    cols.forEach((h, i) => {
      r.getCell(i + 1).value = h;
      r.getCell(i + 1).font = { name: FONT_MAIN, bold: true, size: 9, color: { argb: COLORS.darkNavy } };
      r.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
      r.getCell(i + 1).alignment = { horizontal: 'center' };
    });
    row++;
  };

  const addPDLabelValue = (label: string, value: string | number, isMoney = false): void => {
    const r = ws.getRow(row);
    r.getCell(1).value = label;
    r.getCell(1).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
    r.getCell(2).value = value;
    if (isMoney && typeof value === 'number') {
      r.getCell(2).numFmt = NUM_FMT_COP;
    }
    r.getCell(2).font = { name: FONT_MAIN, size: 9 };
    row++;
  };

  // ── Sección 1: R1 — Reclasificaciones ─────────────────────────────────
  const reclassList = p.reclassifications ?? [];
  if (reclassList.length > 0) {
    addPDSectionHeader('R1 — Reclasificaciones de Saldos Negativos en Activos (NIC 1 párr. 32)');
    addPDTableHeader([
      'Cuenta original (código)',
      'Nombre cuenta original',
      'Monto reclasificado ($)',
      'Cuenta destino',
      'Nombre destino',
      'Justificación',
    ]);

    for (const r1 of reclassList) {
      const r = ws.getRow(row);
      r.getCell(1).value = r1.accountCode;
      r.getCell(2).value = r1.accountName;
      r.getCell(3).value = r1.amountCop;
      r.getCell(3).numFmt = NUM_FMT_COP;
      r.getCell(4).value = r1.reclassifiedToCode;
      r.getCell(5).value = r1.reclassifiedToName;
      r.getCell(6).value = r1.justification;
      r.getCell(6).alignment = { wrapText: true };
      if (row % 2 === 0) {
        for (let i = 1; i <= 6; i++) {
          r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
        }
      }
      row++;
    }
    row++;
  }

  // ── Sección 2: R5 — Convergencia Patrimonial ──────────────────────────
  const convAdj = p.curatorConvergenceAdjustment;
  const convAdjNum = p.equityBreakdown?.convergenceAdjustment;
  if (convAdj || (convAdjNum !== undefined && convAdjNum !== 0)) {
    addPDSectionHeader('R5 — Convergencia Patrimonial (Balance ↔ ECP)');
    if (convAdj) {
      addPDLabelValue('Total Patrimonio Balance original ($)', convAdj.balanceEquity, true);
      addPDLabelValue('Saldo Final ECP antes del ajuste ($)', convAdj.ecpClosingBalance, true);
      addPDLabelValue('Brecha absorbida ($)', convAdj.gapCop, true);
      addPDLabelValue('Total Patrimonio reconciliado ($)', convAdj.reconciledEquity, true);
      addPDLabelValue('Cuenta virtual', `${convAdj.virtualAccountCode} — ${convAdj.virtualAccountName}`);
      addPDLabelValue('Línea insertada en ECP', convAdj.ledgerLineLabel);
      addPDLabelValue('Justificación', convAdj.justification);
    } else {
      addPDLabelValue('Gap absorbido ($)', convAdjNum ?? 0, true);
    }
    row++;
  }

  // ── Sección 3: R6 — Cierre EFE ────────────────────────────────────────
  const efeAdj = p.curatorCashFlowClosure;
  const efeAdjNum = p.cashFlowClosureAdjustment;
  if (efeAdj || (efeAdjNum !== undefined && efeAdjNum !== 0)) {
    addPDSectionHeader('R6 — Cierre del Flujo de Efectivo (EFE ↔ Caja PUC 11)');
    if (efeAdj) {
      addPDLabelValue('Δ EFE antes del ajuste ($)', efeAdj.efeNetChangeBefore, true);
      addPDLabelValue('Δ Caja observado en Balance ($)', efeAdj.observedChangeInCash, true);
      addPDLabelValue('Brecha ($)', efeAdj.gapCop, true);
      addPDLabelValue('Línea de absorción', efeAdj.adjustmentLineLabel);
      addPDLabelValue('Caja final reconciliada ($)', efeAdj.reconciledClosingCash, true);
      addPDLabelValue('Caja inicial del periodo ($)', efeAdj.openingCash, true);
      addPDLabelValue('Justificación', efeAdj.justification);
    } else {
      addPDLabelValue('Gap absorbido ($)', efeAdjNum ?? 0, true);
    }
    row++;
  }

  // ── Sección 4: R7 — Advertencia Costo Presunto ────────────────────────
  const r7 = p.presumedCostWarning;
  if (r7) {
    addPDSectionHeader('R7 — Advertencia de Costo Presunto (no muta cifras)');
    addPDLabelValue('Margen bruto observado', `${(r7.observedGrossMargin * 100).toFixed(1)}%`);
    addPDLabelValue('Umbral configurado', `${(r7.thresholdGrossMargin * 100).toFixed(1)}%`);
    addPDLabelValue('COGS reportado ($)', r7.reportedCogsCop, true);
    addPDLabelValue('COGS presunto ($)', r7.presumedCogsCop, true);
    addPDLabelValue('Inventario al cierre ($)', r7.inventoryCop, true);
    addPDLabelValue('Título del callout', r7.calloutTitle);
    addPDLabelValue('Descripción', r7.calloutBody);
    row++;
  }

  // ── Column widths ──────────────────────────────────────────────────────
  ws.getColumn(1).width = 35;
  ws.getColumn(2).width = 35;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 35;
  ws.getColumn(6).width = 55;
}

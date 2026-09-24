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
//   Balance / P&L: Cuenta | Saldo {primary} | Saldo {comparative} | Variacion $ | Variacion %
//   (periodo actual primero, el mismo orden del PDF y del Markdown —
//   reportes-export-20; la variación va en color neutro: su signo no dice si
//   es buena o mala sin la naturaleza de la cuenta).
//   KPIs: bloque por periodo con columnas paralelas
//   Validacion: una seccion por periodo
//   Resumen: bloque comparativo si aplica
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { formatCopFromPesos, parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { StrategyReportSchema } from '@/lib/agents/financial/contracts/strategy-report';
import { applyKpiAnchors } from '@/lib/agents/financial/validators/strategy-anchors';
import { renderStrategyKpisMarkdown } from '@/lib/agents/financial/agents/strategy-director';
import type { StatementLineJson, StatementNoteJson } from '@/lib/agents/financial/contracts/base';
import {
  CURRENCY_NOTE,
  NARRATIVE_DISCLAIMER,
  cashFlowHasComparativeColumn,
  cashFlowMethodLabel,
  comparativeStatementLegend,
  narrativeDisclaimer,
  incomeStatementPresentationRows,
  normalizeNiifStatementLabels,
  presentedLineCents,
  resolvePeriodoTipos,
  statementDateLabel,
  type PeriodoTipo,
} from './statement-presentation';
import {
  formatStatementNote,
  openingBalancesPygLegend,
  OPENING_PYG_PLACEHOLDER,
} from './pdf-elite-react/compose-statements-from-json';
import { revenueBreakdown } from './revenue';
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
// Sin sección de cero "—": un 0 % real y un N/D se veían idénticos
// (reportes-export-12). N/D se escribe ahora como texto "N/D".
const NUM_FMT_PCT = '0.00%;-0.00%;0.00%';

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
  // Pesos → centavos exactos por el texto decimal (redondeo simétrico al
  // centavo y sin pasar por un `number` de centavos, que deja de ser exacto
  // por encima de 2^53 — niif-contrato-22). Mismo helper que el PDF.
  return formatCopFromPesos(pesos, false);
}

// ---------------------------------------------------------------------------
// Multiperiodo helpers
// ---------------------------------------------------------------------------

interface PeriodView {
  period: string;
  /** Año completo / corte parcial inferido del archivo (fecha de corte). */
  periodoTipo?: PeriodoTipo;
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
  /**
   * ingesta-09: el periodo proviene de una columna de saldo inicial/anterior
   * (`PeriodSnapshot.saldosDeApertura`). Su ESF es el de apertura; su P&G no
   * es un P&G comparativo: se presenta N/D y sin variaciones de resultados.
   */
  saldosDeApertura?: boolean;
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
/**
 * Resumen del periodo POSTERIOR al curator (normativa-metricas NM-04).
 *
 * `snapshot.summary` se calcula antes del curator: R1 reclasifica un activo
 * negativo (sobregiro) al pasivo y R8 cierra el resultado en el patrimonio,
 * pero el resumen conservaba los totales previos. El .xlsx imprimía entonces
 * Total Activo 1.150 M en KPIs y Resumen (y como total de la hoja Balance sin
 * JSON) frente a 1.180 M en el balance, el PDF y las anclas, con un
 * endeudamiento calculado sobre la otra base. Los totales del balance, la
 * utilidad neta y la ecuación salen de `controlTotals` —la base de las anclas y
 * de los ratios—; el resto del resumen (ingresos, gastos, costos) no lo altera
 * el curator.
 */
function postCuratorSummary(p: PreprocessedBalance['primary']): PeriodView['summary'] {
  const ct = p.controlTotals;
  if (!ct) return p.summary;
  const cents = (ct as { cents?: { activo?: bigint; pasivo?: bigint; patrimonio?: bigint } }).cents;
  const diffCents =
    typeof cents?.activo === 'bigint' && typeof cents.pasivo === 'bigint' && typeof cents.patrimonio === 'bigint'
      ? cents.activo - cents.pasivo - cents.patrimonio
      : BigInt(Math.round((ct.activo - ct.pasivo - ct.patrimonio) * 100));
  return {
    ...p.summary,
    totalAssets: ct.activo,
    totalLiabilities: ct.pasivo,
    totalEquity: ct.patrimonio,
    netIncome: ct.utilidadNeta,
    equationBalance: Number(diffCents) / 100,
    equationBalanced: diffCents === BigInt(0),
  };
}

function buildPeriodLayout(prep: PreprocessedBalance): PeriodLayout {
  const all: PeriodView[] = prep.periods.map((p) => ({
    period: p.period,
    periodoTipo: p.periodoTipo,
    classes: p.classes,
    summary: postCuratorSummary(p),
    discrepancies: p.discrepancies,
    missingExpectedAccounts: p.missingExpectedAccounts,
    controlTotals: p.controlTotals,
    saldosDeApertura: p.saldosDeApertura === true,
  }));

  const primary: PeriodLayout['primary'] = {
    period: prep.primary.period,
    periodoTipo: prep.primary.periodoTipo,
    classes: prep.primary.classes,
    summary: postCuratorSummary(prep.primary),
    discrepancies: prep.primary.discrepancies,
    missingExpectedAccounts: prep.primary.missingExpectedAccounts,
    controlTotals: prep.primary.controlTotals,
    saldosDeApertura: prep.primary.saldosDeApertura === true,
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
        periodoTipo: prep.comparative.periodoTipo,
        classes: prep.comparative.classes,
        summary: postCuratorSummary(prep.comparative),
        discrepancies: prep.comparative.discrepancies,
        missingExpectedAccounts: prep.comparative.missingExpectedAccounts,
        controlTotals: prep.comparative.controlTotals,
        saldosDeApertura: prep.comparative.saldosDeApertura === true,
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
  const language = options.language ?? 'es';
  const wb = new ExcelJS.Workbook();

  wb.creator = '1+1 Financial Orchestrator';
  wb.created = new Date();
  wb.modified = new Date();

  const layout = preprocessed ? buildPeriodLayout(preprocessed) : null;

  // Tab 1: Balance / Estado de Situacion Financiera
  addBalanceSheet(wb, report, layout, language);

  // Tab 2: P&L / Estado de Resultados
  addIncomeStatement(wb, report, layout, language);

  // Complete the four structured statements from the same validated JSON.
  if (report.niifAnalysis.json) {
    addCashFlowAndEquitySheets(wb, report, layout, language);
    addTechnicalNotesSheet(wb, report, language);
  }

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

function addCashFlowAndEquitySheets(
  wb: ExcelJS.Workbook,
  report: FinancialReport,
  layout: PeriodLayout | null,
  language: 'es' | 'en' = 'es',
): void {
  const json = presentableJson(report, layout)!;
  const fp = json.company.fiscalPeriod;
  const cp = json.company.comparativePeriod;
  // Columna comparativa del EFE y ECP del periodo comparativo (auditoría
  // 2026-09-24, pendiente #3): los calcula el código desde el corte anterior
  // al comparativo. Sin ellos, la nota determinista de impracticabilidad
  // (NIIF para las PYMES 3.14 / 10.21) se declara en el propio estado
  // (reportes-export-13). Orden de columnas: periodo actual | comparativo,
  // igual que el PDF.
  const cf = json.cashFlow;
  const cfComparative = cp !== null && cashFlowHasComparativeColumn(cf);
  const comparativeRows = cp !== null ? (json.equityChanges.comparativeRows ?? []) : [];
  const ecComparative = comparativeRows.length > 0;
  const periodLine = (shown: boolean) =>
    `${statementDate('period', report, layout, shown)} · ${CURRENCY_NOTE}`;
  const legendFont = { name: FONT_MAIN, size: 9, italic: true, color: { argb: COLORS.orange } };

  const cash = wb.addWorksheet('Flujos de Efectivo');
  cash.columns = [{ width: 58 }, { width: 24 }, ...(cfComparative ? [{ width: 24 }] : [])];
  cash.addRow(['ESTADO DE FLUJOS DE EFECTIVO', fp, ...(cfComparative ? [cp] : [])]);
  cash.addRow([json.company.name, 'COP', ...(cfComparative ? ['COP'] : [])]);
  cash.addRow([periodLine(cfComparative)]).font = { name: FONT_MAIN, size: 9, italic: true };
  const cashLegend = comparativeStatementLegend('cashFlow', json);
  if (cashLegend) cash.addRow([cashLegend]).font = legendFont;
  const lastCashCol = cfComparative ? 3 : 2;
  const addCash = (label: string, cents: string, comparative: string | null | undefined, bold = false) => {
    const values: Array<string | number> = [label, centsToPesos(cents)];
    if (cfComparative) values.push(comparative !== null && comparative !== undefined ? centsToPesos(comparative) : 'n/c');
    const row = cash.addRow(values);
    row.font = { name: FONT_MAIN, bold };
    for (let col = 2; col <= lastCashCol; col++) {
      if (typeof row.getCell(col).value === 'number') row.getCell(col).numFmt = NUM_FMT_COP;
    }
  };
  addCash('Efectivo al inicio', cf.cashOpening, cf.cashOpeningComparative, true);
  const sectionNames = { operating: 'Operación', investing: 'Inversión', financing: 'Financiación' };
  for (const section of cf.sections) {
    cash.addRow([sectionNames[section.section]]).font = { name: FONT_MAIN, bold: true };
    for (const line of section.lines) addCash(line.label, line.amountPrimary, line.amountComparative);
    addCash(`Flujo neto de ${sectionNames[section.section]}`, section.netFlow, section.netFlowComparative, true);
  }
  addCash('Variación neta del efectivo', cf.netChange, cf.netChangeComparative, true);
  addCash('Efectivo al cierre', cf.cashClosing, cf.cashClosingComparative, true);
  cash.addRow([cashFlowMethodLabel(cf.methodNote, cf.degeneracyFlag, language)]).font = {
    name: FONT_MAIN, size: 9, italic: true,
  };

  const equity = wb.addWorksheet('Cambios en Patrimonio');
  equity.columns = [{ width: 46 }, ...Array.from({ length: 8 }, () => ({ width: 23 }))];
  equity.addRow(['ESTADO DE CAMBIOS EN EL PATRIMONIO', fp, ...(ecComparative ? [cp] : [])]);
  equity.addRow([json.company.name, 'COP']);
  equity.addRow([periodLine(ecComparative)]).font = { name: FONT_MAIN, size: 9, italic: true };
  const equityLegend = comparativeStatementLegend('equity', json);
  if (equityLegend) equity.addRow([equityLegend]).font = legendFont;
  equity.addRow(['Movimiento', 'Capital social', 'Prima colocación', 'Reserva legal',
    'Otras reservas', 'Resultados acumulados', 'Resultado ejercicio', 'ORI', 'Total'])
    .font = { name: FONT_MAIN, bold: true };
  const keys = ['capitalSocial', 'primaColocacion', 'reservaLegal', 'otrasReservas',
    'resultadosAcumulados', 'resultadoEjercicio', 'ori', 'total'] as const;
  const addMovements = (rows: NiifReportJson['equityChanges']['rows']) => {
    for (const movement of rows) {
      const row = equity.addRow([movement.label, ...keys.map(key => centsToPesos(movement[key]))]);
      row.font = { name: FONT_MAIN, bold: ['opening_balance', 'closing_balance'].includes(movement.kind) };
      for (let col = 2; col <= 9; col++) row.getCell(col).numFmt = NUM_FMT_COP;
    }
  };
  if (ecComparative) {
    // Los dos periodos apilados en orden cronológico (NIIF para las PYMES 6.3):
    // el cierre del comparativo es la apertura del periodo actual.
    equity.addRow([`Periodo ${cp}`]).font = { name: FONT_MAIN, bold: true, color: { argb: COLORS.darkNavy } };
    addMovements(comparativeRows);
    equity.addRow([`Periodo ${fp}`]).font = { name: FONT_MAIN, bold: true, color: { argb: COLORS.darkNavy } };
  }
  addMovements(json.equityChanges.rows);
  // e2e-niif-10: las notas en prosa del ECP las redacta el LLM y sus cifras no
  // se anclan; se rotulan como narrativa no auditada (mismo aviso del PDF).
  const equityNotes = json.equityChanges.notes.map(formatStatementNote).filter(Boolean);
  if (equityNotes.length > 0) {
    equity.addRow([narrativeDisclaimer(language)]).font = {
      name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange },
    };
  }
  for (const n of equityNotes) {
    equity.addRow([n]).font = { name: FONT_MAIN, size: 8, italic: true };
  }
  for (const sheet of [cash, equity]) {
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
    sheet.pageSetup = { orientation: sheet === equity ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
}

/**
 * Notas técnicas globales del JSON validado (mapeo PUC, reclasificaciones,
 * impracticabilidades). Son parte del contrato NIIF y no se exportaban en
 * ningún formato (reportes-export-11). El JSON valida su forma, no sus cifras:
 * son prosa del Pass-3 y llevan el aviso de narrativa no auditada, igual que en
 * el PDF (e2e-niif-10).
 */
function addTechnicalNotesSheet(
  wb: ExcelJS.Workbook,
  report: FinancialReport,
  language: 'es' | 'en' = 'es',
): void {
  const notes = (report.niifAnalysis.json?.technicalNotes ?? [])
    .map(formatStatementNote)
    .filter((n) => n.length > 0);
  if (notes.length === 0) return;
  const ws = wb.addWorksheet('Notas Técnicas');
  ws.columns = [{ width: 120 }];
  ws.addRow(['NOTAS TÉCNICAS DE LOS ESTADOS FINANCIEROS']).font = { name: FONT_MAIN, bold: true, size: 12 };
  const id = reportIdentity(report);
  ws.addRow([`${id.name} | NIT: ${id.nit} | Periodo: ${id.fiscalPeriod}`]).font = { name: FONT_MAIN, size: 9 };
  ws.addRow([narrativeDisclaimer(language)]).font = {
    name: FONT_MAIN, size: 9, italic: true, color: { argb: COLORS.orange },
  };
  for (const n of notes) ws.addRow([n]).font = { name: FONT_MAIN, size: 9 };
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
  language: 'es' | 'en' = 'es',
): void {
  const ws = wb.addWorksheet('Balance NIIF', { properties: { tabColor: { argb: COLORS.gold } } });
  ws.properties.defaultColWidth = 18;

  // Header
  addSheetHeader(ws, 'ESTADO DE SITUACION FINANCIERA', report, statementDate('position', report, layout));

  let row = 6;

  const json = presentableJson(report, layout);

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
    row = addStatementNotes(ws, row, json.balanceSheet.notes, language);
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
        r.getCell(3).value = convAdjAmount;
        r.getCell(3).numFmt = NUM_FMT_COP;
        r.getCell(3).font = { name: FONT_MAIN, size: 9, italic: true };
        r.getCell(4).value = 0;
        r.getCell(4).numFmt = NUM_FMT_COP;
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
  /** Texto fijo de la columna comparativa (p. ej. N/D del P&G de apertura); sin variaciones. */
  comparativeText?: string,
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
  const comparative =
    comparativeText === undefined && amountComparative !== null ? centsToPesos(amountComparative) : null;

  if (hasComparative) {
    // Periodo actual | comparativo (reportes-export-20: mismo orden del PDF).
    r.getCell(3).value = primary;
    r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(3).font = { name: FONT_MAIN, size, bold };
    r.getCell(4).value = comparative ?? comparativeText ?? 'n/c';
    if (comparative !== null) r.getCell(4).numFmt = NUM_FMT_COP;
    r.getCell(4).font = { name: FONT_MAIN, size, bold, color: { argb: COLORS.textMuted } };
    if (comparative !== null) writeVariationCells(r, primary, comparative, { size, bold });
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

/**
 * Variación $ y % (cols 5 y 6) del periodo actual contra el comparativo.
 * Color NEUTRO (reportes-export-20): pintar en verde toda variación ≥ 0 dejaba
 * en verde un aumento de gastos o de pasivos; el signo sin la naturaleza de la
 * cuenta no dice si la variación es favorable. Los negativos van entre
 * paréntesis por el formato numérico.
 */
function writeVariationCells(
  r: ExcelJS.Row,
  current: number,
  previous: number,
  style: { size: number; bold: boolean },
): void {
  const delta = current - previous;
  const font = { name: FONT_MAIN, size: style.size, bold: style.bold, color: { argb: COLORS.textDark } };
  r.getCell(5).value = delta;
  r.getCell(5).numFmt = NUM_FMT_COP;
  r.getCell(5).font = font;
  r.getCell(6).value = previous !== 0 ? delta / Math.abs(previous) : 0;
  r.getCell(6).numFmt = NUM_FMT_PCT;
  r.getCell(6).font = font;
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
  comparativeText?: string,
): number {
  let row = startRow;
  // Correctoras (1592, 1399…) en magnitud absoluta se escriben NEGATIVAS: así
  // la columna suma el total impreso, igual que E15 y que el PDF
  // (reportes-export-17).
  const presented = (line: StatementLineJson, v: string): string =>
    presentedLineCents(line.account, parseMoneyCop(v), line.isAbsolute).toString(10);
  for (const line of lines) {
    row = addJsonStatementRow(
      ws, row, line.account, line.label,
      presented(line, line.amountPrimary),
      line.amountComparative !== null ? presented(line, line.amountComparative) : null,
      hasComparative, emphasisForLevel(line.level), comparativeText,
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
  comparativeIsOpening = false,
): number {
  const p = json.incomeStatement;
  const hasComparative = json.company.comparativePeriod !== null;
  // ingesta-09: comparativo de saldos de apertura → P&G comparativo N/D.
  const comparativeText = hasComparative && comparativeIsOpening ? OPENING_PYG_PLACEHOLDER : undefined;
  let row = startRow;

  row = addStatementColumnHeader(
    ws, row, json.company.fiscalPeriod, json.company.comparativePeriod,
  );

  // Regla única compartida con el PDF y el Markdown
  // (`incomeStatementPresentationRows`, auditoría 2026-09-24 e2e-niif-01): los
  // escalones de la cascada (UTILIDAD/PÉRDIDA bruta, operativa, antes de
  // impuestos y neta; ORI y resultado integral total) se imprimen SIEMPRE desde
  // los campos anclados del JSON; un renglón del analista no los sustituye.
  for (const r of incomeStatementPresentationRows(p)) {
    if (r.total) {
      row = addJsonStatementRow(
        ws, row, null, r.label, r.amountPrimary, r.amountComparative, hasComparative, 'total', comparativeText,
      );
    } else {
      row = addJsonLines(
        ws, row,
        [{
          account: r.account, label: r.label, amountPrimary: r.amountPrimary,
          amountComparative: r.amountComparative, level: r.level as StatementLineJson['level'],
          isAbsolute: r.isAbsolute,
        }],
        hasComparative, comparativeText,
      );
    }
  }

  if (comparativeText !== undefined) {
    row = addOpeningPygLegend(ws, row, json.company.comparativePeriod ?? '');
  }

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
  language: 'es' | 'en' = 'es',
): void {
  const ws = wb.addWorksheet('Estado Resultados', { properties: { tabColor: { argb: COLORS.darkNavy } } });
  ws.properties.defaultColWidth = 18;

  addSheetHeader(ws, 'ESTADO DE RESULTADOS INTEGRAL', report, statementDate('period', report, layout));

  let row = 6;

  const json = presentableJson(report, layout);

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
    const comparativePeriod = json.company.comparativePeriod;
    const comparativeIsOpening =
      comparativePeriod !== null &&
      layout?.comparative?.saldosDeApertura === true &&
      layout.comparative.period.includes(comparativePeriod);
    row = addIncomeStatementFromJson(ws, row, json, comparativeIsOpening);
    row = addStatementNotes(ws, row, json.incomeStatement.notes, language);
  } else if (layout) {
    const { primary, comparative, isMultiPeriod } = layout;

    row = addStatementColumnHeader(ws, row, primary.period, comparative?.period ?? null);

    // INGRESOS — detalle de la clase 4 tal cual la balanza, y debajo los
    // ingresos operacionales netos (41 − 4175) que sostienen la utilidad
    // bruta. La Σ de la clase 4 no es "total ingresos": mezcla devoluciones y
    // no operacionales (ratios-kpis-04). Grupo 42 va debajo del resultado
    // operacional (decisión de negocio del coordinador).
    const revP = revenueBreakdown(primary);
    const revC = comparative ? revenueBreakdown(comparative) : null;
    const nd = (v: number | null | undefined) => (v === null || v === undefined ? Number.NaN : v);
    // ingesta-09: comparativo de saldos de apertura → sin P&G del periodo
    // anterior; cuentas y totales del comparativo N/D, sin variaciones.
    const pygND = comparative?.saldosDeApertura === true;
    const cmp = (v: number | undefined): number | undefined =>
      v === undefined ? undefined : pygND ? Number.NaN : v;
    const classOpts = { comparativeNd: pygND };
    row = addSectionHeader(ws, row, 'INGRESOS (CLASE 4 — SALDOS DE LA BALANZA)', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 4, classOpts);
    row = addStatementTotalRow(
      ws,
      row,
      'INGRESOS OPERACIONALES NETOS (41 − 4175)',
      nd(revP.operacionalesNetos),
      cmp(revC ? nd(revC.operacionalesNetos) : undefined),
      isMultiPeriod,
    );
    row++;

    // COSTOS (Clase 6)
    row = addSectionHeader(ws, row, 'COSTO DE VENTAS', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 6, classOpts);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL COSTOS',
      primary.summary.totalCosts,
      cmp(comparative?.summary.totalCosts),
      isMultiPeriod,
    );
    row++;

    // UTILIDAD BRUTA — ingresos menos costo de ventas (clase 6) Y costo de
    // producción (clase 7). Omitir la clase 7 sobreestimaba la utilidad bruta
    // de cualquier empresa manufacturera respecto del HTML/PDF.
    const grossOf = (s: PeriodView['summary'], opNetos: number | null | undefined) =>
      opNetos === null || opNetos === undefined
        ? Number.NaN
        : opNetos - s.totalCosts - s.totalProduction;
    row = addStatementTotalRow(
      ws,
      row,
      'UTILIDAD BRUTA',
      grossOf(primary.summary, revP.operacionalesNetos),
      cmp(comparative ? grossOf(comparative.summary, revC?.operacionalesNetos) : undefined),
      isMultiPeriod,
    );
    row++;

    // Otros ingresos no operacionales (grupo 42 y demás de la clase 4).
    row = addStatementTotalRow(
      ws,
      row,
      'OTROS INGRESOS NO OPERACIONALES',
      nd(revP.noOperacionales),
      cmp(revC ? nd(revC.noOperacionales) : undefined),
      isMultiPeriod,
    );
    row++;

    // GASTOS
    row = addSectionHeader(ws, row, 'GASTOS OPERACIONALES', isMultiPeriod);
    row = addClassRows(ws, row, primary, comparative, 5, classOpts);
    row = addStatementTotalRow(
      ws,
      row,
      'TOTAL GASTOS',
      primary.summary.totalExpenses,
      cmp(comparative?.summary.totalExpenses),
      isMultiPeriod,
    );
    row++;

    // UTILIDAD NETA
    row = addStatementTotalRow(
      ws,
      row,
      'UTILIDAD NETA',
      primary.summary.netIncome,
      cmp(comparative?.summary.netIncome),
      isMultiPeriod,
    );
    if (pygND && comparative) {
      row = addOpeningPygLegend(ws, row + 1, comparative.period);
    }
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
  row += 1;
  row = addNarrativeDisclaimer(ws, row);
  row += 1;

  // Pendiente #2 (auditoría integral 2026-09-24): la tabla de KPIs se
  // re-renderiza desde el JSON con `applyKpiAnchors` re-aplicado, de modo que un
  // informe persistido antes del cambio tampoco imprime la cifra del modelo de
  // un KPI sin ancla determinista (N/D con motivo). Sin JSON válido se conserva
  // el Markdown tal cual.
  const content = strategyContentWithAnchoredKpis(report);
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
 * `fullContent` de la Parte II con la sección "## 2. KPIs FINANCIEROS"
 * reconstruida desde el JSON validado tras `applyKpiAnchors` (idempotente).
 */
function strategyContentWithAnchoredKpis(report: FinancialReport): string {
  const content = report.strategicAnalysis.fullContent;
  const parsed = StrategyReportSchema.safeParse(report.strategicAnalysis.json);
  if (!parsed.success) return content;
  const lines = content.split('\n');
  const start = lines.findIndex((l) => /^##\s+2\.\s+KPIs FINANCIEROS/i.test(l.trim()));
  if (start < 0) return content;
  const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l.trim()));
  const end = next < 0 ? lines.length : next;
  const anchored = applyKpiAnchors(parsed.data, {}, { keepWhenNoSource: true });
  const section = renderStrategyKpisMarkdown(anchored.json, {
    kpisNeutralized: anchored.neutralized,
    kpisRecomputed: anchored.recomputed,
  });
  return [...lines.slice(0, start), ...section.split('\n'), '', ...lines.slice(end)].join('\n');
}

/** Escribe una cifra de KPI: número con formato, o "N/D" como TEXTO (nunca 0). */
function writeKpiCell(cell: ExcelJS.Cell, value: number | null, numFmt: string): void {
  if (value === null || !Number.isFinite(value)) {
    cell.value = 'N/D';
    cell.alignment = { horizontal: 'right' };
    return;
  }
  cell.value = value;
  cell.numFmt = numFmt;
}

function kpiNumFmt(k: KPIRow): string {
  return k.isPct ? NUM_FMT_PCT : k.isMoney ? NUM_FMT_COP_INT : '0.00';
}

/**
 * Tabla comparativa de KPIs deterministicos derivados del preprocessed.
 * Layout: KPI | <primary.period> | <comparative.period> | Variacion $ | Variacion % (reportes-export-20)
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

  // Headers — periodo actual | comparativo (reportes-export-20).
  const headers = ['KPI', primary.period, comparative.period, 'Variacion', 'Variacion %'];
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
    const fmt = kpiNumFmt(k);
    writeKpiCell(r.getCell(2), k.curr, fmt);
    writeKpiCell(r.getCell(3), k.prev, fmt);
    writeKpiCell(r.getCell(4), k.delta, fmt);
    writeKpiCell(r.getCell(5), k.deltaPct, NUM_FMT_PCT);
    if (k.note) {
      r.getCell(6).value = k.note;
      r.getCell(6).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
    }

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
    writeKpiCell(r.getCell(2), k.curr, kpiNumFmt(k));
    if (k.note) {
      r.getCell(3).value = k.note;
      r.getCell(3).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
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
  /** `null` = N/D (sin base verificada). Nunca se sustituye por 0. */
  curr: number | null;
  prev: number | null;
  delta: number | null;
  deltaPct: number | null;
  isPct: boolean;
  isMoney: boolean;
  /** Marca visible junto a la fila (spec v10.1: △ base de cierre / bases distintas). */
  note?: string;
}

/**
 * Ratio de un periodo, con la MISMA precedencia que usan el PDF y el HTML:
 * primero el campo pre-calculado de `controlTotals` (Wave 2.F4, fuente única).
 *
 * Auditoría 2026-09 (reportes-export-12): `null` en `controlTotals` significa
 * "denominador nulo o anómalo → N/D", y NO debe caer al cálculo local (que
 * producía, p. ej., un ROE de 200 % sobre el patrimonio de cierre). Sólo un
 * campo AUSENTE (`undefined`, balances cacheados pre-F4) usa el fallback, y el
 * fallback también devuelve `null` cuando su denominador es 0.
 *
 * `controlTotals` guarda los porcentajes en escala 0-100; las celdas de Excel
 * llevan `NUM_FMT_PCT`, que espera una fracción, de ahí el /100.
 */
function ratioFromControlTotals(
  view: PeriodView | null,
  pick: (ct: ControlTotals) => number | null | undefined,
  fallback: () => number | null,
  isPercentScale: boolean,
): number | null {
  const ct = view?.controlTotals;
  const pre = ct ? pick(ct) : undefined;
  if (pre === null) return null;
  if (typeof pre === 'number') {
    if (!Number.isFinite(pre)) return null;
    return isPercentScale ? pre / 100 : pre;
  }
  return fallback();
}

const safeDiv = (num: number, den: number): number | null =>
  den === 0 || !Number.isFinite(num) || !Number.isFinite(den) ? null : num / den;

/**
 * Base del ROE/ROA de un periodo: 'promedio' sólo cuando el preprocesador
 * calculó el ratio sobre el promedio con el comparativo (promedio ≠ cierre).
 * Spec v10.1 §KPIs: △ cuando se calcula sobre el saldo de cierre.
 */
function ratioBasis(
  view: PeriodView | null,
  field: 'roe' | 'roa',
): 'promedio' | 'cierre' | 'desconocida' {
  const ct = view?.controlTotals;
  // Campo ausente → el fallback local divide por el saldo de CIERRE.
  if (!ct || ct[field] === undefined) return 'cierre';
  const avg = field === 'roe' ? ct.patrimonioPromedio : ct.activoPromedio;
  const close = field === 'roe' ? ct.patrimonio : ct.activo;
  if (typeof avg !== 'number') return 'desconocida';
  return avg !== close ? 'promedio' : 'cierre';
}

function computeKPIs(primary: PeriodView, comparative: PeriodView | null): KPIRow[] {
  const kpiOf = (
    label: string,
    currVal: number | null,
    prevVal: number | null,
    opts: { isPct?: boolean; isMoney?: boolean; comparable?: boolean },
  ): KPIRow => {
    const comparable = opts.comparable ?? true;
    const delta = comparable && currVal !== null && prevVal !== null ? currVal - prevVal : null;
    const deltaPct =
      delta !== null && prevVal !== null && prevVal !== 0 ? delta / Math.abs(prevVal) : null;
    return { label, curr: currVal, prev: prevVal, delta, deltaPct, isPct: !!opts.isPct, isMoney: !!opts.isMoney };
  };

  const p = primary.summary;
  const c = comparative?.summary ?? null;
  // ingesta-09: un comparativo de saldos de apertura no tiene P&G del periodo
  // anterior; sus cifras de resultados son N/D (no $0) y no hay variación.
  const pygNdC = comparative?.saldosDeApertura === true;
  const openingNote = pygNdC && comparative
    ? `△ ${comparative.period}: saldos de apertura — sin resultados del periodo anterior`
    : undefined;

  // "Ingresos" = ingresos operacionales netos (41 − 4175), nunca la Σ de la
  // clase 4 (ratios-kpis-04). El margen neto usa los ingresos NETOS de
  // devoluciones, misma base que `controlTotals.margenNeto`.
  const revP = revenueBreakdown(primary);
  const revC = comparative && !pygNdC ? revenueBreakdown(comparative) : null;

  const margenNetoP = ratioFromControlTotals(
    primary, (ct) => ct.margenNeto,
    () => (revP.netosTotales === null ? null : safeDiv(p.netIncome, revP.netosTotales)), true,
  );
  const margenNetoC = comparative
    ? ratioFromControlTotals(
        comparative, (ct) => ct.margenNeto,
        () => (revC?.netosTotales == null || !c ? null : safeDiv(c.netIncome, revC.netosTotales)), true,
      )
    : null;

  const endeudamientoP = ratioFromControlTotals(
    primary, (ct) => ct.endeudamientoTotal,
    () => safeDiv(p.totalLiabilities, p.totalAssets), true,
  );
  const endeudamientoC = comparative && c
    ? ratioFromControlTotals(
        comparative, (ct) => ct.endeudamientoTotal,
        () => safeDiv(c.totalLiabilities, c.totalAssets), true,
      )
    : null;

  const roaP = ratioFromControlTotals(
    primary, (ct) => ct.roa,
    () => safeDiv(p.netIncome, p.totalAssets), true,
  );
  const roaC = comparative && c && !pygNdC
    ? ratioFromControlTotals(comparative, (ct) => ct.roa, () => safeDiv(c.netIncome, c.totalAssets), true)
    : null;

  // ROE: `controlTotals.roe` usa patrimonio PROMEDIO. Recalcularlo aquí sobre
  // el patrimonio de cierre imprimía en el .xlsx un ROE distinto al del HTML y
  // al del PDF para el mismo informe.
  const roeP = ratioFromControlTotals(
    primary, (ct) => ct.roe,
    () => safeDiv(p.netIncome, p.totalEquity), true,
  );
  const roeC = comparative && c && !pygNdC
    ? ratioFromControlTotals(comparative, (ct) => ct.roe, () => safeDiv(c.netIncome, c.totalEquity), true)
    : null;

  // Rótulo de la base (△) y comparabilidad: el periodo más antiguo no tiene
  // comparativo propio, así que su ROE/ROA es sobre saldo de cierre; restarlo
  // de un ROE sobre promedio mezcla bases (reportes-export-12).
  const basisNote = (field: 'roe' | 'roa') => {
    const bp = ratioBasis(primary, field);
    const bc = comparative ? ratioBasis(comparative, field) : bp;
    const noun = field === 'roe' ? 'patrimonio' : 'activo';
    const describe = (b: typeof bp) => (b === 'cierre' ? `${noun} de cierre` : `${noun} promedio`);
    if (comparative && bp !== bc && bp !== 'desconocida' && bc !== 'desconocida') {
      return {
        note: `△ Bases distintas: ${comparative.period} sobre ${describe(bc)}, ${primary.period} sobre ${describe(bp)}; variación no calculada`,
        comparable: false,
      };
    }
    return {
      note: bp === 'cierre' ? `△ Calculado sobre ${noun} de cierre` : undefined,
      comparable: true,
    };
  };
  const roeMeta = basisNote('roe');
  const roaMeta = basisNote('roa');
  // ROE N/D por base no interpretable (patrimonio promedio ≤ 0): la nota es el
  // motivo que publicó el preprocesador, no la base de un cálculo que no se
  // hizo (ratios-kpis-07). Mismo texto que la tarjeta del PDF.
  const ndMotivo = (view: PeriodView | null) => view?.controlTotals?.kpiNdMotivos?.roe ?? null;
  const roeNdNote =
    roeP === null && ndMotivo(primary)
      ? ndMotivo(primary)!
      : comparative && roeC === null && ndMotivo(comparative)
        ? `${comparative.period}: ${ndMotivo(comparative)}`
        : null;

  return [
    kpiOf('Total Activo', p.totalAssets, c?.totalAssets ?? null, { isMoney: true }),
    kpiOf('Total Pasivo', p.totalLiabilities, c?.totalLiabilities ?? null, { isMoney: true }),
    kpiOf('Total Patrimonio', p.totalEquity, c?.totalEquity ?? null, { isMoney: true }),
    {
      ...kpiOf('Ingresos operacionales netos', revP.operacionalesNetos, revC?.operacionalesNetos ?? null, { isMoney: true }),
      note: openingNote,
    },
    {
      ...kpiOf('Utilidad Neta', p.netIncome, pygNdC ? null : c?.netIncome ?? null, { isMoney: true }),
      note: openingNote,
    },
    kpiOf('Margen Neto', margenNetoP, pygNdC ? null : margenNetoC, { isPct: true }),
    kpiOf('Endeudamiento', endeudamientoP, endeudamientoC, { isPct: true }),
    { ...kpiOf('ROA', roaP, roaC, { isPct: true, comparable: roaMeta.comparable }), note: roaMeta.note },
    { ...kpiOf('ROE', roeP, roeC, { isPct: true, comparable: roeMeta.comparable }), note: roeNdNote ?? roeMeta.note },
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
      // reportes-export-21: estas discrepancias se miden sobre el balance de
      // prueba recibido, ANTES del Curator; listarlas junto a totales "OK" sin
      // decirlo confundía al cliente. Se declara la base y el estado posterior.
      ws.getRow(row).getCell(1).value =
        'Medidas sobre el balance de prueba recibido, antes de los ajustes del Curator (cierre virtual del ' +
        'resultado, reclasificaciones). Estado posterior al Curator, base de los estados financieros: ' +
        (p.summary.equationBalanced
          ? 'ecuación patrimonial A = P + C cuadra.'
          : `ecuación patrimonial descuadrada por ${fmtCopPesos(p.summary.equationBalance)}.`);
      ws.getRow(row).getCell(1).font = { name: FONT_MAIN, size: 9, italic: true };
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

  row = addNarrativeDisclaimer(ws, row);
  row++;

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

  // "Ingresos" = ingresos operacionales netos (41 − 4175), no la Σ de la
  // clase 4 (ratios-kpis-04). Sin detalle PUC → N/D.
  // ingesta-09: comparativo de saldos de apertura → resultados N/D.
  const pygNdC = comparative.saldosDeApertura === true;
  const lines: Array<[string, number | null, number | null]> = [
    ['Total Activo', comparative.summary.totalAssets, primary.summary.totalAssets],
    ['Total Pasivo', comparative.summary.totalLiabilities, primary.summary.totalLiabilities],
    ['Total Patrimonio', comparative.summary.totalEquity, primary.summary.totalEquity],
    [
      'Ingresos operacionales netos',
      pygNdC ? null : revenueBreakdown(comparative).operacionalesNetos,
      revenueBreakdown(primary).operacionalesNetos,
    ],
    ['Utilidad Neta', pygNdC ? null : comparative.summary.netIncome, primary.summary.netIncome],
  ];

  // Header
  // Periodo actual | comparativo (reportes-export-20).
  const headers = ['Concepto', primary.period, comparative.period, 'Variacion', '% Var'];
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
    const delta = prev !== null && curr !== null ? curr - prev : null;
    writeKpiCell(r.getCell(2), curr, NUM_FMT_COP_INT);
    writeKpiCell(r.getCell(3), prev, NUM_FMT_COP_INT);
    writeKpiCell(r.getCell(4), delta, NUM_FMT_COP_INT);
    writeKpiCell(
      r.getCell(5),
      delta !== null && prev !== null && prev !== 0 ? delta / Math.abs(prev) : null,
      NUM_FMT_PCT,
    );
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

/**
 * Identidad de la empresa para cabeceras: la del JSON validado (misma fuente
 * que las columnas y las hojas EFE/ECP). Antes la cabecera usaba
 * `report.company` y las columnas `json.company`, así que un informe podía
 * decir "Periodo: 2024" arriba y "Saldo 2025" en la columna (reportes-export-10).
 */
function reportIdentity(report: FinancialReport): { name: string; nit: string; fiscalPeriod: string } {
  const c = report.niifAnalysis?.json?.company;
  if (c) return { name: c.name, nit: c.nit, fiscalPeriod: c.fiscalPeriod };
  return {
    name: report.company.name,
    nit: report.company.nit,
    fiscalPeriod: report.company.fiscalPeriod,
  };
}

/**
 * Fecha de corte / periodo cubierto de los estados (NIIF para las PYMES 3.23),
 * derivada del tipo de periodo que el preprocesador infirió — nunca supuesta.
 */
/**
 * JSON NIIF con los rótulos deterministas que imprimen todas las superficies
 * (auditoría 2026-09-24, e2e-niif-09): grupos PUC con el rótulo del catálogo,
 * filas del ECP con el periodo del informe y el calificativo del resultado
 * según su signo. Misma función que el PDF y el orquestador.
 */
function presentableJson(report: FinancialReport, layout: PeriodLayout | null): NiifReportJson | undefined {
  const json = report.niifAnalysis?.json;
  if (!json) return undefined;
  const tipos = resolvePeriodoTipos(
    json.company.fiscalPeriod,
    json.company.comparativePeriod,
    layout?.primary ?? null,
    layout?.comparative ?? null,
  );
  return normalizeNiifStatementLabels(json, { primaryPeriodoTipo: tipos.primaryPeriodoTipo }).json;
}

function statementDate(
  kind: 'position' | 'period',
  report: FinancialReport,
  layout: PeriodLayout | null,
  /** El estado imprime el comparativo; si no, el rótulo no lo nombra. */
  comparativeShown = true,
): string {
  const json = report.niifAnalysis?.json;
  const fiscalPeriod = json?.company.fiscalPeriod ?? report.company.fiscalPeriod;
  const comparativePeriod = comparativeShown
    ? json?.company.comparativePeriod ?? layout?.comparative?.period ?? report.company.comparativePeriod ?? null
    : null;
  const tipos = resolvePeriodoTipos(
    fiscalPeriod,
    comparativePeriod,
    layout?.primary ?? null,
    layout?.comparative ?? null,
  );
  return statementDateLabel(kind, { fiscalPeriod, comparativePeriod, ...tipos });
}

function addSheetHeader(
  ws: ExcelJS.Worksheet,
  title: string,
  report: FinancialReport,
  dateLine?: string,
): void {
  // Gold bar effect
  const r1 = ws.getRow(1);
  r1.getCell(1).value = '1+1 | Reporte Financiero Elite';
  r1.getCell(1).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.gold } };

  const r2 = ws.getRow(2);
  r2.getCell(1).value = title;
  r2.getCell(1).font = { name: FONT_MAIN, bold: true, size: 14, color: { argb: COLORS.darkNavy } };

  const id = reportIdentity(report);
  const r3 = ws.getRow(3);
  r3.getCell(1).value = `${id.name} | NIT: ${id.nit} | Periodo: ${id.fiscalPeriod}`;
  r3.getCell(1).font = { name: FONT_MAIN, size: 10, color: { argb: COLORS.textMuted } };

  const r4 = ws.getRow(4);
  r4.getCell(1).value = dateLine ? `${dateLine} · ${CURRENCY_NOTE}` : '';
  r4.getCell(1).font = { name: FONT_MAIN, size: 9, italic: true, color: { argb: COLORS.textMuted } };
}

/** Notas estructuradas del JSON validado debajo del estado (reportes-export-11). */
function addStatementNotes(
  ws: ExcelJS.Worksheet,
  startRow: number,
  notes: StatementNoteJson[] | undefined,
  language: 'es' | 'en' = 'es',
): number {
  const lines = (notes ?? []).map(formatStatementNote).filter((n) => n.length > 0);
  if (lines.length === 0) return startRow;
  let row = startRow + 1;
  ws.getRow(row).getCell(2).value = 'Notas';
  ws.getRow(row).getCell(2).font = { name: FONT_MAIN, bold: true, size: 9 };
  row++;
  // e2e-niif-10: prosa del LLM cuyas cifras no se anclan — mismo aviso que el PDF.
  ws.getRow(row).getCell(2).value = narrativeDisclaimer(language);
  ws.getRow(row).getCell(2).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
  row++;
  for (const n of lines) {
    ws.getRow(row).getCell(2).value = n;
    ws.getRow(row).getCell(2).font = { name: FONT_MAIN, size: 8, italic: true };
    row++;
  }
  return row;
}

/** Rótulo visible sobre la narrativa del LLM (Resumen / KPIs narrativos). */
function addNarrativeDisclaimer(ws: ExcelJS.Worksheet, row: number): number {
  const r = ws.getRow(row);
  r.getCell(1).value = NARRATIVE_DISCLAIMER;
  r.getCell(1).font = { name: FONT_MAIN, size: 9, italic: true, color: { argb: COLORS.orange } };
  return row + 1;
}

/**
 * Encabezado de columnas de un estado financiero. En multiperiodo:
 *   col 1: Codigo | col 2: Cuenta | col 3: <primary> | col 4: <comparative> | col 5: Var $ | col 6: Var %
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
    r.getCell(3).value = `Saldo ${primaryPeriod}`;
    r.getCell(4).value = `Saldo ${comparativePeriod}`;
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

/** Leyenda del P&G comparativo N/D cuando el comparativo es un saldo de apertura (ingesta-09). */
function addOpeningPygLegend(ws: ExcelJS.Worksheet, row: number, comparativePeriod: string): number {
  const r = ws.getRow(row);
  r.getCell(2).value = openingBalancesPygLegend(comparativePeriod);
  r.getCell(2).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
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
  opts: { reclassifications?: Reclassification[]; comparativeNd?: boolean } = {},
): number {
  let row = startRow;
  const { reclassifications, comparativeNd } = opts;
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
      const prevBal = comparativeNd
        ? null
        : comparativeCl ? findAccountBalance([comparativeCl], meta.code) ?? 0 : 0;
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
 *   Codigo | Cuenta | Saldo {curr} | Saldo {prev} | Variacion $ | Variacion % | Nota Reclasificación?
 */
function addAccountRowMulti(
  ws: ExcelJS.Worksheet,
  row: number,
  code: string,
  name: string,
  /** `null` = N/D (P&G de un comparativo de saldos de apertura): sin variación. */
  prevBalance: number | null,
  currBalance: number,
  footnote?: string,
): number {
  const r = ws.getRow(row);
  r.getCell(1).value = code;
  r.getCell(1).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  r.getCell(2).value = name;
  r.getCell(2).font = { name: FONT_MAIN, size: 9 };
  r.getCell(3).value = currBalance;
  r.getCell(3).numFmt = NUM_FMT_COP;
  r.getCell(3).font = { name: FONT_MAIN, size: 9 };
  if (prevBalance === null) {
    writeKpiCell(r.getCell(4), null, NUM_FMT_COP);
    r.getCell(4).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
    if (footnote) {
      r.getCell(7).value = footnote;
      r.getCell(7).font = { name: FONT_MAIN, size: 8, italic: true, color: { argb: COLORS.orange } };
    }
    return row + 1;
  }
  r.getCell(4).value = prevBalance;
  r.getCell(4).numFmt = NUM_FMT_COP;
  r.getCell(4).font = { name: FONT_MAIN, size: 9, color: { argb: COLORS.textMuted } };
  writeVariationCells(r, currBalance, prevBalance, { size: 9, bold: false });
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

  // Cifra sin base (NaN) → "N/D" como texto, nunca 0.
  if (!Number.isFinite(primaryAmount) || (comparativeAmount !== undefined && !Number.isFinite(comparativeAmount))) {
    const put = (col: number, v: number | undefined) => {
      if (v === undefined) return;
      writeKpiCell(r.getCell(col), Number.isFinite(v) ? v : null, NUM_FMT_COP);
    };
    if (isMultiPeriod && comparativeAmount !== undefined) {
      put(3, primaryAmount);
      put(4, comparativeAmount);
    } else {
      put(3, primaryAmount);
    }
    return row + 1;
  }

  if (isMultiPeriod && comparativeAmount !== undefined) {
    r.getCell(3).value = primaryAmount;
    r.getCell(3).numFmt = NUM_FMT_COP;
    r.getCell(3).font = { name: FONT_MAIN, bold: true, size: 10 };
    r.getCell(4).value = comparativeAmount;
    r.getCell(4).numFmt = NUM_FMT_COP;
    r.getCell(4).font = { name: FONT_MAIN, bold: true, size: 10, color: { argb: COLORS.textMuted } };
    writeVariationCells(r, primaryAmount, comparativeAmount, { size: 10, bold: true });

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

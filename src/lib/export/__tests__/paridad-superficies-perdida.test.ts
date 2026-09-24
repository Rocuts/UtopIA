// ---------------------------------------------------------------------------
// Paridad de superficies — pérdida, patrimonio negativo, ORI y correctoras
// ---------------------------------------------------------------------------
// Criterio de la auditoría de exportes 2026-09 (reportes-export-01, -15, -17):
// JSON, Markdown/HTML (agents/renderer.ts), PDF Élite
// (compose-statements-from-json.ts) y Excel (excel-export.ts) deben mostrar las
// mismas cifras, con el mismo signo, el mismo rótulo de PÉRDIDA y los mismos
// marcadores de "sin comparativo" (n/c). Antes el Markdown imprimía la
// correctora 1592 en positivo, rotulaba "UTILIDAD NETA" una pérdida, no
// presentaba el resultado integral total y dejaba vacío el comparativo
// ausente; el PDF, a su vez, invertía el signo de una partida del EFE con
// código de correctora (la depreciación que se suma en el método indirecto).
//
// Fixture: el informe coherente del repo, modificado para pérdida neta,
// patrimonio negativo (causal de disolución) y ORI distinto de cero.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  makeCoherentNiifReport,
  makeExportableReport,
} from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import {
  renderBalanceSheet,
  renderCashFlowStatement,
  renderIncomeStatement,
} from '@/lib/agents/financial/agents/renderer';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { generateFinancialExcel } from '../excel-export';
import { financialExportBlockers } from '../financial-export-validation';
import {
  niifJsonToBalanceTable,
  niifJsonToCashFlowTable,
  niifJsonToIncomeTable,
} from '../pdf-elite-react/compose-statements-from-json';

type Line = NiifReportJson['balanceSheet']['assets'][number];
const L = (
  account: string | null,
  label: string,
  amountPrimary: string,
  amountComparative: string | null,
  opts: Partial<Line> = {},
): Line => ({
  account, label, amountPrimary, amountComparative,
  level: 2, isAbsolute: true, confidence: null, anomalyFlag: null, ...opts,
});

/**
 * Pérdida neta ($2.000,00), patrimonio negativo (−$1.000,00), ORI $300,00,
 * depreciación acumulada 1592 en magnitud absoluta y un renglón sin cifra
 * comparativa. A = P + C en ambos periodos (cifras en centavos).
 */
function lossNegativeEquityScenario(): NiifReportJson {
  const base = makeCoherentNiifReport();
  return {
    ...base,
    company: { ...base.company, comparativePeriod: '2024' },
    balanceSheet: {
      ...base.balanceSheet,
      assets: [
        L('11', 'Efectivo', '150000', '80000'),
        L('1524', 'Equipo de oficina', '800000', '800000'),
        L('1592', 'Depreciación acumulada', '350000', '300000'),
      ],
      liabilities: [L('22', 'Proveedores', '700000', '510000')],
      equity: [
        L('31', 'Capital suscrito y pagado', '300000', '300000'),
        L('37', 'Pérdidas acumuladas', '-230000', '-300000', { isAbsolute: false }),
        L('36', 'Resultado del ejercicio', '-200000', '70000', { isAbsolute: false }),
        L('38', 'Otro resultado integral acumulado', '30000', null, { isAbsolute: false }),
      ],
      totalAssetsPrimary: '600000',
      totalAssetsComparative: '580000',
      totalLiabilitiesPrimary: '700000',
      totalLiabilitiesComparative: '510000',
      totalEquityPrimary: '-100000',
      totalEquityComparative: '70000',
    },
    incomeStatement: {
      ...base.incomeStatement,
      lines: [
        L('4', 'Ingresos', '700000', '650000'),
        L('6', 'Costo de ventas', '200000', '180000'),
        L('51', 'Gastos de administración', '600000', '400000'),
        L('53', 'Gastos no operacionales', '100000', null),
      ],
      grossProfitPrimary: '500000',
      grossProfitComparative: '470000',
      operatingProfitPrimary: '-100000',
      operatingProfitComparative: '70000',
      netIncomePrimary: '-200000',
      netIncomeComparative: '70000',
      oriPrimary: '30000',
      oriComparative: '0',
    },
    cashFlow: {
      ...base.cashFlow,
      sections: [
        {
          section: 'operating',
          lines: [
            L(null, 'Resultado del ejercicio', '-200000', null, { isAbsolute: false }),
            L('1592', 'Depreciación del periodo', '50000', null),
            L(null, 'Variación de proveedores', '290000', null, { isAbsolute: false }),
          ],
          netFlow: '140000',
          netFlowComparative: null,
        },
        { section: 'investing', lines: [L(null, 'Compra de equipo', '-40000', null, { isAbsolute: false })], netFlow: '-40000', netFlowComparative: null },
        { section: 'financing', lines: [L(null, 'Pago de obligaciones', '-30000', null, { isAbsolute: false })], netFlow: '-30000', netFlowComparative: null },
      ],
      netChange: '70000',
      cashOpening: '80000',
      cashClosing: '150000',
    },
    equityChanges: {
      comparativeRows: null,
      comparativeNote: null,
      rows: [
        { kind: 'opening_balance', label: 'Saldo al 1 ene 2025', capitalSocial: '300000', primaColocacion: '0', reservaLegal: '0', otrasReservas: '0', resultadosAcumulados: '-300000', resultadoEjercicio: '70000', ori: '0', total: '70000' },
        { kind: 'prior_period_result_cancellation', label: 'Traslado del resultado 2024', capitalSocial: '0', primaColocacion: '0', reservaLegal: '0', otrasReservas: '0', resultadosAcumulados: '70000', resultadoEjercicio: '-70000', ori: '0', total: '0' },
        { kind: 'profit_for_period', label: 'Pérdida del ejercicio', capitalSocial: '0', primaColocacion: '0', reservaLegal: '0', otrasReservas: '0', resultadosAcumulados: '0', resultadoEjercicio: '-200000', ori: '0', total: '-200000' },
        { kind: 'other_comprehensive_income', label: 'Otro resultado integral', capitalSocial: '0', primaColocacion: '0', reservaLegal: '0', otrasReservas: '0', resultadosAcumulados: '0', resultadoEjercicio: '0', ori: '30000', total: '30000' },
        { kind: 'closing_balance', label: 'Saldo al 31 dic 2025', capitalSocial: '300000', primaColocacion: '0', reservaLegal: '0', otrasReservas: '0', resultadosAcumulados: '-230000', resultadoEjercicio: '-200000', ori: '30000', total: '-100000' },
      ],
      notes: [],
    },
  };
}

function reportFromJson(json: NiifReportJson): FinancialReport {
  const base = makeExportableReport();
  return {
    ...base,
    company: { name: json.company.name, nit: json.company.nit, fiscalPeriod: json.company.fiscalPeriod },
    niifAnalysis: { ...base.niifAnalysis, json },
  };
}

// ── Extracción de filas por superficie → [rótulo, actual, comparativo] ───────

type Row = [label: string, primary: string, comparative: string];

const clean = (s: string) => s.replace(/\*\*/g, '').trim();

/** Filas de datos de la tabla GFM que emite el renderer (sin cabecera ni separador). */
function markdownRows(md: string): Row[] {
  const lines = md.split('\n').filter((l) => l.startsWith('|'));
  return lines.slice(2).map((l) => {
    const cells = l.slice(1, -1).split('|').map(clean);
    return [cells[0], cells[1] ?? '', cells[2] ?? ''] as Row;
  });
}

function pdfRows(t: { rows: Array<{ account: string; cells: string[] }> }): Row[] {
  return t.rows.map((r) => [r.account.trim(), r.cells[0] ?? '', r.cells[1] ?? ''] as Row);
}

/** Pesos (número de la celda) → "$1.234,56" / "($1.234,56)"; texto tal cual. */
function excelCell(v: ExcelJS.CellValue): string {
  if (typeof v === 'number') return formatCopFromCents(BigInt(Math.round(v * 100)), false);
  return v === null || v === undefined ? '' : String(v);
}

async function excelSheets(report: FinancialReport) {
  const buf = await generateFinancialExcel({ report });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

/** Hojas de estados (con comparativo): col1 código, col2 rótulo, col3 comparativo, col4 actual. */
function excelStatementRows(ws: ExcelJS.Worksheet): Row[] {
  const out: Row[] = [];
  ws.eachRow((row) => {
    const label = row.getCell(2).value;
    if (typeof label !== 'string' || !label.trim()) return;
    const account = row.getCell(1).value;
    if (account === 'Codigo') return; // fila de encabezados de columna
    const full = typeof account === 'string' && account.trim() ? `${account} — ${label}` : label;
    out.push([full.trim(), excelCell(row.getCell(4).value), excelCell(row.getCell(3).value)]);
  });
  return out;
}

const TOTAL_ALIASES: Array<[RegExp, string]> = [
  [/^TOTAL ACTIVOS?$/i, 'TOTAL ACTIVO'],
  [/^TOTAL PASIVOS?$/i, 'TOTAL PASIVO'],
  [/^TOTAL PATRIMONIO$/i, 'TOTAL PATRIMONIO'],
];
const canonical = ([label, p, c]: Row): Row => {
  for (const [rx, name] of TOTAL_ALIASES) if (rx.test(label)) return [name, p, c];
  return [label, p, c];
};
/** Sólo renglones con código PUC y los tres totales del ESF (los rótulos de sección difieren por formato). */
const balanceComparable = (rows: Row[]): Row[] =>
  rows.map(canonical).filter(([l]) => /^\d+ — /.test(l) || TOTAL_ALIASES.some(([, n]) => n === l));

describe('Paridad de superficies — pérdida, patrimonio negativo y ORI', () => {
  const json = lossNegativeEquityScenario();
  const report = reportFromJson(json);

  it('el escenario es un informe coherente y exportable (JSON válido, sin bloqueos)', () => {
    const v = validateNiifReportJson(json);
    expect(v.errors).toEqual([]);
    expect(financialExportBlockers(report)).toEqual([]);
  });

  it('Estado de Resultados: Markdown, PDF y Excel listan las mismas filas, cifras y signos', async () => {
    const md = markdownRows(renderIncomeStatement(json));
    const pdf = pdfRows(niifJsonToIncomeTable(json));
    const xls = excelStatementRows((await excelSheets(report)).getWorksheet('Estado Resultados')!);

    expect(md).toEqual(pdf);
    expect(xls).toEqual(pdf);
    // Anclas explícitas: pérdida rotulada y firmada; resultado integral = neto + ORI.
    expect(pdf).toContainEqual(['PÉRDIDA OPERATIVA (EBIT)', '($1.000,00)', '$700,00']);
    expect(pdf).toContainEqual(['PÉRDIDA NETA DEL PERÍODO', '($2.000,00)', '$700,00']);
    expect(pdf).toContainEqual(['OTRO RESULTADO INTEGRAL', '$300,00', '$0,00']);
    expect(pdf).toContainEqual(['RESULTADO INTEGRAL TOTAL', '($1.700,00)', '$700,00']);
    // Renglón sin cifra comparativa: el mismo marcador en las tres superficies.
    expect(pdf).toContainEqual(['53 — Gastos no operacionales', '$1.000,00', 'n/c']);
    expect(md.some(([l]) => /UTILIDAD NETA/.test(l))).toBe(false);
  });

  it('ESF: renglones y totales con el mismo signo (correctora restando, patrimonio negativo)', async () => {
    const md = balanceComparable(markdownRows(renderBalanceSheet(json)));
    const pdf = balanceComparable(pdfRows(niifJsonToBalanceTable(json)));
    const xls = balanceComparable(excelStatementRows((await excelSheets(report)).getWorksheet('Balance NIIF')!));

    expect(md).toEqual(pdf);
    expect(xls).toEqual(pdf);
    expect(pdf).toContainEqual(['1592 — Depreciación acumulada', '($3.500,00)', '($3.000,00)']);
    expect(pdf).toContainEqual(['TOTAL PATRIMONIO', '($1.000,00)', '$700,00']);
    expect(pdf).toContainEqual(['38 — Otro resultado integral acumulado', '$300,00', 'n/c']);
    // La columna impresa suma el total impreso (A = Σ renglones del activo).
    const toCents = (s: string) => {
      const neg = s.startsWith('(');
      const n = BigInt(s.replace(/[^\d]/g, ''));
      return neg ? -n : n;
    };
    const activo = pdf.filter(([l]) => /^1\d* — /.test(l)).reduce((a, [, p]) => a + toCents(p), BigInt(0));
    expect(activo).toBe(BigInt(600000));
  });

  it('EFE: la depreciación que se suma en el método indirecto conserva su signo en todas las superficies', async () => {
    const md = markdownRows(renderCashFlowStatement(json));
    const pdf = pdfRows(niifJsonToCashFlowTable(json));
    const ws = (await excelSheets(report)).getWorksheet('Flujos de Efectivo')!;
    const xls = new Map<string, string>();
    ws.eachRow((row) => {
      const l = row.getCell(1).value;
      if (typeof l === 'string') xls.set(l, excelCell(row.getCell(2).value));
    });

    const dep = '1592 — Depreciación del periodo';
    expect(md.find(([l]) => l === dep)?.[1]).toBe('$500,00');
    expect(pdf.find(([l]) => l === dep)?.[1]).toBe('$500,00');
    expect(xls.get('Depreciación del periodo')).toBe('$500,00');
    for (const [label, value] of [
      ['Resultado del ejercicio', '($2.000,00)'],
      ['Variación de proveedores', '$2.900,00'],
      ['Compra de equipo', '($400,00)'],
    ] as const) {
      expect(md.find(([l]) => l === label)?.[1]).toBe(value);
      expect(pdf.find(([l]) => l === label)?.[1]).toBe(value);
      expect(xls.get(label)).toBe(value);
    }
  });
});

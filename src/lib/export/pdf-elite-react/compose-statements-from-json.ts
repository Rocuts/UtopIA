// ---------------------------------------------------------------------------
// Adapter JSON-strict -> ParsedTable para el PDF Élite (Fase 3.1)
// ---------------------------------------------------------------------------
//
// Cuando el NIIF Analyst corre vía `callFinancialAgent` (default tras Fase 2),
// expone `niifAnalysis.json: NiifReportJson` además del Markdown legacy. Estas
// funciones construyen `ParsedTable` directamente desde ese JSON, evitando el
// parser de Markdown (frágil ante cambios de output del modelo).
//
// `compose.ts` prefiere estas funciones cuando `niifAnalysis.json` está
// presente, y cae al parser Markdown legacy si está ausente (compat).
// ---------------------------------------------------------------------------

import { formatCopFromCents, parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import type {
  NiifReportJson,
  EquityChangeRowJson,
} from '@/lib/agents/financial/contracts/niif-report';
import type { StatementLineJson } from '@/lib/agents/financial/contracts/base';
import type { ParsedTable, ParsedTableRow } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCop(value: string, absolute: boolean): string {
  return formatCopFromCents(parseMoneyCop(value), absolute);
}

function lineToRow(line: StatementLineJson): ParsedTableRow {
  const account = line.account ? `${line.account} — ${line.label}` : line.label;
  const primary = fmtCop(line.amountPrimary, line.isAbsolute);
  const comparative = line.amountComparative !== null ? fmtCop(line.amountComparative, line.isAbsolute) : '';
  const cells = comparative ? [primary, comparative] : [primary];
  const emphasis: ParsedTableRow['emphasis'] | undefined =
    line.level === 4 ? 'total' : line.level === 3 ? 'subtotal' : undefined;
  return emphasis ? { account, cells, emphasis } : { account, cells };
}

function buildHeaders(json: NiifReportJson, kind: 'balance' | 'income'): string[] {
  const hasComparative = json.company.comparativePeriod !== null;
  const period = json.company.fiscalPeriod;
  const headers = [kind === 'balance' ? 'Cuenta' : 'Concepto', period];
  if (hasComparative) headers.push(json.company.comparativePeriod ?? '');
  return headers;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

export function niifJsonToBalanceTable(json: NiifReportJson): ParsedTable {
  const b = json.balanceSheet;
  const rows: ParsedTableRow[] = [];
  // ACTIVOS
  rows.push({ account: 'ACTIVOS', cells: [], emphasis: 'subtotal' });
  rows.push(...b.assets.map(lineToRow));
  // Total Activos
  const totA = fmtCop(b.totalAssetsPrimary, true);
  const totAcmp = b.totalAssetsComparative !== null ? fmtCop(b.totalAssetsComparative, true) : '';
  rows.push({
    account: 'TOTAL ACTIVOS',
    cells: totAcmp ? [totA, totAcmp] : [totA],
    emphasis: 'total',
  });
  // PASIVOS Y PATRIMONIO
  rows.push({ account: 'PASIVOS Y PATRIMONIO', cells: [], emphasis: 'subtotal' });
  rows.push(...b.liabilities.map(lineToRow));
  const totL = fmtCop(b.totalLiabilitiesPrimary, true);
  const totLcmp = b.totalLiabilitiesComparative !== null ? fmtCop(b.totalLiabilitiesComparative, true) : '';
  rows.push({
    account: 'TOTAL PASIVOS',
    cells: totLcmp ? [totL, totLcmp] : [totL],
    emphasis: 'total',
  });
  rows.push(...b.equity.map(lineToRow));
  const totE = fmtCop(b.totalEquityPrimary, true);
  const totEcmp = b.totalEquityComparative !== null ? fmtCop(b.totalEquityComparative, true) : '';
  rows.push({
    account: 'TOTAL PATRIMONIO',
    cells: totEcmp ? [totE, totEcmp] : [totE],
    emphasis: 'total',
  });

  return {
    caption: 'Estado de Situación Financiera',
    headers: buildHeaders(json, 'balance'),
    rows,
  };
}

export function niifJsonToIncomeTable(json: NiifReportJson): ParsedTable {
  const p = json.incomeStatement;
  const rows: ParsedTableRow[] = p.lines.map(lineToRow);
  // Append los totales emphasized si no vinieron como líneas.
  const accounts = new Set(rows.map((r) => r.account.toUpperCase()));
  const pushTotal = (label: string, primary: string, comp: string | null) => {
    if (accounts.has(label.toUpperCase())) return;
    const cells = comp !== null ? [fmtCop(primary, true), fmtCop(comp, true)] : [fmtCop(primary, true)];
    rows.push({ account: label, cells, emphasis: 'total' });
  };
  pushTotal('UTILIDAD BRUTA', p.grossProfitPrimary, p.grossProfitComparative);
  pushTotal('UTILIDAD OPERATIVA (EBIT)', p.operatingProfitPrimary, p.operatingProfitComparative);
  pushTotal('UTILIDAD NETA DEL PERÍODO', p.netIncomePrimary, p.netIncomeComparative);

  return {
    caption: 'Estado de Resultados Integral',
    headers: buildHeaders(json, 'income'),
    rows,
  };
}

export function niifJsonToCashFlowTable(json: NiifReportJson): ParsedTable {
  const cf = json.cashFlow;
  const sectionLabel = {
    operating: 'ACTIVIDADES DE OPERACIÓN',
    investing: 'ACTIVIDADES DE INVERSIÓN',
    financing: 'ACTIVIDADES DE FINANCIAMIENTO',
  } as const;
  const rows: ParsedTableRow[] = [];
  for (const s of cf.sections) {
    rows.push({ account: sectionLabel[s.section], cells: [], emphasis: 'subtotal' });
    rows.push(...s.lines.map(lineToRow));
    rows.push({
      account: `FLUJO NETO ${sectionLabel[s.section]}`,
      cells: [fmtCop(s.netFlow, false)],
      emphasis: 'subtotal',
    });
  }
  rows.push({
    account: 'AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO',
    cells: [fmtCop(cf.netChange, false)],
    emphasis: 'total',
  });
  rows.push({ account: 'Efectivo al inicio del período', cells: [fmtCop(cf.cashOpening, true)] });
  rows.push({
    account: 'EFECTIVO AL FINAL DEL PERÍODO',
    cells: [fmtCop(cf.cashClosing, true)],
    emphasis: 'total',
  });
  return {
    caption: 'Estado de Flujos de Efectivo (Método Indirecto)',
    headers: ['Concepto', json.company.fiscalPeriod],
    rows,
  };
}

export function niifJsonToEquityTable(json: NiifReportJson): ParsedTable {
  const ec = json.equityChanges;
  const headers = [
    'Movimiento',
    'Capital',
    'Prima',
    'Reserva Legal',
    'Otras Reservas',
    'Result. Acum.',
    'Result. Ejerc.',
    'ORI',
    'TOTAL',
  ];
  const rowToRow = (r: EquityChangeRowJson): ParsedTableRow => {
    const bold = r.kind === 'opening_balance' || r.kind === 'closing_balance';
    const cells = [
      fmtCop(r.capitalSocial, true),
      fmtCop(r.primaColocacion, true),
      fmtCop(r.reservaLegal, true),
      fmtCop(r.otrasReservas, true),
      fmtCop(r.resultadosAcumulados, true),
      fmtCop(r.resultadoEjercicio, true),
      fmtCop(r.ori, true),
      fmtCop(r.total, true),
    ];
    return bold ? { account: r.label, cells, emphasis: 'total' } : { account: r.label, cells };
  };
  return {
    caption: 'Estado de Cambios en el Patrimonio',
    headers,
    rows: ec.rows.map(rowToRow),
  };
}

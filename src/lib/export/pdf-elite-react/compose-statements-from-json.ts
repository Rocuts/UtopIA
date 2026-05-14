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

// Placeholder visible cuando el reporte declara comparativo (company.comparativePeriod
// ≠ null) pero una línea no trae amountComparative. Antes se renderizaba como
// celda vacía, lo cual (a) desalineaba columnas con el header y (b) ocultaba
// fallas de Pass-1 que null-eaba el comparativo silenciosamente. Render
// explícito "n/c" surface la falla y mantiene el ancho de tabla constante
// — spec v8.1 §1 patrón "no compara" (TRANSICION).
const NO_COMPARATIVE_PLACEHOLDER = 'n/c';

function lineToRow(line: StatementLineJson, hasComparative: boolean): ParsedTableRow {
  const account = line.account ? `${line.account} — ${line.label}` : line.label;
  const primary = fmtCop(line.amountPrimary, line.isAbsolute);
  const cells: string[] = [primary];
  if (hasComparative) {
    cells.push(
      line.amountComparative !== null
        ? fmtCop(line.amountComparative, line.isAbsolute)
        : NO_COMPARATIVE_PLACEHOLDER,
    );
  }
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

function totalCells(
  primary: string,
  comparative: string | null,
  hasComparative: boolean,
): string[] {
  const cells: string[] = [fmtCop(primary, true)];
  if (hasComparative) {
    cells.push(
      comparative !== null
        ? fmtCop(comparative, true)
        : NO_COMPARATIVE_PLACEHOLDER,
    );
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

export function niifJsonToBalanceTable(json: NiifReportJson): ParsedTable {
  const b = json.balanceSheet;
  const hasComparative = json.company.comparativePeriod !== null;
  const rows: ParsedTableRow[] = [];
  // ACTIVOS
  rows.push({ account: 'ACTIVOS', cells: [], emphasis: 'subtotal' });
  rows.push(...b.assets.map((l) => lineToRow(l, hasComparative)));
  rows.push({
    account: 'TOTAL ACTIVOS',
    cells: totalCells(b.totalAssetsPrimary, b.totalAssetsComparative, hasComparative),
    emphasis: 'total',
  });
  // PASIVOS Y PATRIMONIO
  rows.push({ account: 'PASIVOS Y PATRIMONIO', cells: [], emphasis: 'subtotal' });
  rows.push(...b.liabilities.map((l) => lineToRow(l, hasComparative)));
  rows.push({
    account: 'TOTAL PASIVOS',
    cells: totalCells(b.totalLiabilitiesPrimary, b.totalLiabilitiesComparative, hasComparative),
    emphasis: 'total',
  });
  rows.push(...b.equity.map((l) => lineToRow(l, hasComparative)));
  rows.push({
    account: 'TOTAL PATRIMONIO',
    cells: totalCells(b.totalEquityPrimary, b.totalEquityComparative, hasComparative),
    emphasis: 'total',
  });

  // ── ECUACIÓN PATRIMONIAL (v2.2 #1) ────────────────────────────────────────
  // Verificación visible A = P + C inmediatamente después de TOTAL PATRIMONIO.
  // El renderer lo destaca con tinte sage cuando cuadra y tinte clay cuando no.
  rows.push(...buildEquationTrailer(b, hasComparative));

  return {
    caption: 'Estado de Situación Financiera',
    headers: buildHeaders(json, 'balance'),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Ecuación patrimonial — trailer A = P + C (v2.2 #1)
// ---------------------------------------------------------------------------
//
// Anexa 6 filas al final del Balance:
//   0. Grupo "VERIFICACIÓN" (separador visual)
//   1. Título — "✅ ECUACIÓN PATRIMONIAL — A = P + C" o "⚠ DESCUADRE..."
//   2. Activo                        = totalAssetsPrimary [+ comparative]
//   3. = Pasivo                      = totalLiabilitiesPrimary [+ comparative]
//   4. + Patrimonio                  = totalEquityPrimary [+ comparative]
//   5. Diferencia (debe ser $0,00)   = (A − P − C) por columna (firmado)
//
// El título mantiene siempre el check (cuadre exitoso del periodo primary
// que es la convención del reporte). El descuadre real por columna se hace
// visible en la fila "Diferencia": $0,00 cuando cuadra, ($X) cuando no.
// Si el primary descuadra → la cabecera muta a "⚠ DESCUADRE DETECTADO".
function buildEquationTrailer(
  b: NiifReportJson['balanceSheet'],
  hasComparative: boolean,
): ParsedTableRow[] {
  const aPrim = parseMoneyCop(b.totalAssetsPrimary);
  const lPrim = parseMoneyCop(b.totalLiabilitiesPrimary);
  const ePrim = parseMoneyCop(b.totalEquityPrimary);
  const diffPrim = aPrim - lPrim - ePrim;
  const primaryBalanced = diffPrim === BigInt(0);

  const titleLabel = primaryBalanced
    ? '✅ ECUACIÓN PATRIMONIAL — A = P + C'
    : '⚠ DESCUADRE DETECTADO — A ≠ P + C';

  // Title row cells: muestran el TOTAL ACTIVOS de cada periodo (la igualdad
  // declarada). El visual ya se acentúa en el renderer por el prefijo del
  // account (✅ / ⚠).
  const titleCells: string[] = [fmtCop(b.totalAssetsPrimary, true)];
  if (hasComparative) {
    titleCells.push(
      b.totalAssetsComparative !== null
        ? fmtCop(b.totalAssetsComparative, true)
        : NO_COMPARATIVE_PLACEHOLDER,
    );
  }

  // Diferencia (debe ser $0,00). Mantenemos signo (absolute=false) para que
  // un descuadre se vea como ($X) — la convención NIIF de paréntesis para
  // negativos refuerza el "algo está roto".
  const diffCells: string[] = [formatCopFromCents(diffPrim, false)];
  if (hasComparative) {
    if (
      b.totalAssetsComparative !== null &&
      b.totalLiabilitiesComparative !== null &&
      b.totalEquityComparative !== null
    ) {
      const diffComp =
        parseMoneyCop(b.totalAssetsComparative) -
        parseMoneyCop(b.totalLiabilitiesComparative) -
        parseMoneyCop(b.totalEquityComparative);
      diffCells.push(formatCopFromCents(diffComp, false));
    } else {
      diffCells.push(NO_COMPARATIVE_PLACEHOLDER);
    }
  }

  return [
    { account: 'VERIFICACIÓN', cells: [], emphasis: 'subtotal' },
    { account: titleLabel, cells: titleCells, emphasis: 'total' },
    {
      account: 'Activo',
      cells: totalCells(b.totalAssetsPrimary, b.totalAssetsComparative, hasComparative),
    },
    {
      account: '= Pasivo',
      cells: totalCells(b.totalLiabilitiesPrimary, b.totalLiabilitiesComparative, hasComparative),
    },
    {
      account: '+ Patrimonio',
      cells: totalCells(b.totalEquityPrimary, b.totalEquityComparative, hasComparative),
    },
    {
      account: 'Diferencia (debe ser $0,00)',
      cells: diffCells,
      emphasis: 'subtotal',
    },
  ];
}

export function niifJsonToIncomeTable(json: NiifReportJson): ParsedTable {
  const p = json.incomeStatement;
  const hasComparative = json.company.comparativePeriod !== null;
  const rows: ParsedTableRow[] = p.lines.map((l) => lineToRow(l, hasComparative));
  // Append los totales emphasized si no vinieron como líneas.
  const accounts = new Set(rows.map((r) => r.account.toUpperCase()));
  const pushTotal = (label: string, primary: string, comp: string | null) => {
    if (accounts.has(label.toUpperCase())) return;
    rows.push({
      account: label,
      cells: totalCells(primary, comp, hasComparative),
      emphasis: 'total',
    });
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
  // EFE en la plantilla editorial v8.1 se presenta single-period (la
  // variación domina vs el saldo comparativo en flujos), por eso
  // hasComparative=false aquí incluso si el reporte trae comparativo en
  // Balance/P&L.
  const rows: ParsedTableRow[] = [];
  for (const s of cf.sections) {
    rows.push({ account: sectionLabel[s.section], cells: [], emphasis: 'subtotal' });
    rows.push(...s.lines.map((l) => lineToRow(l, false)));
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

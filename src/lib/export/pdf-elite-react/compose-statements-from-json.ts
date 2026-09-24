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
import type { StatementLineJson, StatementNoteJson } from '@/lib/agents/financial/contracts/base';
import {
  CURRENCY_NOTE,
  cashFlowHasComparativeColumn,
  comparativeStatementLegend,
  incomeStatementPresentationRows,
  normalizeNiifStatementLabels,
  presentedLineCents,
  statementDateLabel,
  type PeriodoTipo,
} from '../statement-presentation';
import type { ParsedTable, ParsedTableRow } from './types';

/**
 * Contexto de presentación que NO vive en el JSON NIIF: el tipo de periodo que
 * el preprocesador infirió del archivo (año completo o corte parcial). Sin él
 * la fecha de corte se declara "no identificada" en vez de suponerse.
 */
export interface StatementTableContext {
  primaryPeriodoTipo?: PeriodoTipo | null;
  comparativePeriodoTipo?: PeriodoTipo | null;
  /**
   * ingesta-09: el periodo comparativo proviene de una columna de saldo
   * inicial/anterior del archivo (`PeriodSnapshot.saldosDeApertura`). Su ESF
   * es el de apertura, pero no hay P&G del periodo anterior: el ERI
   * comparativo se presenta N/D (no $0) y sin variaciones de resultados.
   */
  comparativeSaldosDeApertura?: boolean;
  /** Idioma del informe: sufijo de porción de un grupo partido por plazo (I5-niif 4). */
  language?: 'es' | 'en';
}

/** Celda del P&G comparativo cuando el comparativo es un saldo de apertura. */
export const OPENING_PYG_PLACEHOLDER = 'N/D';

/**
 * Leyenda del ERI cuando el comparativo es un saldo de apertura (ingesta-09).
 * La comparten el PDF y el Excel.
 */
export function openingBalancesPygLegend(comparativePeriod: string): string {
  return (
    `Resultados comparativos ${comparativePeriod}: N/D — la columna ${comparativePeriod} proviene de ` +
    'una columna de saldo inicial/anterior del archivo (saldos de apertura), no de un cierre del ' +
    'periodo anterior; no hay estado de resultados de ese periodo y no se calculan variaciones de resultados.'
  );
}

function presentationMeta(
  json: NiifReportJson,
  kind: 'position' | 'period',
  ctx: StatementTableContext | undefined,
  notes: StatementNoteJson[] | undefined,
  /** El estado imprime la columna/filas del comparativo (el subtítulo lo nombra sólo entonces). */
  comparativeShown = true,
): Pick<ParsedTable, 'subtitle' | 'currencyNote' | 'footnotes'> {
  const footnotes = (notes ?? []).map(formatStatementNote).filter((n) => n.length > 0);
  return {
    subtitle: statementDateLabel(kind, {
      fiscalPeriod: json.company.fiscalPeriod,
      comparativePeriod: comparativeShown ? json.company.comparativePeriod : null,
      primaryPeriodoTipo: ctx?.primaryPeriodoTipo ?? null,
      comparativePeriodoTipo: ctx?.comparativePeriodoTipo ?? null,
    }),
    currencyNote: CURRENCY_NOTE,
    ...(footnotes.length > 0 ? { footnotes } : {}),
  };
}

/** Nota estructurada del JSON validado → línea legible "ref — cuerpo (norma)". */
export function formatStatementNote(n: StatementNoteJson): string {
  const body = n.body.trim();
  if (!body) return '';
  const ref = n.ref?.trim();
  const norma = n.norma?.trim();
  return `${ref ? `${ref} — ` : ''}${body}${norma ? ` (${norma})` : ''}`;
}

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

/**
 * Renglón de detalle con su signo. Antes se formateaba con `isAbsolute`, que
 * borraba el signo de cualquier renglón negativo marcado como absoluto mientras
 * el Excel lo imprimía negativo: el mismo informe decía cosas distintas. Ahora
 * todo renglón se imprime firmado (paréntesis NIIF) y las correctoras en
 * magnitud absoluta se presentan restando (`presentedLineCents`).
 */
function fmtLine(line: StatementLineJson, value: string, contraAware: boolean): string {
  const cents = parseMoneyCop(value);
  return formatCopFromCents(
    contraAware ? presentedLineCents(line.account, cents, line.isAbsolute) : cents,
    false,
  );
}

/**
 * `contraAware = false` en el EFE: sus renglones ya viajan firmados como flujo
 * (la depreciación 1592 que se SUMA en el método indirecto es positiva). La
 * regla de correctoras del ESF la imprimía entre paréntesis mientras el Excel
 * y el Markdown la mostraban positiva (paridad de superficies).
 */
function lineToRow(
  line: StatementLineJson,
  hasComparative: boolean,
  contraAware = true,
): ParsedTableRow {
  const account = line.account ? `${line.account} — ${line.label}` : line.label;
  const primary = fmtLine(line, line.amountPrimary, contraAware);
  const cells: string[] = [primary];
  if (hasComparative) {
    cells.push(
      line.amountComparative !== null
        ? fmtLine(line, line.amountComparative, contraAware)
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

/**
 * Celdas de un TOTAL — SIEMPRE con signo (paréntesis NIIF para negativos).
 *
 * Auditoría 2026-09 (reportes-export-01): esta función formateaba con
 * `absolute = true`. La corrección de agosto se aplicó en `agents/renderer.ts`
 * (fmtTotal) y en el Excel, pero no aquí: una pérdida neta, un EBIT negativo o
 * un patrimonio negativo (causal de disolución) se imprimían positivos en el
 * PDF mientras el Excel del mismo informe los mostraba negativos.
 */
function totalCells(
  primary: string,
  comparative: string | null,
  hasComparative: boolean,
): string[] {
  const cells: string[] = [fmtCop(primary, false)];
  if (hasComparative) {
    cells.push(
      comparative !== null
        ? fmtCop(comparative, false)
        : NO_COMPARATIVE_PLACEHOLDER,
    );
  }
  return cells;
}

/**
 * Rótulos deterministas antes de imprimir (auditoría 2026-09-24, e2e-niif-09):
 * grupos PUC con el rótulo del catálogo, filas de apertura/cierre/resultado
 * del ECP con el periodo del informe y el calificativo del resultado según su
 * signo. Idempotente: el orquestador ya lo aplicó; aquí protege el JSON que
 * llega del cliente.
 */
function presentable(json: NiifReportJson, ctx: StatementTableContext | undefined): NiifReportJson {
  return normalizeNiifStatementLabels(json, {
    primaryPeriodoTipo: ctx?.primaryPeriodoTipo,
    ...(ctx?.language ? { language: ctx.language } : {}),
  }).json;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

export function niifJsonToBalanceTable(
  source: NiifReportJson,
  ctx?: StatementTableContext,
): ParsedTable {
  const json = presentable(source, ctx);
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
    ...presentationMeta(json, 'position', ctx, b.notes),
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
  const titleCells: string[] = totalCells(
    b.totalAssetsPrimary,
    b.totalAssetsComparative,
    hasComparative,
  );

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

export function niifJsonToIncomeTable(
  source: NiifReportJson,
  ctx?: StatementTableContext,
): ParsedTable {
  const json = presentable(source, ctx);
  const p = json.incomeStatement;
  const hasComparative = json.company.comparativePeriod !== null;
  // Regla compartida con el Markdown y el Excel (`incomeStatementPresentationRows`,
  // auditoría 2026-09-24 e2e-niif-01): los escalones de la cascada (UB, EBIT,
  // UAI, UN, ORI y resultado integral total — NIIF para las PYMES 5.5 / NIC
  // 1.81A) se imprimen SIEMPRE desde los campos anclados del JSON, con el
  // rótulo según el signo; un renglón del analista no los sustituye.
  const rows: ParsedTableRow[] = incomeStatementPresentationRows(p).map((r) =>
    r.total
      ? {
          account: r.label,
          cells: totalCells(r.amountPrimary, r.amountComparative, hasComparative),
          emphasis: 'total' as const,
        }
      : lineToRow(
          {
            account: r.account,
            label: r.label,
            amountPrimary: r.amountPrimary,
            amountComparative: r.amountComparative,
            level: r.level as StatementLineJson['level'],
            isAbsolute: r.isAbsolute,
          },
          hasComparative,
        ),
  );

  const meta = presentationMeta(json, 'period', ctx, p.notes);
  // ingesta-09: comparativo de saldos de apertura → sin P&G del periodo
  // anterior. La columna se conserva (alineación) con N/D en cada celda.
  if (hasComparative && ctx?.comparativeSaldosDeApertura === true) {
    for (const row of rows) {
      if (row.cells.length === 2) row.cells[1] = OPENING_PYG_PLACEHOLDER;
    }
    meta.footnotes = [
      ...(meta.footnotes ?? []),
      openingBalancesPygLegend(json.company.comparativePeriod ?? ''),
    ];
  }

  return {
    caption: 'Estado de Resultados Integral',
    headers: buildHeaders(json, 'income'),
    rows,
    ...meta,
  };
}

export function niifJsonToCashFlowTable(
  source: NiifReportJson,
  ctx?: StatementTableContext,
): ParsedTable {
  const json = presentable(source, ctx);
  const cf = json.cashFlow;
  const sectionLabel = {
    operating: 'ACTIVIDADES DE OPERACIÓN',
    investing: 'ACTIVIDADES DE INVERSIÓN',
    financing: 'ACTIVIDADES DE FINANCIAMIENTO',
  } as const;
  // Columna comparativa del EFE (auditoría 2026-09-24, pendiente #3): la
  // calcula el código desde el corte anterior al comparativo y sólo se imprime
  // completa. Sin ella, la nota determinista de comparativo no presentado
  // (NIIF para las PYMES 3.14) va como leyenda visible (reportes-export-13).
  const hasComparative = json.company.comparativePeriod !== null && cashFlowHasComparativeColumn(cf);
  const rows: ParsedTableRow[] = [];
  for (const s of cf.sections) {
    rows.push({ account: sectionLabel[s.section], cells: [], emphasis: 'subtotal' });
    rows.push(...s.lines.map((l) => lineToRow(l, hasComparative, false)));
    rows.push({
      account: `FLUJO NETO ${sectionLabel[s.section]}`,
      cells: totalCells(s.netFlow, s.netFlowComparative, hasComparative),
      emphasis: 'subtotal',
    });
  }
  rows.push({
    account: 'AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO',
    cells: totalCells(cf.netChange, cf.netChangeComparative, hasComparative),
    emphasis: 'total',
  });
  // Saldos de efectivo con signo: un sobregiro presentado en caja no debe
  // imprimirse positivo.
  rows.push({
    account: 'Efectivo al inicio del período',
    cells: totalCells(cf.cashOpening, cf.cashOpeningComparative, hasComparative),
  });
  rows.push({
    account: 'EFECTIVO AL FINAL DEL PERÍODO',
    cells: totalCells(cf.cashClosing, cf.cashClosingComparative, hasComparative),
    emphasis: 'total',
  });
  const legend = comparativeStatementLegend('cashFlow', json);
  return {
    caption: 'Estado de Flujos de Efectivo (Método Indirecto)',
    headers: hasComparative
      ? ['Concepto', json.company.fiscalPeriod, json.company.comparativePeriod ?? '']
      : ['Concepto', json.company.fiscalPeriod],
    rows,
    ...presentationMeta(json, 'period', ctx, undefined, hasComparative),
    ...(legend ? { legends: [legend] } : {}),
  };
}

export function niifJsonToEquityTable(
  source: NiifReportJson,
  ctx?: StatementTableContext,
): ParsedTable {
  const json = presentable(source, ctx);
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
  // v2.5: ECP preserva signo (paréntesis para negativos). La cancelación de
  // resultado prior (prior_period_result_cancellation), la distribución de
  // dividendos y las pérdidas acumuladas se renderizan con su signo natural.
  const rowToRow = (r: EquityChangeRowJson): ParsedTableRow => {
    const bold = r.kind === 'opening_balance' || r.kind === 'closing_balance';
    const cells = [
      fmtCop(r.capitalSocial, false),
      fmtCop(r.primaColocacion, false),
      fmtCop(r.reservaLegal, false),
      fmtCop(r.otrasReservas, false),
      fmtCop(r.resultadosAcumulados, false),
      fmtCop(r.resultadoEjercicio, false),
      fmtCop(r.ori, false),
      fmtCop(r.total, false),
    ];
    return bold ? { account: r.label, cells, emphasis: 'total' } : { account: r.label, cells };
  };
  // ECP del periodo comparativo (pendiente #3, NIIF para las PYMES 3.14 /
  // 6.3): los dos periodos apilados en orden cronológico, cada uno bajo su
  // encabezado; el cierre del comparativo es la apertura del periodo actual.
  const comparativeRows = json.company.comparativePeriod !== null ? (ec.comparativeRows ?? []) : [];
  const hasComparative = comparativeRows.length > 0;
  const rows: ParsedTableRow[] = hasComparative
    ? [
        { account: `PERIODO ${json.company.comparativePeriod}`, cells: [] },
        ...comparativeRows.map(rowToRow),
        { account: `PERIODO ${json.company.fiscalPeriod}`, cells: [] },
        ...ec.rows.map(rowToRow),
      ]
    : ec.rows.map(rowToRow);
  const legend = comparativeStatementLegend('equity', json);
  return {
    caption: 'Estado de Cambios en el Patrimonio',
    headers,
    rows,
    ...presentationMeta(json, 'period', ctx, ec.notes, hasComparative),
    ...(legend ? { legends: [legend] } : {}),
  };
}

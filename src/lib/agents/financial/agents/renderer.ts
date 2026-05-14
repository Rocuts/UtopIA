// ---------------------------------------------------------------------------
// Renderer determinístico JSON-strict -> Markdown legacy
// ---------------------------------------------------------------------------
//
// El NIIF Analyst (y, gradualmente, los demás agentes financieros) producen
// JSON validado por Zod en lugar de Markdown. Los renderers downstream que
// todavía esperan strings Markdown — PDF Élite (`StatementsPages.tsx`),
// Excel export (`excel-export.ts`), validators v1 — consumen las funciones
// de este archivo para mantener compatibilidad durante Fases 1 + 2.
//
// En Fase 3 los renderers se migran a consumir JSON puro y este adapter
// se vuelve opcional. Por ahora es el puente que permite refactorizar los
// prompts sin romper main.
//
// Reglas:
//   - Las cifras se renderizan en PRESENTACIÓN COP colombiana con punto de
//     miles y coma decimal (helper `formatCopFromCents`).
//   - Valores absolutos cuando `isAbsolute === true` (regla NIIF Analyst para
//     Balance y P&G). Cuando false, negativos van entre paréntesis (convención
//     NIIF Markdown).
//   - El renderer es PURO — sin LLM, sin side-effects.
//
// Wave 6.F4 (v2.1 corrección 1, 2026-05-13): los 4 renderers ahora producen
// tablas Markdown REALES (GFM tables) en lugar del formato inline pipe-
// separated del MVP (`label : $X | $Y`). El formato inline causaba el error
// presentacional del informe del 13-may-2026 — el renderer del PDF Élite ya
// parseaba GFM (`parseStatementTable` en `compose.ts`) pero el output legacy
// se mostraba inline al usuario en otras superficies. Las tablas se construyen
// con el helper `buildMarkdownTable` que enforza:
//   - Header row con nombres de columna ("Rubro", "YYYY", "YYYY-1").
//   - Separator con alineación: `:---` (left) para rubros, `---:` (right) para
//     cifras. El parser PDF Élite ya tolera ambas.
//   - Filas con `| label | $X | $Y |`.
//   - Totales/subtotales en `**negrita**`, categorías en `**MAYÚSCULAS**`.
//   - Indentación: 2 espacios antes del label en sub-líneas.
// ---------------------------------------------------------------------------

import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import type { NiifReportJson } from '../contracts/niif-report';
import type { StatementLineJson, StatementNoteJson } from '../contracts/base';
import type { NiifAnalysisResult } from '../types';

// ---------------------------------------------------------------------------
// Helper: construir tabla Markdown GFM
// ---------------------------------------------------------------------------

interface MarkdownTableRow {
  /** Label de la primera columna. Puede contener `**negrita**` o indentación. */
  label: string;
  /** Cifras de las columnas siguientes (ya formateadas como string). */
  values: string[];
  /** Si true, envuelve TODAS las celdas en `**...**` (totales/subtotales). */
  bold?: boolean;
}

interface MarkdownTableSpec {
  /** Encabezados de columna. La primera es el rubro, las demás son periodos. */
  headers: string[];
  /** Alineación por columna: 'left' produce `:---`, 'right' produce `---:`. */
  alignment: ('left' | 'right')[];
  /** Filas en orden de presentación. */
  rows: MarkdownTableRow[];
}

/**
 * Construye una tabla Markdown GFM con header + separator alineado + rows.
 *
 * Output canónico (ejemplo Balance):
 *
 * ```
 * | Rubro                            |         2025         |         2024         |
 * |:---------------------------------|---------------------:|---------------------:|
 * | **ACTIVO**                       |                      |                      |
 * |   11 — Efectivo y equivalentes   | $2.413.677.888,64    | $1.563.485.554,01    |
 * | **TOTAL ACTIVO**                 | **$4.196.558.242,90**| **$2.820.294.796,28**|
 * ```
 *
 * El parser `parseStatementTable` (PDF Élite) detecta el header por la presencia
 * del separator (regex `^\|[\s:|-]+\|$`), así que cumplir el formato GFM es
 * suficiente para que tanto el viewer Markdown como el PDF Élite lo procesen
 * correctamente.
 */
function buildMarkdownTable(spec: MarkdownTableSpec): string {
  const { headers, alignment, rows } = spec;
  if (headers.length !== alignment.length) {
    throw new Error(
      `buildMarkdownTable: headers (${headers.length}) y alignment (${alignment.length}) deben tener la misma longitud`,
    );
  }

  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${alignment
    .map((a) => (a === 'left' ? ':---' : '---:'))
    .join(' | ')} |`;

  const dataRows = rows.map((r) => {
    const cells = [r.label, ...r.values];
    if (cells.length !== headers.length) {
      throw new Error(
        `buildMarkdownTable: row "${r.label}" tiene ${cells.length} celdas pero header tiene ${headers.length}`,
      );
    }
    if (r.bold) {
      return `| ${cells.map((c) => `**${c}**`).join(' | ')} |`;
    }
    return `| ${cells.join(' | ')} |`;
  });

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

// ---------------------------------------------------------------------------
// Conversión de StatementLine → MarkdownTableRow
// ---------------------------------------------------------------------------

/**
 * Convierte una línea de estado financiero en una row de tabla Markdown.
 *
 * Reglas:
 *   - `level >= 3` → bold (subtotal/total). Categorías sección (level 0) usan
 *     bold + MAYÚSCULAS por convención del label upstream.
 *   - `level >= 2` se indenta con 2 espacios (sub-líneas de detalle/subgrupo).
 *     Level 0/1 son secciones — sin indent.
 *   - El label se prefija con el código PUC si existe (`11 — Efectivo`).
 *   - Las cifras se formatean con `formatCopFromCents(parseMoneyCop(...))` —
 *     SIEMPRE produce `$X.XXX.XXX,XX` (es-CO). Negativos entre paréntesis
 *     cuando `isAbsolute === false`.
 */
function lineToTableRow(
  line: StatementLineJson,
  hasComparative: boolean,
): MarkdownTableRow {
  const cents = parseMoneyCop(line.amountPrimary);
  const primary = formatCopFromCents(cents, line.isAbsolute);
  const comparative =
    line.amountComparative !== null
      ? formatCopFromCents(parseMoneyCop(line.amountComparative), line.isAbsolute)
      : '';

  const baseLabel = line.account ? `${line.account} — ${line.label}` : line.label;
  // Indentación: 2 espacios para subgrupos/detalle (level 2), sin indent para
  // secciones (level 0/1) ni para totales (level 3/4 que ya van en bold).
  const indent = line.level === 2 ? '  ' : '';
  const label = `${indent}${baseLabel}`;

  const values = hasComparative ? [primary, comparative] : [primary];
  return {
    label,
    values,
    bold: line.level >= 3,
  };
}

// ---------------------------------------------------------------------------
// Notas (formato inalterado — no van en tabla)
// ---------------------------------------------------------------------------

function renderNote(note: StatementNoteJson, idx: number): string {
  const ref = note.ref ?? `Nota ${idx + 1}`;
  const norma = note.norma ? ` (${note.norma})` : '';
  return `- **${ref}${norma}** ${note.body}`;
}

function renderNotes(notes: readonly StatementNoteJson[], title = 'Notas'): string {
  if (notes.length === 0) return '';
  return [`\n#### ${title}\n`, ...notes.map((n, i) => renderNote(n, i))].join('\n');
}

// ---------------------------------------------------------------------------
// Renderers por estado financiero
// ---------------------------------------------------------------------------

export function renderBalanceSheet(json: NiifReportJson): string {
  const { balanceSheet: b, company } = json;
  const hasComparative = company.comparativePeriod !== null;
  const periodLabel = company.fiscalPeriod;
  const comparativeLabel = company.comparativePeriod ?? '';

  const header = [
    `### Estado de Situación Financiera`,
    `**${company.name}** — NIT ${company.nit}`,
    `Al 31 de diciembre de ${periodLabel}${hasComparative ? ` (comparativo ${comparativeLabel})` : ''}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  // Filas: categoría ACTIVO + assets + categoría PASIVO + liabilities + equity + totales
  const rows: MarkdownTableRow[] = [];

  // Sección ACTIVO
  rows.push({ label: '**ACTIVO**', values: hasComparative ? ['', ''] : [''] });
  for (const line of b.assets) {
    rows.push(lineToTableRow(line, hasComparative));
  }
  rows.push({
    label: 'TOTAL ACTIVOS',
    values: hasComparative
      ? [
          formatCopFromCents(parseMoneyCop(b.totalAssetsPrimary), true),
          b.totalAssetsComparative !== null
            ? formatCopFromCents(parseMoneyCop(b.totalAssetsComparative), true)
            : '',
        ]
      : [formatCopFromCents(parseMoneyCop(b.totalAssetsPrimary), true)],
    bold: true,
  });

  // Sección PASIVO
  rows.push({ label: '**PASIVO**', values: hasComparative ? ['', ''] : [''] });
  for (const line of b.liabilities) {
    rows.push(lineToTableRow(line, hasComparative));
  }
  rows.push({
    label: 'TOTAL PASIVOS',
    values: hasComparative
      ? [
          formatCopFromCents(parseMoneyCop(b.totalLiabilitiesPrimary), true),
          b.totalLiabilitiesComparative !== null
            ? formatCopFromCents(parseMoneyCop(b.totalLiabilitiesComparative), true)
            : '',
        ]
      : [formatCopFromCents(parseMoneyCop(b.totalLiabilitiesPrimary), true)],
    bold: true,
  });

  // Sección PATRIMONIO
  rows.push({ label: '**PATRIMONIO**', values: hasComparative ? ['', ''] : [''] });
  for (const line of b.equity) {
    rows.push(lineToTableRow(line, hasComparative));
  }
  rows.push({
    label: 'Total patrimonio',
    values: hasComparative
      ? [
          formatCopFromCents(parseMoneyCop(b.totalEquityPrimary), true),
          b.totalEquityComparative !== null
            ? formatCopFromCents(parseMoneyCop(b.totalEquityComparative), true)
            : '',
        ]
      : [formatCopFromCents(parseMoneyCop(b.totalEquityPrimary), true)],
    bold: true,
  });

  // Fila de cierre A = P + C (corrección v2.3 — ecuación patrimonial visible).
  // Suma Pasivo + Patrimonio por período y verifica contra Total Activo con
  // tolerancia de $100 (10.000 centavos). Si cuadra, prefija "✅"; si hay
  // descuadre, prefija "⚠" y agrega "(DESCUADRE: $X)" en la celda afectada
  // para que el lector lo detecte sin abrir el PDF/Excel.
  const TOLERANCE_CENTS = BigInt(10000);
  const liabPrimary = parseMoneyCop(b.totalLiabilitiesPrimary);
  const eqPrimary = parseMoneyCop(b.totalEquityPrimary);
  const sumPrimary = liabPrimary + eqPrimary;
  const assetsPrimary = parseMoneyCop(b.totalAssetsPrimary);
  const diffPrimary = sumPrimary - assetsPrimary;
  const absDiffPrimary = diffPrimary < BigInt(0) ? -diffPrimary : diffPrimary;
  const cuadraPrimary = absDiffPrimary <= TOLERANCE_CENTS;

  let cuadraComparative = true;
  let comparativeCell = '';
  if (hasComparative) {
    if (b.totalLiabilitiesComparative !== null && b.totalEquityComparative !== null) {
      const liabComp = parseMoneyCop(b.totalLiabilitiesComparative);
      const eqComp = parseMoneyCop(b.totalEquityComparative);
      const sumComp = liabComp + eqComp;
      const sumCompStr = formatCopFromCents(sumComp, true);
      if (b.totalAssetsComparative !== null) {
        const assetsComp = parseMoneyCop(b.totalAssetsComparative);
        const diffComp = sumComp - assetsComp;
        const absDiffComp = diffComp < BigInt(0) ? -diffComp : diffComp;
        cuadraComparative = absDiffComp <= TOLERANCE_CENTS;
        comparativeCell = cuadraComparative
          ? sumCompStr
          : `${sumCompStr} (DESCUADRE: ${formatCopFromCents(absDiffComp, true)})`;
      } else {
        comparativeCell = sumCompStr;
      }
    }
  }

  const sumPrimaryStr = formatCopFromCents(sumPrimary, true);
  const primaryCell = cuadraPrimary
    ? sumPrimaryStr
    : `${sumPrimaryStr} (DESCUADRE: ${formatCopFromCents(absDiffPrimary, true)})`;
  const cuadraAmbos = cuadraPrimary && cuadraComparative;
  const closingLabel = cuadraAmbos
    ? '✅ TOTAL PASIVO + PATRIMONIO'
    : '⚠ TOTAL PASIVO + PATRIMONIO';

  // Separador visual (fila vacía) antes de la línea de cierre.
  rows.push({ label: '', values: hasComparative ? ['', ''] : [''] });
  rows.push({
    label: closingLabel,
    values: hasComparative ? [primaryCell, comparativeCell] : [primaryCell],
    bold: true,
  });

  const headers = hasComparative
    ? ['Rubro', periodLabel, comparativeLabel]
    : ['Rubro', periodLabel];
  const alignment: ('left' | 'right')[] = hasComparative
    ? ['left', 'right', 'right']
    : ['left', 'right'];

  const table = buildMarkdownTable({ headers, alignment, rows });

  // Nota de descuadre (corrección v2.3) — solo si tolerance ±$100 superada.
  const descuadreNote = !cuadraAmbos
    ? `\n> ⚠ **El balance presenta un descuadre.** ${
        !cuadraPrimary
          ? `Período ${periodLabel}: diferencia de ${formatCopFromCents(absDiffPrimary, true)} entre TOTAL ACTIVO y TOTAL PASIVO + PATRIMONIO. `
          : ''
      }Revisar saldos antes de publicar.`
    : '';

  return [header, table, descuadreNote, renderNotes(b.notes)].filter(Boolean).join('\n');
}

export function renderIncomeStatement(json: NiifReportJson): string {
  const { incomeStatement: p, company } = json;
  const hasComparative = company.comparativePeriod !== null;
  const periodLabel = company.fiscalPeriod;
  const comparativeLabel = company.comparativePeriod ?? '';

  const header = [
    `### Estado de Resultados Integral`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${periodLabel}${hasComparative ? ` (comparativo ${comparativeLabel})` : ''}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  const rows: MarkdownTableRow[] = [];
  for (const line of p.lines) {
    rows.push(lineToTableRow(line, hasComparative));
  }

  // Totales canónicos del P&L — siempre en negrita
  const totals: { label: string; primary: string; comparative: string | null }[] = [
    {
      label: 'UTILIDAD BRUTA',
      primary: p.grossProfitPrimary,
      comparative: p.grossProfitComparative,
    },
    {
      label: 'UTILIDAD OPERATIVA (EBIT)',
      primary: p.operatingProfitPrimary,
      comparative: p.operatingProfitComparative,
    },
    {
      label: 'UTILIDAD NETA DEL PERÍODO',
      primary: p.netIncomePrimary,
      comparative: p.netIncomeComparative,
    },
    {
      label: 'OTRO RESULTADO INTEGRAL (ORI)',
      primary: p.oriPrimary,
      comparative: p.oriComparative,
    },
  ];
  for (const t of totals) {
    rows.push({
      label: t.label,
      values: hasComparative
        ? [
            formatCopFromCents(parseMoneyCop(t.primary), true),
            t.comparative !== null
              ? formatCopFromCents(parseMoneyCop(t.comparative), true)
              : '',
          ]
        : [formatCopFromCents(parseMoneyCop(t.primary), true)],
      bold: true,
    });
  }

  const headers = hasComparative
    ? ['Rubro', periodLabel, comparativeLabel]
    : ['Rubro', periodLabel];
  const alignment: ('left' | 'right')[] = hasComparative
    ? ['left', 'right', 'right']
    : ['left', 'right'];

  const table = buildMarkdownTable({ headers, alignment, rows });

  return [header, table, renderNotes(p.notes)].join('\n');
}

export function renderCashFlowStatement(json: NiifReportJson): string {
  const { cashFlow: cf, company } = json;
  const sectionTitle: Record<typeof cf.sections[number]['section'], string> = {
    operating: 'ACTIVIDADES DE OPERACIÓN',
    investing: 'ACTIVIDADES DE INVERSIÓN',
    financing: 'ACTIVIDADES DE FINANCIAMIENTO',
  };

  const periodLabel = company.fiscalPeriod;

  const header = [
    `### Estado de Flujos de Efectivo (Método Indirecto — NIC 7 / Sec. 7 PYMES)`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${periodLabel}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  // Tabla principal: una sola tabla con 3 secciones agrupadas por categoría.
  // Cada sección tiene un row de categoría (en bold) + sus líneas + flujo neto.
  // El EFE no usa comparativo en este pipeline (cf.sections solo expone primary).
  const rows: MarkdownTableRow[] = [];
  for (const s of cf.sections) {
    rows.push({ label: `**${sectionTitle[s.section]}**`, values: [''] });
    for (const line of s.lines) {
      rows.push(lineToTableRow(line, false));
    }
    rows.push({
      label: `FLUJO NETO ${sectionTitle[s.section]}`,
      values: [formatCopFromCents(parseMoneyCop(s.netFlow), false)],
      bold: true,
    });
  }

  // Closure: aumento neto + saldo apertura + saldo cierre
  rows.push({
    label: 'AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO',
    values: [formatCopFromCents(parseMoneyCop(cf.netChange), false)],
    bold: true,
  });
  rows.push({
    label: 'Efectivo al inicio del período',
    values: [formatCopFromCents(parseMoneyCop(cf.cashOpening), true)],
  });
  rows.push({
    label: 'EFECTIVO AL FINAL DEL PERÍODO',
    values: [formatCopFromCents(parseMoneyCop(cf.cashClosing), true)],
    bold: true,
  });

  const table = buildMarkdownTable({
    headers: ['Rubro', periodLabel],
    alignment: ['left', 'right'],
    rows,
  });

  return [header, table].join('\n');
}

export function renderEquityChanges(json: NiifReportJson): string {
  const { equityChanges: ec, company } = json;
  const header = [
    `### Estado de Cambios en el Patrimonio`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${company.fiscalPeriod}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  // ECP es matricial: filas = movimientos, columnas = rubros patrimoniales.
  // Mantenemos las 8 columnas + label + total — formato GFM con alignment.
  const ecpHeaders = [
    'Movimiento',
    'Capital',
    'Prima',
    'Reserva Legal',
    'Otras Reservas',
    'Result. Acumulados',
    'Result. Ejercicio',
    'ORI',
    'TOTAL',
  ];
  const ecpAlignment: ('left' | 'right')[] = [
    'left',
    'right',
    'right',
    'right',
    'right',
    'right',
    'right',
    'right',
    'right',
  ];

  // v2.5: ECP preserva signo (las disminuciones de patrimonio se muestran con
  // paréntesis). Aplica a la fila prior_period_result_cancellation que lleva
  // resultadoEjercicio negativo, dividend_distribution con dividendos pagados,
  // y resultadosAcumulados negativos (pérdidas acumuladas).
  const rows: MarkdownTableRow[] = ec.rows.map((r) => {
    const values = [
      formatCopFromCents(parseMoneyCop(r.capitalSocial)),
      formatCopFromCents(parseMoneyCop(r.primaColocacion)),
      formatCopFromCents(parseMoneyCop(r.reservaLegal)),
      formatCopFromCents(parseMoneyCop(r.otrasReservas)),
      formatCopFromCents(parseMoneyCop(r.resultadosAcumulados)),
      formatCopFromCents(parseMoneyCop(r.resultadoEjercicio)),
      formatCopFromCents(parseMoneyCop(r.ori)),
      formatCopFromCents(parseMoneyCop(r.total)),
    ];
    const bold = r.kind === 'opening_balance' || r.kind === 'closing_balance';
    return { label: r.label, values, bold };
  });

  const table = buildMarkdownTable({
    headers: ecpHeaders,
    alignment: ecpAlignment,
    rows,
  });

  return [header, table, renderNotes(ec.notes)].join('\n');
}

export function renderTechnicalNotes(json: NiifReportJson): string {
  if (json.technicalNotes.length === 0) return '### Notas Técnicas\n\n_Sin observaciones técnicas._';
  return [`### Notas Técnicas`, '', ...json.technicalNotes.map((n, i) => renderNote(n, i))].join('\n');
}

// ---------------------------------------------------------------------------
// Adapter principal: NiifReportJson -> NiifAnalysisResult legacy
// ---------------------------------------------------------------------------

/**
 * Convierte el JSON estricto del NIIF Analyst al `NiifAnalysisResult` legacy
 * que consumen Strategy Director, Governance Specialist, PDF Élite y Excel
 * mientras se completan las Fases 2 y 3. Adapter puro.
 */
export function toNiifAnalysisResult(json: NiifReportJson): NiifAnalysisResult {
  const balanceSheet = renderBalanceSheet(json);
  const incomeStatement = renderIncomeStatement(json);
  const cashFlowStatement = renderCashFlowStatement(json);
  const equityChangesStatement = renderEquityChanges(json);
  const technicalNotes = renderTechnicalNotes(json);
  const fullContent = [
    balanceSheet,
    '',
    incomeStatement,
    '',
    cashFlowStatement,
    '',
    equityChangesStatement,
    '',
    technicalNotes,
  ].join('\n');
  return {
    balanceSheet,
    incomeStatement,
    cashFlowStatement,
    equityChangesStatement,
    technicalNotes,
    fullContent,
    // Exposición del JSON estricto para los consumers post-Fase-3 (PDF Élite,
    // Excel, validators). Los consumers legacy ignoran este campo.
    json,
  };
}

// ---------------------------------------------------------------------------
// Export helper para tests/herramientas (Wave 6.F4)
// ---------------------------------------------------------------------------
// Exportamos `buildMarkdownTable` para que tests unitarios y futuras
// herramientas internas puedan reutilizar el helper sin duplicar lógica de
// alineación + bold + validación.

export { buildMarkdownTable };
export type { MarkdownTableSpec, MarkdownTableRow };

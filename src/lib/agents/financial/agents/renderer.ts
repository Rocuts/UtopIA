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
import {
  cashFlowHasComparativeColumn,
  comparativeStatementLegend,
  incomeStatementPresentationRows,
  normalizeNiifStatementLabels,
  openingPygNotPresented,
  presentedLineCents,
} from '@/lib/export/statement-presentation';
import type { EquityChangeRowJson } from '../contracts/niif-report';
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

// ---------------------------------------------------------------------------
// Formateo de TOTALES canónicos
// ---------------------------------------------------------------------------
//
// Auditoría 2026-08 (P0 `perdida-y-patrimonio-negativo-se-imprimen-positivos`):
// los totales del Balance y del Estado de Resultados se formateaban con
// `absolute = true` hardcodeado. Consecuencia: una PÉRDIDA neta del ejercicio
// se imprimía idéntica a una utilidad de la misma magnitud, y un patrimonio
// negativo (causal de disolución del Art. 457 num. 2 C.Co. y bandera de empresa
// en marcha bajo NIA 570) aparecía como positivo.
//
// Los totales van SIEMPRE con signo. La convención NIIF encierra los negativos
// entre paréntesis, que es lo que `formatCopFromCents(cents, false)` produce.
//
// El valor absoluto se reserva para magnitudes que por definición no llevan
// signo — las brechas de descuadre, que son distancias.
//
// Las LÍNEAS de detalle siguen usando `line.isAbsolute` del contrato: ahí sí
// hay rubros que NIIF presenta en magnitud positiva (pasivos, por ejemplo).
const fmtTotal = (value: string): string =>
  formatCopFromCents(parseMoneyCop(value), false);

/** Magnitud sin signo — sólo para brechas y distancias. */
const fmtMagnitude = (cents: bigint): string => formatCopFromCents(cents, true);

/**
 * Marcador visible cuando el informe declara comparativo pero el renglón no
 * trae cifra del periodo anterior — el mismo "n/c" del PDF y del Excel. Una
 * celda vacía ocultaba el hueco y hacía que las superficies difirieran.
 */
const NO_COMPARATIVE_PLACEHOLDER = 'n/c';

/**
 * Convierte una línea de estado financiero en una row de tabla Markdown.
 *
 * Reglas:
 *   - `level >= 3` → bold (subtotal/total). Categorías sección (level 0) usan
 *     bold + MAYÚSCULAS por convención del label upstream.
 *   - `level >= 2` se indenta con 2 espacios (sub-líneas de detalle/subgrupo).
 *     Level 0/1 son secciones — sin indent.
 *   - El label se prefija con el código PUC si existe (`11 — Efectivo`).
 *   - Cifras SIEMPRE firmadas (paréntesis NIIF), igual que el PDF Élite y el
 *     Excel (reportes-export-01/-17). Antes se formateaban con `isAbsolute`,
 *     que borraba el signo de un renglón negativo marcado como absoluto e
 *     imprimía la depreciación acumulada (1592) en positivo: la columna no
 *     sumaba el total. En el ESF/ERI las correctoras en magnitud absoluta se
 *     presentan restando (`presentedLineCents`); en el EFE (`contraAware =
 *     false`) el importe ya viaja firmado como flujo — una depreciación que se
 *     suma en el método indirecto no se invierte.
 */
function lineToTableRow(
  line: StatementLineJson,
  hasComparative: boolean,
  contraAware = true,
): MarkdownTableRow {
  const fmt = (value: string): string => {
    const cents = parseMoneyCop(value);
    return formatCopFromCents(
      contraAware ? presentedLineCents(line.account, cents, line.isAbsolute) : cents,
      false,
    );
  };
  const primary = fmt(line.amountPrimary);
  const comparative =
    line.amountComparative !== null ? fmt(line.amountComparative) : NO_COMPARATIVE_PLACEHOLDER;

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
          fmtTotal(b.totalAssetsPrimary),
          b.totalAssetsComparative !== null
            ? fmtTotal(b.totalAssetsComparative)
            : NO_COMPARATIVE_PLACEHOLDER,
        ]
      : [fmtTotal(b.totalAssetsPrimary)],
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
          fmtTotal(b.totalLiabilitiesPrimary),
          b.totalLiabilitiesComparative !== null
            ? fmtTotal(b.totalLiabilitiesComparative)
            : NO_COMPARATIVE_PLACEHOLDER,
        ]
      : [fmtTotal(b.totalLiabilitiesPrimary)],
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
          fmtTotal(b.totalEquityPrimary),
          b.totalEquityComparative !== null
            ? fmtTotal(b.totalEquityComparative)
            : NO_COMPARATIVE_PLACEHOLDER,
        ]
      : [fmtTotal(b.totalEquityPrimary)],
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

  // P + C con signo (igual que el Excel): la magnitud se reserva a la brecha.
  const fmtSigned = (cents: bigint): string => formatCopFromCents(cents, false);
  let cuadraComparative = true;
  let comparativeCell = NO_COMPARATIVE_PLACEHOLDER;
  if (hasComparative) {
    if (b.totalLiabilitiesComparative !== null && b.totalEquityComparative !== null) {
      const liabComp = parseMoneyCop(b.totalLiabilitiesComparative);
      const eqComp = parseMoneyCop(b.totalEquityComparative);
      const sumComp = liabComp + eqComp;
      const sumCompStr = fmtSigned(sumComp);
      if (b.totalAssetsComparative !== null) {
        const assetsComp = parseMoneyCop(b.totalAssetsComparative);
        const diffComp = sumComp - assetsComp;
        const absDiffComp = diffComp < BigInt(0) ? -diffComp : diffComp;
        cuadraComparative = absDiffComp <= TOLERANCE_CENTS;
        comparativeCell = cuadraComparative
          ? sumCompStr
          : `${sumCompStr} (DESCUADRE: ${fmtMagnitude(absDiffComp)})`;
      } else {
        comparativeCell = sumCompStr;
      }
    }
  }

  const sumPrimaryStr = fmtSigned(sumPrimary);
  const primaryCell = cuadraPrimary
    ? sumPrimaryStr
    : `${sumPrimaryStr} (DESCUADRE: ${fmtMagnitude(absDiffPrimary)})`;
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
          ? `Período ${periodLabel}: diferencia de ${fmtMagnitude(absDiffPrimary)} entre TOTAL ACTIVO y TOTAL PASIVO + PATRIMONIO. `
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

  // Comparativo de saldos de apertura (ingesta-09): sin P&G del periodo
  // anterior la columna comparativa del ERI es N/D, como en el PDF y el Excel.
  const pygNd = hasComparative && openingPygNotPresented(p);
  const rows: MarkdownTableRow[] = [];
  // Misma regla que el PDF Élite y el Excel (`incomeStatementPresentationRows`,
  // auditoría 2026-09-24 e2e-niif-01): los escalones de la cascada se imprimen
  // SIEMPRE desde los campos anclados del JSON (PÉRDIDA cuando el total es
  // negativo, ORI y RESULTADO INTEGRAL TOTAL = neto + ORI); un renglón del
  // analista con rótulo de total no los sustituye ni se duplica.
  for (const r of incomeStatementPresentationRows(p)) {
    const row = r.total
      ? {
          label: r.label,
          values: hasComparative
            ? [
                fmtTotal(r.amountPrimary),
                r.amountComparative !== null ? fmtTotal(r.amountComparative) : NO_COMPARATIVE_PLACEHOLDER,
              ]
            : [fmtTotal(r.amountPrimary)],
          bold: true,
        }
      : lineToTableRow(
          {
            account: r.account,
            label: r.label,
            amountPrimary: r.amountPrimary,
            amountComparative: r.amountComparative,
            level: r.level as StatementLineJson['level'],
            isAbsolute: r.isAbsolute,
          },
          hasComparative,
        );
    if (pygNd) row.values[1] = 'N/D';
    rows.push(row);
  }

  const headers = hasComparative
    ? ['Rubro', periodLabel, comparativeLabel]
    : ['Rubro', periodLabel];
  const alignment: ('left' | 'right')[] = hasComparative
    ? ['left', 'right', 'right']
    : ['left', 'right'];

  const table = buildMarkdownTable({ headers, alignment, rows });
  const legend = pygNd
    ? `\n> Resultados comparativos ${comparativeLabel}: N/D — la columna ${comparativeLabel} es un saldo ` +
      'de apertura, no un cierre del periodo anterior; no hay estado de resultados de ese periodo.'
    : '';

  return [header, table, legend, renderNotes(p.notes)].filter((s, i) => i !== 2 || s).join('\n');
}

export function renderCashFlowStatement(json: NiifReportJson): string {
  const { cashFlow: cf, company } = json;
  const sectionTitle: Record<typeof cf.sections[number]['section'], string> = {
    operating: 'ACTIVIDADES DE OPERACIÓN',
    investing: 'ACTIVIDADES DE INVERSIÓN',
    financing: 'ACTIVIDADES DE FINANCIAMIENTO',
  };

  const periodLabel = company.fiscalPeriod;
  // Columna comparativa del EFE (auditoría 2026-09-24, pendiente #3): sólo
  // cuando el informe la trae completa — la calcula el código desde el corte
  // anterior al comparativo. Si no, la nota determinista de impracticabilidad.
  const comparativeLabel = company.comparativePeriod ?? '';
  const hasComparative = company.comparativePeriod !== null && cashFlowHasComparativeColumn(cf);

  const header = [
    `### Estado de Flujos de Efectivo (Método Indirecto — NIC 7 / Sec. 7 PYMES)`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${periodLabel}${hasComparative ? ` (comparativo ${comparativeLabel})` : ''}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  const flow = (value: string): string => formatCopFromCents(parseMoneyCop(value), false);
  const pair = (primary: string, comparative: string | null | undefined, fmt: (v: string) => string) =>
    hasComparative
      ? [fmt(primary), comparative !== null && comparative !== undefined ? fmt(comparative) : NO_COMPARATIVE_PLACEHOLDER]
      : [fmt(primary)];

  // Una sola tabla con 3 secciones agrupadas por categoría: fila de categoría
  // (en bold) + renglones + flujo neto.
  const rows: MarkdownTableRow[] = [];
  for (const s of cf.sections) {
    rows.push({ label: `**${sectionTitle[s.section]}**`, values: hasComparative ? ['', ''] : [''] });
    for (const line of s.lines) {
      rows.push(lineToTableRow(line, hasComparative, false));
    }
    rows.push({
      label: `FLUJO NETO ${sectionTitle[s.section]}`,
      values: pair(s.netFlow, s.netFlowComparative, flow),
      bold: true,
    });
  }

  // Closure: aumento neto + saldo apertura + saldo cierre
  rows.push({
    label: 'AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO',
    values: pair(cf.netChange, cf.netChangeComparative, flow),
    bold: true,
  });
  rows.push({
    label: 'Efectivo al inicio del período',
    values: pair(cf.cashOpening, cf.cashOpeningComparative, fmtTotal),
  });
  rows.push({
    label: 'EFECTIVO AL FINAL DEL PERÍODO',
    values: pair(cf.cashClosing, cf.cashClosingComparative, fmtTotal),
    bold: true,
  });

  const table = buildMarkdownTable({
    headers: hasComparative ? ['Rubro', periodLabel, comparativeLabel] : ['Rubro', periodLabel],
    alignment: hasComparative ? ['left', 'right', 'right'] : ['left', 'right'],
    rows,
  });

  const legend = comparativeStatementLegend('cashFlow', json);
  return [header, table, ...(legend ? [`\n> ${legend}`] : [])].join('\n');
}

export function renderEquityChanges(json: NiifReportJson): string {
  const { equityChanges: ec, company } = json;
  const comparativeRows = company.comparativePeriod !== null ? (ec.comparativeRows ?? []) : [];
  const hasComparative = comparativeRows.length > 0;
  const header = [
    `### Estado de Cambios en el Patrimonio`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${company.fiscalPeriod}${hasComparative ? ` (comparativo ${company.comparativePeriod})` : ''}`,
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
  const toRow = (r: EquityChangeRowJson): MarkdownTableRow => {
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
  };
  // Con comparativo (NIIF para las PYMES 3.14 / 6.3) los dos periodos se
  // presentan apilados en orden cronológico: el cierre del comparativo es la
  // apertura del periodo actual.
  const periodRow = (label: string): MarkdownTableRow => ({
    label: `**${label}**`,
    values: Array.from({ length: ecpHeaders.length - 1 }, () => ''),
  });
  const rows: MarkdownTableRow[] = hasComparative
    ? [
        periodRow(`Periodo ${company.comparativePeriod}`),
        ...comparativeRows.map(toRow),
        periodRow(`Periodo ${company.fiscalPeriod}`),
        ...ec.rows.map(toRow),
      ]
    : ec.rows.map(toRow);

  const table = buildMarkdownTable({
    headers: ecpHeaders,
    alignment: ecpAlignment,
    rows,
  });

  const legend = comparativeStatementLegend('equity', json);
  return [header, table, ...(legend ? [`\n> ${legend}`] : []), renderNotes(ec.notes)].join('\n');
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
export function toNiifAnalysisResult(source: NiifReportJson): NiifAnalysisResult {
  // Rótulos deterministas (auditoría 2026-09-24, e2e-niif-09), los mismos que
  // imprimen el PDF y el Excel. Sin tipo de periodo conocido se respetan las
  // fechas canónicas que ya fijó el orquestador.
  const json = normalizeNiifStatementLabels(source).json;
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

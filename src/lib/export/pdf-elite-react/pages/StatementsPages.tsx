// pages/StatementsPages.tsx — Balance / Income / Cash Flow / Equity statements.
//
// Split cream/forest layout matching ESLOP ref p.77 (balance) + p.78 (income).
// LEFT panel (cream, ~60%): full IFRS table with subtotal/total banding.
// RIGHT panel (forest, ~40%): abstraction view — grouped figures + bracket
//   connectors + group label + final total in SAND_500 Fraunces.
// Cash Flow + Equity: simpler full-width cream layout with forest summary band.
//
// Returns an ARRAY of 4 <Page> elements. Spread into <Document> children.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Page, View, Text, Svg, Path } from '@react-pdf/renderer';
import type { EditorialReport, ParsedTable, ParsedTableRow } from '../types';
import { statementCitations, type StatementKind } from '../../statement-presentation';
import {
  GoldRule,
  MixedWeightHeadline,
  NormativePill,
  NumberedSectionHeader,
  PageNumberBadge,
  TopoOrnament,
  TocAnchor,
} from '../primitives';
import {
  CHARCOAL_700,
  CHARCOAL_900,
  CREAM_0,
  CREAM_100,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  FOREST_700,
  FOREST_900,
  PAGE_BOTTOM_RESERVED,
  PAGE_MARGIN,
  PAGE_W,
  R_PILL,
  S1,
  S2,
  S3,
  S4,
  S5,
  SAGE_300,
  SAGE_400,
  SAND_300,
  SAND_400,
  SAND_500,
  TYPE_BODY,
  TYPE_CAPTION,
  TYPE_LEAD,
  TYPE_SMALL,
} from '../tokens';

// ─── Layout constants ────────────────────────────────────────────────────────
// Reserva inferior de las páginas de estados: GoldRule (14pt) + PageNumberBadge
// (20pt + 24pt de diámetro) caben en PAGE_BOTTOM_RESERVED. Antes se reservaban
// 104pt y un estado que casi llenaba la hoja dejaba sola su banda de totales (o
// el total del panel derecho) en una página siguiente casi vacía
// (reportes-export-21).
const BOTTOM_PAD = PAGE_BOTTOM_RESERVED + S2;
/**
 * Máximo de cifras sueltas en el panel derecho. Con más, el panel muestra sólo
 * los grupos y sus totales (la tabla de la izquierda tiene todas las cifras):
 * las cifras sin tope desbordaban el panel a una página casi vacía.
 */
const PANEL_ROW_BUDGET = 8;
/**
 * La banda inferior de los estados de página completa repite totales que ya
 * están en la tabla. Con más renglones no cabe en la hoja: se partía entre dos
 * páginas o quedaba sola en una página casi vacía (reportes-export-21). Se
 * omite entonces; `wrap={false}` impide que se parta.
 */
const BAND_MAX_ROWS = 10;
// Total content width = PAGE_W (842). We use full-bleed for the forest panel so
// there is no right margin on the forest side.
const LEFT_W = Math.round(PAGE_W * 0.60);  // 505pt — cream side
const RIGHT_W = PAGE_W - LEFT_W;           // 337pt — forest side

// Left panel has a standard left margin; the table gets the remaining width.
const LEFT_MARGIN = PAGE_MARGIN;
const LEFT_CONTENT_W = LEFT_W - LEFT_MARGIN - S4;

// Right panel internal padding
const RIGHT_PAD_H = 28;
const RIGHT_CONTENT_W = RIGHT_W - RIGHT_PAD_H * 2;

// ─── Formatting helpers ──────────────────────────────────────────────────────
function formatNumber(s: string): string {
  // Pass through — values arrive pre-formatted from compose.ts.
  return s;
}

// ─── Table renderer (left panel) ─────────────────────────────────────────────
// `containerWidth` lets the caller render the same table at a narrow split-layout
// width (Balance / Income, ~441pt) OR at the full landscape content width
// (Cash Flow / Equity, ~746pt). The Equity statement carries 8 columns
// (MOVIMIENTO + 7 patrimonio components) and would collide at 441pt — see
// `FullStatementPage` for the wider call site.
function LeftTable({
  table,
  containerWidth = LEFT_CONTENT_W,
}: {
  table: ParsedTable;
  containerWidth?: number;
}) {
  const colCount = table.headers.length;
  // Account column shrinks as more value columns appear, so currency strings
  // never collide. ≥7 cols (equity statement) ⇒ 22%; 6 ⇒ 28%; 4–5 ⇒ 38%;
  // 3 ⇒ 48%; 2 ⇒ 56%.
  const accountPct =
    colCount >= 7 ? 0.22
    : colCount >= 6 ? 0.28
    : colCount >= 4 ? 0.38
    : colCount === 3 ? 0.48
    : 0.56;
  const accountW = Math.round(containerWidth * accountPct);
  const valW = colCount > 1
    ? Math.round((containerWidth - accountW) / (colCount - 1))
    : containerWidth;
  // Many-column tables (equity ≥6 cols) need smaller monospace + tighter
  // padding so $2.228.490.789,73 fits inside its column without overlapping
  // the next header. TYPE_SMALL=9pt monospace at 18 chars was ~99pt and
  // collided at the previous ~42pt valW; TYPE_CAPTION=8pt at ~77pt valW fits
  // comfortably for 7 value columns at full landscape width.
  const dense = colCount >= 6;
  const cellFontSize = dense ? TYPE_CAPTION : TYPE_SMALL;
  const headerFontSize = dense ? TYPE_CAPTION : TYPE_SMALL;
  const headerLetterSpacing = dense ? 0.2 : 0.6;
  const cellPadL = dense ? 3 : 6; // gutter between value columns

  return (
    <View style={{ flexDirection: 'column', width: containerWidth }}>
      {/* Column headers */}
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: FOREST_900,
          paddingBottom: S1,
          marginBottom: S1,
          alignItems: 'flex-end',
        }}
      >
        {table.headers.map((h, i) => (
          <Text
            key={`h${i}`}
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: headerFontSize,
              color: FOREST_900,
              letterSpacing: headerLetterSpacing,
              textTransform: 'uppercase',
              width: i === 0 ? accountW : valW,
              textAlign: i === 0 ? 'left' : 'right',
              paddingLeft: i === 0 ? 3 : cellPadL,
              paddingRight: 3,
              lineHeight: 1.15,
            }}
          >
            {h}
          </Text>
        ))}
      </View>

      {/* Rows */}
      {table.rows.map((row, ri) => {
        const isSubtotal = row.emphasis === 'subtotal';
        const isTotal = row.emphasis === 'total';
        const isGroupHeader = !row.cells.length || row.cells.every(c => !c || c === '-' || c === '');

        if (isGroupHeader && !isSubtotal && !isTotal) {
          // Section header row (e.g. "Activos corrientes", "PASIVOS Y PATRIMONIO")
          return (
            <View
              key={`row${ri}`}
              style={{ paddingTop: S3, paddingBottom: S1, paddingHorizontal: 3 }}
            >
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontWeight: 'bold',
                  fontSize: TYPE_BODY,
                  color: FOREST_700,
                }}
              >
                {row.account}
              </Text>
            </View>
          );
        }

        // Ecuación patrimonial (v2.2 #1): el título del bloque arranca con
        // ✅ (cuadra) o ⚠ (descuadre). Cambiamos el tono respecto al SAND_400
        // default de "total" para que sea visualmente distinto a TOTAL ACTIVOS /
        // TOTAL PATRIMONIO. El check usa un tinte sage (SAGE_500 @ ~18%); el
        // warning usa un tinte clay/wine (WINE_500 @ ~18%, inline porque no
        // hay CLAY_700 en tokens.ts y v2.2 pide minimum-blast-radius).
        const isEquationCheck = row.account.startsWith('✅');
        const isEquationWarn = row.account.startsWith('⚠');
        const isEquationTitle = isEquationCheck || isEquationWarn;

        const bgColor = isEquationCheck
          ? `rgba(90,143,123,0.18)` // SAGE_500 at ~18% opacity
          : isEquationWarn
            ? `rgba(160,72,85,0.18)` // WINE_500 at ~18% opacity
            : isTotal
              ? SAND_400
              : isSubtotal
                ? `rgba(229,210,171,0.28)` // SAND_300 at ~28% opacity
                : ri % 2 === 1
                  ? CREAM_100
                  : 'transparent';

        const borderTop = isEquationTitle
          ? { borderTopWidth: 1, borderTopColor: isEquationWarn ? '#722F37' : FOREST_700 }
          : isTotal
            ? { borderTopWidth: 1, borderTopColor: FOREST_900 }
            : isSubtotal
              ? { borderTopWidth: 0.5, borderTopColor: FOREST_700 }
              : {};

        // Color del texto del título de la ecuación: forest verde para ✅,
        // wine bordeaux para ⚠. El resto sigue el FOREST_900 por defecto.
        const accountTextColor = isEquationWarn ? '#722F37' : FOREST_900;

        return (
          <View
            key={`row${ri}`}
            style={{
              flexDirection: 'row',
              paddingVertical: 3,
              backgroundColor: bgColor,
              paddingHorizontal: 3,
              ...borderTop,
            }}
          >
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontWeight: isTotal || isSubtotal ? 'bold' : 'normal',
                fontSize: cellFontSize,
                color: accountTextColor,
                width: accountW,
                lineHeight: 1.25,
              }}
            >
              {row.account}
            </Text>
            {row.cells.map((cell, ci) => (
              <Text
                key={`c${ri}${ci}`}
                style={{
                  fontFamily: FONT_MONO,
                  fontWeight: isTotal || isSubtotal ? 'bold' : 'normal',
                  fontSize: cellFontSize,
                  color: isEquationWarn ? '#722F37' : CHARCOAL_900,
                  width: valW,
                  textAlign: 'right',
                  paddingLeft: cellPadL,
                  lineHeight: 1.25,
                }}
              >
                {cell}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

// ─── Statement identification (date / currency) + legends / notes ─────────────
// NIIF para las PYMES 3.23: fecha de cierre o periodo cubierto, moneda y
// redondeo, de forma destacada (reportes-export-14). Las leyendas (comparativo
// no presentado, reportes-export-13) y las notas estructuradas del JSON
// (reportes-export-11) van al pie del estado.
function StatementIdentification({ table }: { table: ParsedTable }) {
  if (!table.subtitle && !table.currencyNote) return null;
  return (
    <View style={{ marginTop: S2 }}>
      {table.subtitle ? (
        <Text style={{ fontFamily: FONT_SANS, fontWeight: 'bold', fontSize: TYPE_SMALL, color: CHARCOAL_900 }}>
          {table.subtitle}
        </Text>
      ) : null}
      {table.currencyNote ? (
        <Text style={{ fontFamily: FONT_SANS, fontSize: TYPE_CAPTION, color: CHARCOAL_700, marginTop: 2 }}>
          {table.currencyNote}
        </Text>
      ) : null}
    </View>
  );
}

function StatementFootnotes({ table }: { table: ParsedTable }) {
  const legends = table.legends ?? [];
  const notes = table.footnotes ?? [];
  if (legends.length === 0 && notes.length === 0) return null;
  return (
    <View style={{ marginTop: S3 }}>
      {legends.map((l, i) => (
        <Text
          key={`lg${i}`}
          style={{ fontFamily: FONT_SANS, fontStyle: 'italic', fontSize: TYPE_CAPTION, color: '#722F37', marginBottom: 2 }}
        >
          {l}
        </Text>
      ))}
      {notes.map((n, i) => (
        <Text
          key={`fn${i}`}
          style={{ fontFamily: FONT_SANS, fontSize: TYPE_CAPTION, color: CHARCOAL_700, marginBottom: 2 }}
        >
          {n}
        </Text>
      ))}
    </View>
  );
}

// ─── Bracket SVG (right panel) ───────────────────────────────────────────────
// Draws a square-cornered curly brace (} shape) on the right side of the
// figure column, pointing right toward the group label.
// height = total height of the bracket in pts.
function BracketSvg({ height, color }: { height: number; color: string }) {
  const w = 12;
  const mid = height / 2;
  const arm = Math.max(6, height * 0.18);
  // Path: top corner → vertical → midpoint nub → vertical → bottom corner
  const d = [
    `M ${w} 0`,
    `L ${w - 4} 0`,
    `Q ${2} 0 ${2} ${arm}`,
    `L ${2} ${mid - 4}`,
    `Q ${2} ${mid} ${0} ${mid}`,
    `Q ${2} ${mid} ${2} ${mid + 4}`,
    `L ${2} ${height - arm}`,
    `Q ${2} ${height} ${w - 4} ${height}`,
    `L ${w} ${height}`,
  ].join(' ');
  return (
    <Svg width={w} height={height}>
      <Path d={d} stroke={color} strokeWidth={0.8} fill="none" />
    </Svg>
  );
}

// ─── Abstraction figure row ───────────────────────────────────────────────────
interface AbstractionGroup {
  groupLabel: string;
  groupTotal: string;
  rows: string[]; // figure strings exactly as the table prints them
}

/**
 * Cifra del panel derecho: SIEMPRE la del periodo actual (`cells[0]`, el orden
 * que usan compose-statements-from-json y el renderer Markdown), con el signo
 * tal cual lo imprime la tabla (paréntesis para negativos).
 *
 * Auditoría 2026-09 (reportes-export-04): se tomaba `cells[cells.length - 1]`,
 * que en informes comparativos es la columna del periodo ANTERIOR, y se
 * anteponía "+ " a todo lo que no empezara por "-" — de modo que los negativos
 * entre paréntesis salían "+ ($2.000,00)" y los costos "+ $2.000,00".
 */
export function panelFigure(row: ParsedTableRow): string {
  return row.cells[0] ?? '';
}

export function buildAbstractionGroups(table: ParsedTable): AbstractionGroup[] {
  const groups: AbstractionGroup[] = [];
  let currentRows: string[] = [];
  let currentLabel = '';

  for (const row of table.rows) {
    const isGroupHeader = !row.cells.length || row.cells.every(c => !c || c === '-' || c === '');

    if (isGroupHeader && !row.emphasis) {
      // Flush prior group (if any non-empty rows)
      if (currentRows.length > 0 && currentLabel) {
        groups.push({ groupLabel: currentLabel, groupTotal: '', rows: currentRows });
      }
      currentLabel = row.account;
      currentRows = [];
      continue;
    }

    if (row.emphasis === 'total') {
      // Close current group with this total
      const val = panelFigure(row);
      if (currentRows.length > 0 || currentLabel) {
        groups.push({ groupLabel: currentLabel || row.account, groupTotal: val, rows: currentRows });
        currentRows = [];
        currentLabel = '';
      }
      continue;
    }

    if (row.emphasis === 'subtotal') {
      const val = panelFigure(row);
      if (currentRows.length > 0 && currentLabel) {
        groups.push({ groupLabel: currentLabel, groupTotal: val, rows: currentRows });
        currentRows = [];
        currentLabel = '';
      }
      continue;
    }

    // Regular row — current-period figure, printed exactly as the table does.
    const val = panelFigure(row);
    if (val && val !== '-') {
      currentRows.push(val);
    }
  }

  // Flush remaining
  if (currentRows.length > 0 && currentLabel) {
    groups.push({ groupLabel: currentLabel, groupTotal: '', rows: currentRows });
  }

  // Guarantee at least one group
  if (groups.length === 0) {
    const totalRow = table.rows.find(r => r.emphasis === 'total');
    if (totalRow) {
      groups.push({ groupLabel: totalRow.account, groupTotal: panelFigure(totalRow), rows: [] });
    }
  }

  return groups.slice(0, 5); // cap to keep visual balance
}

// ─── Right panel content ─────────────────────────────────────────────────────
function RightPanel({
  table,
  titleLead,
  titleEmphasis,
  caption,
  pills,
  finalTotal,
}: {
  table: ParsedTable;
  titleLead: string;
  titleEmphasis: string;
  caption: string;
  pills: Array<{ label: string }>;
  finalTotal?: string;
}) {
  const allGroups = buildAbstractionGroups(table);
  const figureCount = allGroups.reduce((acc, g) => acc + g.rows.length, 0);
  const groups =
    figureCount > PANEL_ROW_BUDGET ? allGroups.map((g) => ({ ...g, rows: [] as string[] })) : allGroups;

  // Derive finalTotal from last total row if not passed explicitly
  const derivedTotal = finalTotal ?? (() => {
    const r = [...table.rows].reverse().find(r => r.emphasis === 'total');
    return r ? panelFigure(r) : '';
  })();
  // El panel resume SÓLO el periodo actual: se rotula para que en un informe
  // comparativo no se lea como la columna del año anterior.
  const periodLabel = table.headers[1] ? `Cifras del periodo ${table.headers[1]}` : '';

  return (
    <View
      style={{
        width: RIGHT_W,
        paddingHorizontal: RIGHT_PAD_H,
        paddingTop: PAGE_MARGIN,
        flexDirection: 'column',
      }}
    >
      {/* Title */}
      <MixedWeightHeadline
        parts={[
          { text: titleLead, weight: 'light' },
          { text: titleEmphasis, weight: 'bold', highlight: true },
        ]}
        fontSize={22}
        tone="light-on-dark"
        highlightOpacity={0.3}
      />

      {/* Caption */}
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontStyle: 'italic',
          fontSize: TYPE_LEAD,
          color: SAGE_300,
          marginTop: S2,
          marginBottom: S4,
        }}
      >
        {caption}
      </Text>

      {/* Pills */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: periodLabel ? S2 : S5 }}>
        {pills.map((p, i) => (
          <NormativePill key={i} label={p.label} tone="sand-on-forest" />
        ))}
      </View>
      {periodLabel ? (
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: TYPE_SMALL,
            color: SAGE_300,
            letterSpacing: 0.4,
            marginBottom: S5,
          }}
        >
          {periodLabel}
        </Text>
      ) : null}

      {/* Abstraction groups */}
      <View style={{ flexDirection: 'column', gap: 20 }}>
        {groups.map((g, gi) => {
          const rowLineH = Math.round(TYPE_BODY * 1.6); // ≈16pt
          const bracketH = Math.max(rowLineH, g.rows.length * rowLineH);
          return (
            <View
              key={gi}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              {/* Figure column — line items only, no duplicated total */}
              <View style={{ flexDirection: 'column', flex: 1 }}>
                {g.rows.map((r, ri) => (
                  <Text
                    key={ri}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: TYPE_BODY,
                      color: `rgba(251,248,241,0.82)`, // CREAM_0 at 82%
                      lineHeight: 1.6,
                      textAlign: 'right',
                    }}
                  >
                    {r}
                  </Text>
                ))}
              </View>

              {/* Bracket connector */}
              {g.rows.length > 0 ? (
                <View>
                  <BracketSvg height={bracketH} color={SAND_300} />
                </View>
              ) : (
                <View style={{ width: 12 }} />
              )}

              {/* Group label + total (single source of truth for the total) */}
              <View
                style={{
                  width: RIGHT_CONTENT_W * 0.42,
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: FONT_SANS,
                    fontWeight: 'bold',
                    fontSize: TYPE_BODY,
                    color: `rgba(251,248,241,0.95)`,
                    letterSpacing: 0.4,
                  }}
                >
                  {g.groupLabel}
                </Text>
                {g.groupTotal ? (
                  <Text
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontWeight: 'bold',
                      fontSize: TYPE_LEAD,
                      color: SAND_500,
                      marginTop: 3,
                    }}
                  >
                    {g.groupTotal}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Final total */}
      {derivedTotal ? (
        <View
          style={{
            marginTop: S5,
            borderTopWidth: 0.5,
            borderTopColor: SAND_300,
            paddingTop: S3,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 'bold',
              fontSize: 22,
              color: SAND_500,
              textAlign: 'center',
            }}
          >
            {derivedTotal}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Split-layout statement page (Balance + Income) ──────────────────────────
interface SplitPageConfig {
  statementKey: 'balance' | 'income';
  pageIndex: string;   // "01.", "02."
  pageTitle: string;
  sectionHeaderTitle: string;
  titleLead: string;
  titleEmphasis: string;
  caption: string;
  pills: Array<{ label: string }>;
}

function SplitStatementPage({
  table,
  cfg,
  opensSection = false,
}: {
  table: ParsedTable;
  cfg: SplitPageConfig;
  /** El primer estado abre la sección en la tabla de contenido. */
  opensSection?: boolean;
}) {
  return (
    <Page
      size="A4"
      orientation="landscape"
      // Los márgenes superior e inferior van en la página, no en el panel:
      // con `minHeight: PAGE_H` y el relleno inferior dentro del panel, un
      // estado que casi llenaba la hoja empujaba ese relleno a una página
      // nueva en blanco (reportes-export-21). El relleno de la página se
      // repite bien en cada página física si el estado se parte.
      style={{
        backgroundColor: CREAM_0,
        flexDirection: 'row',
        paddingTop: PAGE_MARGIN,
        paddingBottom: BOTTOM_PAD,
      }}
    >
      {opensSection ? <TocAnchor id="statements" /> : null}
      {/* ── LEFT PANEL (cream) ───────────────────────────────────────────── */}
      <View
        style={{
          width: LEFT_W,
          paddingLeft: LEFT_MARGIN,
          paddingRight: S4,
          flexDirection: 'column',
        }}
      >
        {/* Section header banner */}
        <NumberedSectionHeader
          number={cfg.pageIndex}
          title={cfg.sectionHeaderTitle}
          bannerColor={FOREST_900}
        />
        <StatementIdentification table={table} />

        {/* Table */}
        <View style={{ marginTop: S3 }} wrap>
          <LeftTable table={table} />
          <StatementFootnotes table={table} />
        </View>
      </View>

      {/* ── RIGHT PANEL (forest) — full height ──────────────────────────── */}
      {/* Fondo `fixed` a toda la altura y contenido absoluto sin `bottom`: un
          absoluto que llega al margen inferior hace que react-pdf parta la
          página y emita otra casi en blanco (reportes-export-21). */}
      <View
        fixed
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: RIGHT_W, backgroundColor: FOREST_900 }}
      />
      <View style={{ position: 'absolute', top: 0, right: 0, width: RIGHT_W }}>
        <RightPanel
          table={table}
          titleLead={cfg.titleLead}
          titleEmphasis={cfg.titleEmphasis}
          caption={cfg.caption}
          pills={cfg.pills}
        />
      </View>

      {/* ── FOOTER (spans full width, over the seam) ────────────────────── */}
      <GoldRule />
      <PageNumberBadge />
    </Page>
  );
}

// ─── Full-width statement page (Cash Flow + Equity) ──────────────────────────
interface FullPageConfig {
  pageIndex: string;
  sectionHeaderTitle: string;
  caption: string;
  pills: Array<{ label: string }>;
  /**
   * Celda que resume cada total en la banda inferior: `period` = la del
   * periodo actual (`cells[0]`, EFE con columna comparativa); `rowTotal` = la
   * última (columna TOTAL del ECP matricial).
   */
  bandCell: 'period' | 'rowTotal';
}

/**
 * Totales de la banda inferior: los del periodo actual. En el ECP con
 * comparativo los dos periodos van apilados bajo encabezados sin cifras; la
 * banda toma sólo los totales del último bloque (el periodo actual), y en el
 * EFE la cifra del periodo actual, no la columna comparativa (la misma regla
 * del panel de los estados divididos, reportes-export-04).
 */
export function summaryBandRows(
  table: ParsedTable,
  bandCell: FullPageConfig['bandCell'],
): Array<{ account: string; value: string }> {
  const isPlainHeader = (r: ParsedTableRow) =>
    !r.emphasis && (r.cells.length === 0 || r.cells.every((c) => !c || c === '-'));
  let lastHeader = -1;
  table.rows.forEach((r, i) => {
    if (isPlainHeader(r)) lastHeader = i;
  });
  return table.rows
    .slice(lastHeader + 1)
    .filter((r) => r.emphasis === 'total')
    .slice(0, 3)
    .map((r) => ({
      account: r.account,
      value: (bandCell === 'period' ? r.cells[0] : r.cells[r.cells.length - 1]) || '—',
    }));
}

function FullStatementPage({
  table,
  cfg,
}: {
  table: ParsedTable;
  cfg: FullPageConfig;
}) {
  // Build a forest summary band from the current-period total rows
  const totalRows = summaryBandRows(table, cfg.bandCell);

  // Use the full landscape content width (≈746pt) instead of the split-layout
  // LEFT_CONTENT_W (≈441pt). The Equity statement has 8 columns and was
  // overflowing inside the narrower width — currency strings collided with the
  // next column header.
  const fullContentW = PAGE_W - PAGE_MARGIN * 2;

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: CREAM_0,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: BOTTOM_PAD,
      }}
    >
      {/* Section header */}
      <NumberedSectionHeader
        number={cfg.pageIndex}
        title={cfg.sectionHeaderTitle}
        bannerColor={FOREST_900}
      />

      {/* Caption + pills */}
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontStyle: 'italic',
          fontSize: TYPE_LEAD,
          color: CHARCOAL_700,
          marginTop: S2,
          marginBottom: S2,
        }}
      >
        {cfg.caption}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: S2 }}>
        {cfg.pills.map((p, i) => (
          <NormativePill key={i} label={p.label} tone="sage-on-cream" />
        ))}
      </View>
      <View style={{ marginBottom: S4 }}>
        <StatementIdentification table={table} />
      </View>

      {/* Table */}
      <View wrap>
        <LeftTable table={table} containerWidth={fullContentW} />
        <StatementFootnotes table={table} />
      </View>

      {/* Forest summary band at the bottom */}
      {totalRows.length > 0 && table.rows.length <= BAND_MAX_ROWS && (
        <View
          wrap={false}
          style={{
            marginTop: S4,
            backgroundColor: FOREST_900,
            borderRadius: 8,
            padding: S4,
            flexDirection: 'row',
            gap: S5,
          }}
        >
          {totalRows.map((tr, i) => (
            <View key={i} style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: TYPE_CAPTION,
                  color: SAGE_300,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  marginBottom: 3,
                }}
              >
                {tr.account}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 'bold',
                  fontSize: TYPE_LEAD,
                  color: SAND_400,
                }}
              >
                {tr.value}
              </Text>
            </View>
          ))}
        </View>
      )}

      <GoldRule />
      <PageNumberBadge />
    </Page>
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────
interface Props {
  doc: EditorialReport;
}

/**
 * Returns an array of 4 <Page> elements:
 *   [0] Balance Sheet      — split cream/forest
 *   [1] Income Statement   — split cream/forest
 *   [2] Cash Flow          — full-width cream
 *   [3] Equity Changes     — full-width cream
 *
 * Spread into <Document> children:
 *   {StatementsPages({ doc })}
 */
export function StatementsPages({ doc }: Props): React.ReactElement[] {
  const { balance, income, cashFlow, equity } = doc.statements;
  // Citas según el grupo NIIF de la empresa (reportes-export-16): Secciones
  // 4/5/7/6 de NIIF para las PYMES o NIC 1/NIC 7 para Grupo 1 — nunca NIIF 1,
  // 5, 6 o 7, que regulan otras materias.
  const pillsFor = (kind: StatementKind) =>
    statementCitations(kind, doc.meta.niifGroup).map((label) => ({ label }));

  return [
    // ── Balance ──────────────────────────────────────────────────────────────
    <SplitStatementPage
      key="balance"
      table={balance}
      opensSection
      cfg={{
        statementKey: 'balance',
        pageIndex: '01.',
        pageTitle: 'Estado de Situación Financiera',
        sectionHeaderTitle: 'ESTADO DE SITUACIÓN FINANCIERA',
        titleLead: 'Estado de',
        titleEmphasis: 'situación financiera',
        caption: 'Activos, pasivos y patrimonio a la fecha de corte',
        pills: [...pillsFor('balance'), { label: 'Art. 35 Ley 222/95' }],
      }}
    />,

    // ── Income Statement ──────────────────────────────────────────────────────
    <SplitStatementPage
      key="income"
      table={income}
      cfg={{
        statementKey: 'income',
        pageIndex: '02.',
        pageTitle: 'Estado de Resultados Integrales',
        sectionHeaderTitle: 'ESTADO DE RESULTADOS INTEGRALES',
        titleLead: 'Estado de',
        titleEmphasis: 'resultados integrales',
        caption: 'Resultado del periodo y otro resultado integral',
        pills: pillsFor('income'),
      }}
    />,

    // ── Cash Flow ─────────────────────────────────────────────────────────────
    <FullStatementPage
      key="cashflow"
      table={cashFlow}
      cfg={{
        pageIndex: '03.',
        sectionHeaderTitle: 'ESTADO DE FLUJOS DE EFECTIVO',
        caption: 'Entradas y salidas de efectivo por actividades de operación, inversión y financiación',
        pills: pillsFor('cashFlow'),
        bandCell: 'period',
      }}
    />,

    // ── Equity Changes ────────────────────────────────────────────────────────
    <FullStatementPage
      key="equity"
      table={equity}
      cfg={{
        pageIndex: '04.',
        sectionHeaderTitle: 'CAMBIOS EN EL PATRIMONIO',
        caption: 'Variación en el patrimonio neto',
        pills: pillsFor('equity'),
        bandCell: 'rowTotal',
      }}
    />,
  ];
}

// Named export for snapshot tests that render a single statement page.
export { SplitStatementPage as StatementPage };

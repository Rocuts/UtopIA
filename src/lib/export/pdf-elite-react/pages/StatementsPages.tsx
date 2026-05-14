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
import {
  GoldRule,
  MixedWeightHeadline,
  NormativePill,
  NumberedSectionHeader,
  PageNumberBadge,
  TopoOrnament,
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
  PAGE_H,
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
function LeftTable({ table }: { table: ParsedTable }) {
  const colCount = table.headers.length;
  // Account column shrinks as more value columns appear, so currency strings
  // never collide. 2 cols ⇒ 56%; 3 cols ⇒ 48%; 4 cols ⇒ 42%.
  const accountPct = colCount >= 4 ? 0.42 : colCount === 3 ? 0.48 : 0.56;
  const accountW = Math.round(LEFT_CONTENT_W * accountPct);
  const valW = colCount > 1
    ? Math.round((LEFT_CONTENT_W - accountW) / (colCount - 1))
    : LEFT_CONTENT_W;
  const cellPadL = 6; // gutter between value columns

  return (
    <View style={{ flexDirection: 'column', width: LEFT_CONTENT_W }}>
      {/* Column headers */}
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: FOREST_900,
          paddingBottom: S1,
          marginBottom: S1,
        }}
      >
        {table.headers.map((h, i) => (
          <Text
            key={`h${i}`}
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: TYPE_SMALL,
              color: FOREST_900,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              width: i === 0 ? accountW : valW,
              textAlign: i === 0 ? 'left' : 'right',
              paddingLeft: i === 0 ? 3 : cellPadL,
              paddingRight: 3,
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

        const bgColor = isTotal
          ? SAND_400
          : isSubtotal
            ? `rgba(229,210,171,0.28)` // SAND_300 at ~28% opacity
            : ri % 2 === 1
              ? CREAM_100
              : 'transparent';

        const borderTop = isTotal
          ? { borderTopWidth: 1, borderTopColor: FOREST_900 }
          : isSubtotal
            ? { borderTopWidth: 0.5, borderTopColor: FOREST_700 }
            : {};

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
                fontSize: TYPE_SMALL,
                color: FOREST_900,
                width: accountW,
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
                  fontSize: TYPE_SMALL,
                  color: CHARCOAL_900,
                  width: valW,
                  textAlign: 'right',
                  paddingLeft: cellPadL,
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
  rows: string[]; // sign-prefixed figure strings, e.g. "+ 7.407.819.761"
}

function buildAbstractionGroups(table: ParsedTable): AbstractionGroup[] {
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
      const val = row.cells[row.cells.length - 1] || '';
      const signed = val.startsWith('-') ? val : `+ ${val}`;
      if (currentRows.length > 0 || currentLabel) {
        groups.push({ groupLabel: currentLabel || row.account, groupTotal: val, rows: currentRows });
        currentRows = [];
        currentLabel = '';
      }
      continue;
    }

    if (row.emphasis === 'subtotal') {
      const val = row.cells[row.cells.length - 1] || '';
      if (currentRows.length > 0 && currentLabel) {
        groups.push({ groupLabel: currentLabel, groupTotal: val, rows: currentRows });
        currentRows = [];
        currentLabel = '';
      }
      continue;
    }

    // Regular row — take the last cell as the figure
    const val = row.cells[row.cells.length - 1] || '';
    if (val && val !== '-' && val !== '') {
      const trimmed = val.replace(/^-/, '').trim();
      const signed = val.startsWith('-') ? `- ${trimmed}` : `+ ${val}`;
      currentRows.push(signed);
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
      const val = totalRow.cells[totalRow.cells.length - 1] || '';
      groups.push({ groupLabel: totalRow.account, groupTotal: val, rows: [] });
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
  const groups = buildAbstractionGroups(table);

  // Derive finalTotal from last total row if not passed explicitly
  const derivedTotal = finalTotal ?? (() => {
    const r = [...table.rows].reverse().find(r => r.emphasis === 'total');
    return r ? (r.cells[r.cells.length - 1] || '') : '';
  })();

  return (
    <View
      style={{
        width: RIGHT_W,
        minHeight: PAGE_H,
        backgroundColor: FOREST_900,
        paddingHorizontal: RIGHT_PAD_H,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + 48,
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: S5 }}>
        {pills.map((p, i) => (
          <NormativePill key={i} label={p.label} tone="sand-on-forest" />
        ))}
      </View>

      {/* Abstraction groups */}
      <View style={{ flexDirection: 'column', gap: 20, flex: 1 }}>
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
                    {g.groupTotal.startsWith('-') ? g.groupTotal : `+ ${g.groupTotal}`}
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
  pageNum,
}: {
  table: ParsedTable;
  cfg: SplitPageConfig;
  pageNum: number;
}) {
  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{ backgroundColor: CREAM_0, flexDirection: 'row' }}
    >
      {/* ── LEFT PANEL (cream) ───────────────────────────────────────────── */}
      <View
        style={{
          width: LEFT_W,
          minHeight: PAGE_H,
          paddingLeft: LEFT_MARGIN,
          paddingTop: PAGE_MARGIN,
          paddingBottom: PAGE_MARGIN + 56,
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

        {/* Table */}
        <View style={{ flex: 1, marginTop: S3 }} wrap>
          <LeftTable table={table} />
        </View>
      </View>

      {/* ── RIGHT PANEL (forest) — full height ──────────────────────────── */}
      <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: RIGHT_W }}>
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
      <PageNumberBadge pageNumber={pageNum} />
    </Page>
  );
}

// ─── Full-width statement page (Cash Flow + Equity) ──────────────────────────
interface FullPageConfig {
  pageIndex: string;
  sectionHeaderTitle: string;
  caption: string;
  pills: Array<{ label: string }>;
}

function FullStatementPage({
  table,
  cfg,
  pageNum,
}: {
  table: ParsedTable;
  cfg: FullPageConfig;
  pageNum: number;
}) {
  // Build a forest summary band from total rows
  const totalRows = table.rows.filter(r => r.emphasis === 'total').slice(0, 3);

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: CREAM_0,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + 56,
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: S4 }}>
        {cfg.pills.map((p, i) => (
          <NormativePill key={i} label={p.label} tone="sage-on-cream" />
        ))}
      </View>

      {/* Table */}
      <View wrap style={{ flex: 1 }}>
        <LeftTable table={table} />
      </View>

      {/* Forest summary band at the bottom */}
      {totalRows.length > 0 && (
        <View
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
                {tr.cells[tr.cells.length - 1] || '—'}
              </Text>
            </View>
          ))}
        </View>
      )}

      <GoldRule />
      <PageNumberBadge pageNumber={pageNum} />
    </Page>
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────
interface Props {
  doc: EditorialReport;
  /** Starting page number for the first statement page. Defaults to 1. */
  startPage?: number;
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
export function StatementsPages({ doc, startPage = 1 }: Props): React.ReactElement[] {
  const { balance, income, cashFlow, equity } = doc.statements;

  return [
    // ── Balance ──────────────────────────────────────────────────────────────
    <SplitStatementPage
      key="balance"
      table={balance}
      pageNum={startPage}
      cfg={{
        statementKey: 'balance',
        pageIndex: '01.',
        pageTitle: 'Estado de Situación Financiera',
        sectionHeaderTitle: 'ESTADO DE SITUACIÓN FINANCIERA',
        titleLead: 'Estado de',
        titleEmphasis: 'situación financiera',
        caption: 'Capital invertido en la operación',
        pills: [
          { label: 'NIIF 1.10' },
          { label: 'IAS 1.54' },
          { label: 'Art. 35 Ley 222/95' },
        ],
      }}
    />,

    // ── Income Statement ──────────────────────────────────────────────────────
    <SplitStatementPage
      key="income"
      table={income}
      pageNum={startPage + 1}
      cfg={{
        statementKey: 'income',
        pageIndex: '02.',
        pageTitle: 'Estado de Resultados Integrales',
        sectionHeaderTitle: 'ESTADO DE RESULTADOS INTEGRALES',
        titleLead: 'Estado de',
        titleEmphasis: 'resultados integrales',
        caption: 'Utilidad Operativa después de impuestos (UODI)',
        pills: [
          { label: 'NIIF 5.36' },
          { label: 'IAS 1.81' },
        ],
      }}
    />,

    // ── Cash Flow ─────────────────────────────────────────────────────────────
    <FullStatementPage
      key="cashflow"
      table={cashFlow}
      pageNum={startPage + 2}
      cfg={{
        pageIndex: '03.',
        sectionHeaderTitle: 'ESTADO DE FLUJOS DE EFECTIVO',
        caption: 'Flujo de caja libre del período',
        pills: [
          { label: 'NIIF 7' },
          { label: 'IAS 7.10' },
        ],
      }}
    />,

    // ── Equity Changes ────────────────────────────────────────────────────────
    <FullStatementPage
      key="equity"
      table={equity}
      pageNum={startPage + 3}
      cfg={{
        pageIndex: '04.',
        sectionHeaderTitle: 'CAMBIOS EN EL PATRIMONIO',
        caption: 'Variación en el patrimonio neto',
        pills: [
          { label: 'NIIF 6.20' },
          { label: 'IAS 1.106' },
        ],
      }}
    />,
  ];
}

// Named export for snapshot tests that render a single statement page.
export { SplitStatementPage as StatementPage };

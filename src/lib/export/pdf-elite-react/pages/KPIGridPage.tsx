// pages/KPIGridPage.tsx — KPI badge-row + optional hero callouts.
//
// Reference: ESLOP p.80 — horizontal row of 6 circular icon badges grouped under
// category banners ("INDICADORES DE RENTABILIDAD", "DE EFICIENCIA", "DE LIQUIDEZ").
// Below the badges: metric labels, values, and a topo ornament bottom-left.
//
// p.13 style: if only 1–2 KPIs, blow up to TYPE_HERO mega-numerals.
// p.80 style: 3–12 KPIs → badge row + value grid.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Page, View, Text, Svg, Circle as SvgCircle } from '@react-pdf/renderer';
import type { EditorialReport, KpiCell } from '../types';
import {
  GoldRule,
  MixedWeightHeadline,
  NormativePill,
  PageNumberBadge,
  TopoOrnament,
} from '../primitives';
import {
  CHARCOAL_700,
  CHARCOAL_900,
  CREAM_0,
  CREAM_50,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  FOREST_700,
  FOREST_900,
  PAGE_MARGIN,
  PAGE_ORIENTATION,
  R_PILL,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  SAGE_100,
  SAGE_500,
  SAGE_600,
  SAND_300,
  SAND_400,
  SAND_500,
  TYPE_BODY,
  TYPE_CAPTION,
  TYPE_EYEBROW,
  TYPE_H2,
  TYPE_HERO,
  TYPE_LEAD,
  TYPE_SMALL,
  WINE_700,
} from '../tokens';

interface Props {
  doc: EditorialReport;
  pageNumber?: number;
}

// ─── Status colors ────────────────────────────────────────────────────────────
function deltaColor(status: KpiCell['status']): string {
  switch (status) {
    case 'positive': return SAGE_500;
    case 'warning':  return SAND_500;
    case 'critical': return WINE_700;
    default:         return CHARCOAL_700;
  }
}

function badgeFill(i: number): { circle: string; ring: string } {
  // Alternate forest / sage to match ESLOP p.80 badge pattern
  if (i % 2 === 0) {
    return { circle: FOREST_900, ring: SAGE_100 };
  }
  return { circle: SAGE_600, ring: SAGE_100 };
}

function formatDelta(deltaPct?: number): string | null {
  if (deltaPct === undefined || deltaPct === null) return null;
  if (deltaPct === 0) return 'flat';
  const sign = deltaPct > 0 ? '▲ ' : '▼ ';
  return `${sign}${Math.abs(deltaPct).toFixed(1)}%`;
}

// ─── Single KPI badge (ref p.80 circle icon badge) ───────────────────────────
// Outer sage ring + inner forest/sage circle + KPI value below + label.
const BADGE_OUTER_R = 42;
const BADGE_INNER_R = 32;
const BADGE_SVG_W = BADGE_OUTER_R * 2 + 8;
const BADGE_SVG_H = BADGE_OUTER_R * 2 + 8;

function KpiBadge({ kpi, index }: { kpi: KpiCell; index: number }) {
  const fills = badgeFill(index);
  const cx = BADGE_SVG_W / 2;
  const cy = BADGE_SVG_H / 2;
  const delta = formatDelta(kpi.deltaPct);

  return (
    <View
      style={{
        alignItems: 'center',
        flex: 1,
        minWidth: 100,
        maxWidth: 130,
        paddingHorizontal: S2,
      }}
    >
      {/* Circle badge */}
      <Svg width={BADGE_SVG_W} height={BADGE_SVG_H}>
        {/* Outer ring (sage tint) */}
        <SvgCircle cx={cx} cy={cy} r={BADGE_OUTER_R} fill={fills.ring} />
        {/* Inner colored disc */}
        <SvgCircle cx={cx} cy={cy} r={BADGE_INNER_R} fill={fills.circle} />
        {/* Tiny white icon placeholder — initials of label */}
        <SvgCircle cx={cx} cy={cy} r={10} fill="rgba(251,248,241,0.18)" />
      </Svg>

      {/* Value */}
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: 18,
          color: FOREST_900,
          marginTop: S2,
          textAlign: 'center',
        }}
      >
        {kpi.value}
        {kpi.unit ? (
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_SMALL,
              color: FOREST_700,
            }}
          >
            {' '}{kpi.unit}
          </Text>
        ) : null}
      </Text>

      {/* Label */}
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontWeight: 'bold',
          fontSize: TYPE_CAPTION,
          color: CHARCOAL_700,
          textAlign: 'center',
          marginTop: 2,
          letterSpacing: 0.3,
        }}
      >
        {kpi.label}
      </Text>

      {/* Delta pill */}
      {delta && (
        <View
          style={{
            marginTop: S1,
            paddingHorizontal: S2,
            paddingVertical: 1,
            backgroundColor: `rgba(90,143,123,0.12)`, // SAGE_500 tint
            borderRadius: R_PILL,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: 7,
              color: deltaColor(kpi.status),
            }}
          >
            {delta}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Category group label (matching ESLOP p.80 bracket headers) ──────────────
function CategoryLabel({ label }: { label: string }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: FOREST_900,
        paddingHorizontal: S3,
        paddingVertical: S1,
        marginBottom: S3,
        alignSelf: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontWeight: 'bold',
          fontSize: TYPE_CAPTION,
          color: FOREST_900,
          letterSpacing: 1.0,
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Hero mega-numeral (ref p.13 — for 1–2 KPI scenarios) ───────────────────
function HeroKpi({ kpi }: { kpi: KpiCell }) {
  return (
    <View
      style={{
        alignItems: 'center',
        flex: 1,
        paddingHorizontal: S6,
      }}
    >
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: TYPE_HERO,
          color: FOREST_900,
          lineHeight: 1,
        }}
      >
        {kpi.value}
      </Text>
      {kpi.unit && (
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontWeight: 'bold',
            fontSize: 22,
            color: SAGE_500,
            marginTop: -S3,
          }}
        >
          {kpi.unit}
        </Text>
      )}
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE_LEAD,
          color: CHARCOAL_700,
          textAlign: 'center',
          marginTop: S3,
          maxWidth: 240,
        }}
      >
        {kpi.label}
      </Text>
    </View>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function KPIGridPage({ doc, pageNumber = 1 }: Props) {
  const kpis = doc.kpiGrid.kpis.slice(0, 12);
  const isMega = kpis.length <= 2;

  // For badge row: split into groups of up to 3 (mimicking ESLOP p.80 category groups)
  // Group 1: first 3 (Rentabilidad), Group 2: next 3 (Eficiencia), Group 3: last remainder
  const group1 = kpis.slice(0, Math.min(3, kpis.length));
  const group2 = kpis.slice(3, Math.min(6, kpis.length));
  const group3 = kpis.slice(6, Math.min(9, kpis.length));

  return (
    <Page
      size="A4"
      orientation={PAGE_ORIENTATION}
      style={{
        backgroundColor: CREAM_50,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + 48,
        position: 'relative',
      }}
    >
      {/* Topo ornament bottom-left (ref p.80) */}
      <View style={{ position: 'absolute', bottom: 40, left: 0, opacity: 0.15 }}>
        <TopoOrnament variant="corner-bl" opacity={0.18} seed={80} width={200} height={200} />
      </View>

      {/* Title */}
      <MixedWeightHeadline
        parts={[
          { text: 'Indicadores', weight: 'light' },
          { text: 'clave del período', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      {/* Normative pills */}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S5 }}>
        <NormativePill label="NIIF 1.10" tone="sage-on-cream" />
        <NormativePill label="IFRS 18" tone="sage-on-cream" />
        <NormativePill label="NIIF 7" tone="sage-on-cream" />
      </View>

      {/* ── Mega-numeral mode (1–2 KPIs) ─────────────────────────────────── */}
      {isMega && (
        <View
          style={{
            flexDirection: 'row',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: S6,
          }}
        >
          {kpis.map((k, i) => <HeroKpi key={i} kpi={k} />)}
        </View>
      )}

      {/* ── Badge-row mode (3–12 KPIs) — mirrors ESLOP p.80 ─────────────── */}
      {!isMega && (
        <View style={{ flex: 1 }}>
          {/* Category group row 1 */}
          {group1.length > 0 && (
            <View style={{ marginBottom: S4 }}>
              <CategoryLabel label="Indicadores de Rentabilidad" />
              <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                {group1.map((k, i) => <KpiBadge key={i} kpi={k} index={i} />)}
              </View>
            </View>
          )}

          {/* Category group row 2 */}
          {group2.length > 0 && (
            <View style={{ marginBottom: S4 }}>
              <CategoryLabel label="Indicadores de Eficiencia" />
              <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                {group2.map((k, i) => <KpiBadge key={i + 3} kpi={k} index={i + 3} />)}
              </View>
            </View>
          )}

          {/* Category group row 3 */}
          {group3.length > 0 && (
            <View style={{ marginBottom: S4 }}>
              <CategoryLabel label="Indicadores de Liquidez" />
              <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                {group3.map((k, i) => <KpiBadge key={i + 6} kpi={k} index={i + 6} />)}
              </View>
            </View>
          )}

          {/* Forest connector line (ref p.80 horizontal dotted line through badge centers) */}
          <View
            style={{
              position: 'absolute',
              top: 90,
              left: PAGE_MARGIN,
              right: PAGE_MARGIN,
              height: 0.5,
              backgroundColor: FOREST_900,
              opacity: 0.15,
            }}
          />
        </View>
      )}

      <GoldRule />
      <PageNumberBadge pageNumber={pageNumber} />
    </Page>
  );
}

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
import { statementCitations } from '../../statement-presentation';
import {
  GoldRule,
  MixedWeightHeadline,
  NormativePill,
  PageNumberBadge,
  TopoOrnament,
  TocAnchor,
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
// Compact badges: la grilla muestra hasta 12 KPIs en 4 grupos (2×2); el
// tamaño completo sólo cabía para 9 y los KPIs 10–12 se descartaban
// (reportes-export-18).
const BADGE_OUTER_R = 16;
const BADGE_INNER_R = 12;
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
        minWidth: 76,
        maxWidth: 88,
        paddingHorizontal: S1,
      }}
    >
      {/* Circle badge */}
      <Svg width={BADGE_SVG_W} height={BADGE_SVG_H}>
        {/* Outer ring (sage tint) */}
        <SvgCircle cx={cx} cy={cy} r={BADGE_OUTER_R} fill={fills.ring} />
        {/* Inner colored disc */}
        <SvgCircle cx={cx} cy={cy} r={BADGE_INNER_R} fill={fills.circle} />
        {/* Tiny white icon placeholder — initials of label */}
        <SvgCircle cx={cx} cy={cy} r={5} fill="rgba(251,248,241,0.18)" />
      </Svg>

      {/* Value */}
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: 10,
          color: FOREST_900,
          marginTop: 2,
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
      {kpi.note ? (
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: 6,
            color: CHARCOAL_700,
            textAlign: 'center',
            marginTop: 1,
          }}
        >
          {kpi.note}
        </Text>
      ) : null}

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
        marginBottom: S2,
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

// ─── Agrupación por categoría (reportes-export-18) ─────────────────────────────
// Antes los grupos se cortaban por POSICIÓN (0-3, 3-6, 6-9) con rótulos fijos:
// Activo/Pasivo/Patrimonio salían bajo "Indicadores de Rentabilidad" y los KPIs
// 10–12 se descartaban. Ahora cada KPI declara su categoría y ninguno se pierde.
const CATEGORY_ORDER: Array<{ key: NonNullable<KpiCell['category']> | 'otros'; label: string }> = [
  { key: 'estructura', label: 'Estructura financiera' },
  { key: 'resultados', label: 'Resultados del periodo' },
  { key: 'rentabilidad', label: 'Rentabilidad y crecimiento' },
  { key: 'liquidez', label: 'Liquidez y solvencia' },
  { key: 'otros', label: 'Otros indicadores' },
];

export function groupKpisByCategory(kpis: KpiCell[]): Array<{ label: string; kpis: KpiCell[] }> {
  return CATEGORY_ORDER.map(({ key, label }) => ({
    label,
    kpis: kpis.filter((k) => (k.category ?? 'otros') === key),
  })).filter((g) => g.kpis.length > 0);
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function KPIGridPage({ doc }: Props) {
  const kpis = doc.kpiGrid.kpis;
  const isMega = kpis.length <= 2;
  const groups = groupKpisByCategory(kpis);

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
      <TocAnchor id="kpi" />
      {/* Topo ornament bottom-left (ref p.80) */}
      <View fixed style={{ position: 'absolute', bottom: 40, left: 0, opacity: 0.15 }}>
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

      {/* Normative pills — fuente de los indicadores: ESF y ERI según el grupo
          NIIF (reportes-export-16). NIIF 18 no está incorporada en Colombia. */}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S5 }}>
        {[
          ...statementCitations('balance', doc.meta.niifGroup),
          ...statementCitations('income', doc.meta.niifGroup),
        ].map((label) => (
          <NormativePill key={label} label={label} tone="sage-on-cream" />
        ))}
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
          {/* Grupos por categoría en grilla 2×2 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {(() => {
              let offset = 0;
              return groups.map((g) => {
                const base = offset;
                offset += g.kpis.length;
                return (
                  <View key={g.label} style={{ width: '49%', marginBottom: S2 }}>
                    <CategoryLabel label={g.label} />
                    <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {g.kpis.map((k, i) => <KpiBadge key={i} kpi={k} index={base + i} />)}
                    </View>
                  </View>
                );
              });
            })()}
          </View>

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
      <PageNumberBadge />
    </Page>
  );
}

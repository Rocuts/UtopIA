// pages/DialGaugePage.tsx — Multi-gauge dashboard for financial health ratios.
//
// Spec §3.8. Cream background. Up to 3 gauges per row, max 2 rows (6 gauges).
// Each gauge: arc width 14pt, SAGE_500 → SAND_500 → WINE_700 zone gradient.
// Label below + caption (ideal threshold). No heavy decorative elements — the
// data is dense, let it breathe.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  GoldRule,
  MixedWeightHeadline,
  NormativePill,
  PageNumberBadge,
} from '../primitives';
import { DialGauge } from '../charts/DialGauge';
import {
  CHARCOAL_700,
  CREAM_50,
  FONT_SANS,
  FOREST_900,
  PAGE_MARGIN,
  PAGE_ORIENTATION,
  S1,
  S2,
  S3,
  S4,
  S5,
  SAND_200,
  TYPE_BODY,
  TYPE_CAPTION,
  TYPE_H2,
  TYPE_LEAD,
} from '../tokens';

interface Props {
  doc: EditorialReport;
  pageNumber?: number;
}

export function DialGaugePage({ doc, pageNumber = 1 }: Props) {
  // Cap at 6 (spec §3.8: 3×2 grid)
  const gauges = doc.dialGauges.gauges.slice(0, 6);
  const row1 = gauges.slice(0, 3);
  const row2 = gauges.slice(3, 6);

  // Gauge diameter: 3-per-row across content width.
  // Content width = PAGE_W(842) - 2*PAGE_MARGIN(48) = 746. Divide by 3 with gaps.
  const GAUGE_SIZE = 160;

  return (
    <Page
      size="A4"
      orientation={PAGE_ORIENTATION}
      style={{
        backgroundColor: CREAM_50,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + 48,
      }}
    >
      {/* Title */}
      <MixedWeightHeadline
        parts={[
          { text: 'Indicadores de', weight: 'light' },
          { text: 'salud financiera', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      {/* Normative pills */}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S5 }}>
        <NormativePill label="NIIF 7" tone="sage-on-cream" />
        <NormativePill label="NIIF 9" tone="sage-on-cream" />
        <NormativePill label="IAS 1.135" tone="sage-on-cream" />
      </View>

      {/* Row 1 */}
      {row1.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            marginBottom: S5,
          }}
        >
          {row1.map((g, i) => (
            <View
              key={`g1-${i}`}
              style={{ alignItems: 'center', flex: 1 }}
            >
              <DialGauge gauge={g} size={GAUGE_SIZE} />
            </View>
          ))}
          {/* Pad with empty slots if fewer than 3 */}
          {row1.length < 3 &&
            Array.from({ length: 3 - row1.length }).map((_, i) => (
              <View key={`pad1-${i}`} style={{ flex: 1 }} />
            ))}
        </View>
      )}

      {/* Row 2 */}
      {row2.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
          }}
        >
          {row2.map((g, i) => (
            <View
              key={`g2-${i}`}
              style={{ alignItems: 'center', flex: 1 }}
            >
              <DialGauge gauge={g} size={GAUGE_SIZE} />
            </View>
          ))}
          {row2.length < 3 &&
            Array.from({ length: 3 - row2.length }).map((_, i) => (
              <View key={`pad2-${i}`} style={{ flex: 1 }} />
            ))}
        </View>
      )}

      <GoldRule />
      <PageNumberBadge pageNumber={pageNumber} />
    </Page>
  );
}

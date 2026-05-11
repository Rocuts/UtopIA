// pages/WaterfallPnLPage.tsx — Waterfall P&L composition page.
//
// Spec §3.7. Cream background, mixed-weight headline, forest/sage/sand chart
// palette, NormativePill cluster right column, topo ornament bottom-left.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  GoldRule,
  MixedWeightHeadline,
  NormativePill,
  PageNumberBadge,
  TopoOrnament,
} from '../primitives';
import { WaterfallPnL } from '../charts/WaterfallPnL';
import {
  CHARCOAL_700,
  CREAM_50,
  FONT_SANS,
  PAGE_MARGIN,
  PAGE_ORIENTATION,
  S3,
  S4,
  S5,
  TYPE_H2,
  TYPE_LEAD,
} from '../tokens';

interface Props {
  doc: EditorialReport;
  pageNumber?: number;
}

export function WaterfallPnLPage({ doc, pageNumber = 1 }: Props) {
  const items = doc.waterfall.items;

  const total = items.find((it) => it.sign === 'total');
  const positives = items.filter((it) => it.sign === 'pos').length;
  const negatives = items.filter((it) => it.sign === 'neg').length;

  const commentary =
    total && positives > 0
      ? `El resultado parte de ${positives} flujo${positives === 1 ? '' : 's'} de ingreso, descuenta ${negatives} línea${negatives === 1 ? '' : 's'} de costo, gasto e impuesto, y cierra en el resultado neto del período.`
      : 'Composición del resultado del período. Barras positivas en sage, negativas en bordeaux, total final en sand.';

  // Chart fits in the available width minus the right commentary column.
  const CHART_W = 510;
  const CHART_H = 260;

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
      {/* Topo ornament — bottom-left, low opacity (spec §3.7) */}
      <View style={{ position: 'absolute', bottom: 40, left: 0 }}>
        <TopoOrnament variant="corner-bl" opacity={0.12} areaAccent="valor" seed={77} width={180} height={180} />
      </View>

      {/* Title */}
      <MixedWeightHeadline
        parts={[
          { text: 'Composición del', weight: 'light' },
          { text: 'Resultado Neto', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      {/* Normative pills */}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4 }}>
        <NormativePill label="IAS 1.81" tone="sage-on-cream" />
        <NormativePill label="NIIF 5.36" tone="sage-on-cream" />
      </View>

      {/* Two-column layout: chart (left) + commentary (right) */}
      <View style={{ flexDirection: 'row', flex: 1, gap: S5 }}>
        {/* Chart */}
        <View style={{ flex: 1, alignItems: 'flex-start', justifyContent: 'flex-start' }}>
          <WaterfallPnL items={items} width={CHART_W} height={CHART_H} />
        </View>

        {/* Right commentary column */}
        <View style={{ width: 180, paddingTop: S4 }}>
          <NormativePill label="NIIF 1.10" tone="sage-on-cream" />
          <NormativePill label="Art. 26 E.T." tone="sage-on-cream" />

          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_LEAD,
              color: CHARCOAL_700,
              lineHeight: 1.55,
              marginTop: S4,
            }}
          >
            {commentary}
          </Text>
        </View>
      </View>

      <GoldRule />
      <PageNumberBadge pageNumber={pageNumber} />
    </Page>
  );
}

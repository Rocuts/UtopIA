// pages/BreakEvenPage.tsx — "Punto de Equilibrio" narrative page, landscape A4.
//
// Renders the markdown that the Director de Estrategia agent produces under
// `FinancialReport.strategicAnalysis.breakEvenAnalysis`. Composer (compose.ts)
// extracts it into `EditorialReport.breakEven`. If the field is undefined the
// page is omitted by EditorialReportDoc — this component should not render
// in that branch.
//
// Style follows the cream-narrative pattern (matches NotesPage / Recommendations):
// MixedWeightHeadline title, NormativePill cluster, MarkdownToPdf body that
// wraps via React-PDF's automatic page-break, GoldRule + PageNumberBadge at the
// bottom-right. Topographic ornament bleeds from the bottom-left corner.
import React from 'react';
import { Page, View } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  MixedWeightHeadline,
  NormativePill,
  PageNumberBadge,
  GoldRule,
  MarkdownToPdf,
  TopoOrnament,
} from '../primitives';
import {
  CREAM_50,
  PAGE_W,
  PAGE_H,
  PAGE_MARGIN,
  S3,
  S4,
  S6,
  TYPE_H2,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

export function BreakEvenPage({ doc }: Props) {
  const block = doc.breakEven;
  if (!block || !block.bodyMarkdown.trim()) return null;

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: CREAM_50,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + S6,
        position: 'relative',
      }}
    >
      {/* Decorative topo ornament — bottom-left, low opacity */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: PAGE_W * 0.28,
          height: PAGE_H * 0.32,
          opacity: 0.08,
        }}
      >
        <TopoOrnament
          variant="corner-bl"
          opacity={1}
          areaAccent="valor"
          seed={37}
          width={PAGE_W * 0.28}
          height={PAGE_H * 0.32}
        />
      </View>

      <MixedWeightHeadline
        parts={[
          { text: 'Punto de', weight: 'light' },
          { text: 'Equilibrio', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4, flexWrap: 'wrap' }}>
        <NormativePill label="NIC 1" tone="sage-on-cream" />
        <NormativePill label="NIIF Secc. 7" tone="sage-on-cream" />
        {block.citations.slice(0, 4).map((c, i) => (
          <NormativePill key={`be-cite-${i}`} label={c.label} tone="sage-on-cream" />
        ))}
      </View>

      <View style={{ flexGrow: 1 }} wrap>
        <MarkdownToPdf markdown={block.bodyMarkdown} />
      </View>

      <GoldRule />
      <PageNumberBadge pageNumber={0} />
    </Page>
  );
}

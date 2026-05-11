// pages/ProjectedCashFlowPage.tsx — "Flujo de Caja Proyectado" page, landscape A4.
//
// Renders `EditorialReport.projectedCashFlow.bodyMarkdown`, sourced by the
// composer from `FinancialReport.strategicAnalysis.projectedCashFlow` (the
// Director de Estrategia produces a 12-month projection with scenarios). The
// page is omitted entirely when the field is undefined or empty.
//
// Style: cream narrative surface, MixedWeightHeadline title, NIC 7 normative
// pills, MarkdownToPdf auto-wrapping body, sage-tinted topo ornament corner-bl,
// GoldRule + PageNumberBadge at bottom-right.
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

export function ProjectedCashFlowPage({ doc }: Props) {
  const block = doc.projectedCashFlow;
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
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: PAGE_W * 0.28,
          height: PAGE_H * 0.32,
          opacity: 0.08,
        }}
      >
        <TopoOrnament
          variant="corner-tr"
          opacity={1}
          areaAccent="futuro"
          seed={91}
          width={PAGE_W * 0.28}
          height={PAGE_H * 0.32}
        />
      </View>

      <MixedWeightHeadline
        parts={[
          { text: 'Flujo de caja', weight: 'light' },
          { text: 'proyectado · 12m', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4, flexWrap: 'wrap' }}>
        <NormativePill label="NIC 7" tone="sage-on-cream" />
        <NormativePill label="NIIF Secc. 7" tone="sage-on-cream" />
        {block.citations.slice(0, 4).map((c, i) => (
          <NormativePill key={`pcf-cite-${i}`} label={c.label} tone="sage-on-cream" />
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

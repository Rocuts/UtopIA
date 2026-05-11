// pages/ShareholderMinutesPage.tsx — "Acta de Asamblea" page, landscape A4.
//
// Renders `EditorialReport.shareholderMinutes.bodyMarkdown` from
// `FinancialReport.governance.shareholderMinutes` (Governance Specialist
// drafts the minutes for shareholder approval of EEFF — Art. 187 Ley 222/1995).
// Page is omitted when the field is undefined or empty.
//
// Style: cream narrative surface with formal feel — slightly wider margins
// (legal-document vibe), MixedWeightHeadline, Ley 222/1995 normative pills,
// MarkdownToPdf body, GoldRule + PageNumberBadge.
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

export function ShareholderMinutesPage({ doc }: Props) {
  const block = doc.shareholderMinutes;
  if (!block || !block.bodyMarkdown.trim()) return null;

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: CREAM_50,
        paddingHorizontal: PAGE_MARGIN + 16,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + S6,
        position: 'relative',
      }}
    >
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: PAGE_W * 0.24,
          height: PAGE_H * 0.28,
          opacity: 0.07,
        }}
      >
        <TopoOrnament
          variant="corner-bl"
          opacity={1}
          areaAccent="verdad"
          seed={222}
          width={PAGE_W * 0.24}
          height={PAGE_H * 0.28}
        />
      </View>

      <MixedWeightHeadline
        parts={[
          { text: 'Acta de', weight: 'light' },
          { text: 'asamblea', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4, flexWrap: 'wrap' }}>
        <NormativePill label="Ley 222/1995, Art. 187" tone="sage-on-cream" />
        <NormativePill label="C.Co. Art. 422" tone="sage-on-cream" />
        {block.citations.slice(0, 4).map((c, i) => (
          <NormativePill key={`sh-cite-${i}`} label={c.label} tone="sage-on-cream" />
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

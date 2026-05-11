// pages/OrbitalPillarsPage.tsx — Four-pillar orbital diagram on forest ground.
//
// Spec §3.9. Forest background with topo contour at 8% opacity (full-bleed).
// Center: overall score in SAND_500 Fraunces 48pt. Four satellites at compass
// positions. NormativePill cluster around orbital. Returns null if doc.pillars
// is undefined — this page is optional in the pipeline.
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
import { OrbitalPillars } from '../charts/OrbitalPillars';
import {
  CREAM_0,
  FONT_SANS,
  FOREST_900,
  PAGE_H,
  PAGE_MARGIN,
  PAGE_ORIENTATION,
  PAGE_W,
  SAGE_300,
  SAND_300,
  SAND_500,
  S3,
  S4,
  S5,
  TYPE_CAPTION,
  TYPE_H2,
} from '../tokens';

interface Props {
  doc: EditorialReport;
  pageNumber?: number;
}

export function OrbitalPillarsPage({ doc, pageNumber = 1 }: Props) {
  if (!doc.pillars) return null;

  const { pillars } = doc;

  // Orbital diagram dimensions — must fit inside landscape A4 minus margins.
  // Available height: PAGE_H(595) - PAGE_MARGIN*2(96) - title(~80) - pills(~36) - footer(56) ≈ 327pt
  // Cap at 300pt to ensure tight layout.
  const ORBITAL_SIZE = 300;

  return (
    <Page
      size="A4"
      orientation={PAGE_ORIENTATION}
      style={{
        backgroundColor: FOREST_900,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + 48,
        position: 'relative',
      }}
    >
      {/* Full-bleed topo contour at 8% opacity (spec §3.9) */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: PAGE_W,
          height: PAGE_H,
          opacity: 0.08,
        }}
      >
        <TopoOrnament
          variant="full-bleed"
          opacity={1}
          areaAccent="valor"
          seed={39}
          width={PAGE_W}
          height={PAGE_H}
        />
      </View>

      {/* Title */}
      <MixedWeightHeadline
        parts={[
          { text: 'Pilares', weight: 'light' },
          { text: 'estratégicos', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="light-on-dark"
        highlightOpacity={0.25}
      />

      {/* Normative pills cluster */}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4 }}>
        <NormativePill label="Art. 23 C.Co." tone="sand-on-forest" />
        <NormativePill label="NIA 315" tone="sand-on-forest" />
        <NormativePill label="NIIF 1" tone="sand-on-forest" />
      </View>

      {/* Two-column layout: orbital (center) + pillar name tags (right) */}
      <View style={{ flexDirection: 'row', flex: 1, alignItems: 'center' }}>
        {/* Orbital diagram */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <OrbitalPillars pillars={pillars} width={ORBITAL_SIZE} height={ORBITAL_SIZE} />
        </View>

        {/* Pillar name + score tags */}
        <View style={{ width: 220, gap: S3 }}>
          {pillars.satellites.map((s, i) => (
            <View
              key={i}
              style={{
                borderLeftWidth: 2,
                borderLeftColor: SAND_300,
                paddingLeft: S3,
                marginBottom: S3,
              }}
            >
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontWeight: 'bold',
                  fontSize: 11,
                  color: CREAM_0,
                  letterSpacing: 0.4,
                }}
              >
                {s.label.toUpperCase()}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: TYPE_CAPTION,
                  color: SAGE_300,
                  marginTop: 2,
                }}
              >
                {s.topKpi}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontWeight: 'bold',
                  fontSize: 11,
                  color: SAND_500,
                  marginTop: 2,
                }}
              >
                {s.score.toFixed(0)} / 100
              </Text>
            </View>
          ))}
        </View>
      </View>

      <GoldRule />
      <PageNumberBadge pageNumber={pageNumber} />
    </Page>
  );
}

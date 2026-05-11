// pages/SectionDivider.tsx — full-bleed forest bg + ESLOP editorial section break.
// Layout:
//   - Full-bleed background in area accent color (dark variant).
//   - Subtle topo 'ribbons' overlay (5% opacity) across entire page.
//   - Large sage-filled circle centered-ish-left containing section name in sand caps.
//   - Oversized sand numeral (200pt) anchored bottom-right.
//   - PaginationFooter (gold rule + page badge) at very bottom.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { AreaKey } from '../types';
import {
  EditorialTitle,
  TopoOrnament,
  PaginationFooter,
} from '../primitives';
import {
  N0,
  GOLD_300,
  GOLD_400,
  AREA_ESCUDO,
  AREA_VALOR,
  AREA_VERDAD,
  AREA_FUTURO,
  FONT_DISPLAY,
  FONT_SANS,
  PAGE_W,
  PAGE_H,
  PAGE_MARGIN,
  S1,
  S6,
  R_PILL,
  darken,
  lighten,
} from '../tokens';

interface Props {
  areaAccent: AreaKey;
  sectionTitle: string;
  sectionEmphasis: string;
  ornamentSeed?: number;
  /** Optional two-digit section index string (e.g. "01", "02"). Derived from areaAccent order if not provided. */
  sectionIndex?: string;
}

const AREA_ORDER: Record<AreaKey, string> = {
  valor: '01',
  verdad: '02',
  escudo: '03',
  futuro: '04',
};

function areaHex(area: AreaKey): string {
  switch (area) {
    case 'escudo': return AREA_ESCUDO;
    case 'valor':  return AREA_VALOR;
    case 'verdad': return AREA_VERDAD;
    case 'futuro': return AREA_FUTURO;
  }
}

// Sage-ish circle fill color: slightly lighter than area accent for contrast.
function circleFill(area: AreaKey): string {
  return lighten(areaHex(area), 0.2);
}

const CIRCLE_SIZE = 200;

export function SectionDivider({
  areaAccent,
  sectionTitle,
  sectionEmphasis,
  ornamentSeed,
  sectionIndex,
}: Props) {
  const bg = darken(areaHex(areaAccent), 0.35);
  const numeral = sectionIndex ?? AREA_ORDER[areaAccent];
  const fill = circleFill(areaAccent);

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: bg,
        position: 'relative',
        padding: 0,
      }}
    >
      {/* Full-bleed topo ribbons — 5% opacity sand contours covering whole page */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: PAGE_W,
          height: PAGE_H,
        }}
      >
        <TopoOrnament
          variant="ribbons"
          opacity={0.05}
          areaAccent="valor"
          seed={ornamentSeed ?? 7}
          width={PAGE_W}
          height={PAGE_H}
        />
      </View>

      {/* Additional hex overlay for texture */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: PAGE_W,
          height: PAGE_H,
        }}
      >
        <TopoOrnament
          variant="hex"
          opacity={0.04}
          areaAccent={areaAccent}
          seed={(ornamentSeed ?? 7) + 10}
          width={PAGE_W}
          height={PAGE_H}
        />
      </View>

      {/* Large sage circle — centered-ish left (35% from left edge) */}
      <View
        style={{
          position: 'absolute',
          top: PAGE_H / 2 - CIRCLE_SIZE / 2,
          left: PAGE_W * 0.15,
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: R_PILL,
          backgroundColor: fill,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.9,
        }}
      >
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontWeight: 'bold',
            fontSize: 11,
            color: N0,
            letterSpacing: 3,
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          {sectionTitle.toUpperCase()}
        </Text>
        {sectionEmphasis ? (
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontStyle: 'italic',
              fontSize: 14,
              color: GOLD_300,
              textAlign: 'center',
              marginTop: S1,
            }}
          >
            {sectionEmphasis}
          </Text>
        ) : null}
      </View>

      {/* Oversized numeral — bottom-right anchor (~200pt) */}
      <View
        style={{
          position: 'absolute',
          bottom: S6 + 20,
          right: PAGE_MARGIN,
        }}
      >
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 200,
            color: GOLD_400,
            opacity: 0.18,
            lineHeight: 0.85,
            letterSpacing: -6,
          }}
        >
          {numeral}
        </Text>
      </View>

      {/* Section title also rendered large in the right half for editorial contrast */}
      <View
        style={{
          position: 'absolute',
          top: PAGE_H / 2 - 60,
          left: PAGE_W * 0.45,
          right: PAGE_MARGIN,
        }}
      >
        <EditorialTitle
          leadText={sectionTitle}
          emphasisText={sectionEmphasis}
          emphasisStyle="italic"
          areaAccent={areaAccent}
          size="hero"
          tone="light-on-dark"
        />
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel={sectionTitle} />
    </Page>
  );
}

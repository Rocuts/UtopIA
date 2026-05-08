// pages/SectionDivider.tsx — full-bleed area-color page with ornament + title.
import React from 'react';
import { Page, View } from '@react-pdf/renderer';
import type { AreaKey } from '../types';
import { EditorialTitle, TopoOrnament } from '../primitives';
import {
  AREA_ESCUDO,
  AREA_VALOR,
  AREA_VERDAD,
  AREA_FUTURO,
} from '../tokens';

interface Props {
  areaAccent: AreaKey;
  sectionTitle: string;
  sectionEmphasis: string;
  ornamentSeed?: number;
}

function areaHex(area: AreaKey): string {
  switch (area) {
    case 'escudo':
      return AREA_ESCUDO;
    case 'valor':
      return AREA_VALOR;
    case 'verdad':
      return AREA_VERDAD;
    case 'futuro':
      return AREA_FUTURO;
  }
}

export function SectionDivider({
  areaAccent,
  sectionTitle,
  sectionEmphasis,
  ornamentSeed,
}: Props) {
  const bg = areaHex(areaAccent);

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: bg,
        position: 'relative',
        padding: 0,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <TopoOrnament
          variant="ribbons"
          opacity={0.18}
          areaAccent={areaAccent}
          seed={ornamentSeed ?? 7}
        />
      </View>
      <View
        style={{
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 64,
        }}
      >
        <EditorialTitle
          leadText={sectionTitle}
          emphasisText={sectionEmphasis}
          emphasisStyle="italic"
          tone="light-on-dark"
          size="hero"
          areaAccent={areaAccent}
        />
      </View>
    </Page>
  );
}

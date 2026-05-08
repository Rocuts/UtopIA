// pages/OrbitalPillarsPage.tsx — central health score + 4 area satellites.
// Returns null when doc.pillars is undefined.
import React from 'react';
import { Page, View } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  EditorialTitle,
  TopoOrnament,
  WatermarkWord,
  PaginationFooter,
} from '../primitives';
import { OrbitalPillars } from '../charts/OrbitalPillars';
import { N1000 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

export function OrbitalPillarsPage({ doc }: Props) {
  if (!doc.pillars) return null;

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N1000,
        paddingHorizontal: 48,
        paddingTop: 48,
        paddingBottom: 72,
        position: 'relative',
      }}
    >
      {/* Faint hex topographic background */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <TopoOrnament variant="hex" opacity={0.06} seed={11} />
      </View>

      <EditorialTitle
        leadText="Cuatro pilares,"
        emphasisText="una visión"
        emphasisStyle="italic"
        size="page"
        tone="light-on-dark"
        areaAccent="verdad"
      />

      <View
        style={{
          marginTop: 32,
          alignItems: 'center',
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <OrbitalPillars pillars={doc.pillars} width={460} height={460} />
      </View>

      <View
        style={{
          position: 'absolute',
          bottom: 24,
          right: 32,
        }}
      >
        <WatermarkWord text="Visión" opacity={0.1} />
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Visión" />
    </Page>
  );
}

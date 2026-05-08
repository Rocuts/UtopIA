// pages/DialGaugePage.tsx — 2×2 dial gauge grid for financial health.
import React from 'react';
import { Page, View } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import { EditorialTitle, PaginationFooter } from '../primitives';
import { DialGauge } from '../charts/DialGauge';
import { N0 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

export function DialGaugePage({ doc }: Props) {
  // Cap at 4 gauges (2×2)
  const gauges = doc.dialGauges.gauges.slice(0, 4);

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 48,
        paddingBottom: 72,
      }}
    >
      <EditorialTitle
        leadText="Salud"
        emphasisText="financiera"
        emphasisStyle="box"
        areaAccent="valor"
        size="page"
        tone="dark-on-light"
      />

      <View
        style={{
          marginTop: 32,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-around',
          gap: 16,
        }}
      >
        {gauges.map((g, i) => (
          <View
            key={`gauge-${i}`}
            style={{
              flexBasis: '45%',
              alignItems: 'center',
              marginBottom: 24,
            }}
          >
            <DialGauge gauge={g} size={200} />
          </View>
        ))}
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Salud" />
    </Page>
  );
}

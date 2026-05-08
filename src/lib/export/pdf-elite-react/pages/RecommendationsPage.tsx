// pages/RecommendationsPage.tsx — vertical stack of recommendation cards.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, AreaKey } from '../types';
import {
  EditorialTitle,
  PaginationFooter,
  MarkdownToPdf,
} from '../primitives';
import {
  N0,
  N50,
  N1000,
  AREA_ESCUDO,
  AREA_VALOR,
  AREA_VERDAD,
  AREA_FUTURO,
} from '../tokens';

interface Props {
  doc: EditorialReport;
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

export function RecommendationsPage({ doc }: Props) {
  const items = doc.recommendations.items;

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
        leadText="Hoja de"
        emphasisText="ruta"
        emphasisStyle="box"
        areaAccent="futuro"
        size="page"
        tone="dark-on-light"
      />

      <View style={{ marginTop: 32 }} wrap>
        {items.map((item, i) => (
          <View
            key={`rec-${i}`}
            style={{
              borderLeftWidth: 4,
              borderLeftStyle: 'solid',
              borderLeftColor: areaHex(item.areaAccent),
              padding: 16,
              marginBottom: 12,
              backgroundColor: N50,
            }}
            wrap={false}
          >
            <Text
              style={{
                fontFamily: 'Fraunces',
                fontWeight: 700,
                fontSize: 14,
                color: N1000,
                marginBottom: 8,
              }}
            >
              {item.title}
            </Text>
            <MarkdownToPdf
              markdown={item.bodyMarkdown}
              tone="dark-on-light"
            />
          </View>
        ))}
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Hoja de ruta" />
    </Page>
  );
}

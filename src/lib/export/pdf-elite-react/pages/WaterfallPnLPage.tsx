// pages/WaterfallPnLPage.tsx — bridge waterfall page (P&L composition).
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import { EditorialTitle, PaginationFooter } from '../primitives';
import { WaterfallPnL } from '../charts/WaterfallPnL';
import { N0, N700 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

export function WaterfallPnLPage({ doc }: Props) {
  const items = doc.waterfall.items;

  // Brief explanatory paragraph: identify revenue (first pos), final total, and
  // count of cost lines for a one-sentence bridge summary.
  const total = items.find((it) => it.sign === 'total');
  const positives = items.filter((it) => it.sign === 'pos').length;
  const negatives = items.filter((it) => it.sign === 'neg').length;
  const summary =
    total && positives > 0
      ? `El puente parte de ${positives} flujo${positives === 1 ? '' : 's'} de ingreso, descuenta ${negatives} línea${negatives === 1 ? '' : 's'} de costo/gasto/impuesto y cierra en una utilidad neta de referencia.`
      : 'Composición del resultado del periodo: variaciones positivas en oro, negativas en bordeaux, totales en verde valor.';

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
        leadText="Composición de la"
        emphasisText="utilidad"
        emphasisStyle="box"
        areaAccent="valor"
        size="page"
        tone="dark-on-light"
      />

      <View style={{ marginTop: 24, alignItems: 'center' }}>
        <WaterfallPnL items={items} width={500} height={300} />
      </View>

      <View style={{ marginTop: 24, paddingHorizontal: 12 }}>
        <Text
          style={{
            fontFamily: 'Geist',
            fontSize: 10,
            color: N700,
            lineHeight: 1.5,
          }}
        >
          {summary}
        </Text>
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Composición" />
    </Page>
  );
}

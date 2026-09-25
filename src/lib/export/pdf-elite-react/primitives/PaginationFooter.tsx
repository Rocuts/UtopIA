// PaginationFooter.tsx — Champagne-numeral page footer with section label and
// thin gold rule. Sits absolutely at page bottom (callers place inside Page).
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import {
  FONT_DISPLAY,
  FONT_SANS,
  GOLD_500,
  N500,
  N700,
  PAGE_MARGIN,
  S1,
  TYPE_CAPTION,
} from '../tokens';

export interface PaginationFooterProps {
  /**
   * Número fijo, sólo para vistas aisladas (una página suelta en una prueba).
   * Omitido — el caso de todas las páginas del informe —, el pie imprime el
   * número REAL de la página en el documento con el render prop de react-pdf.
   * Auditoría 2026-09-24 (reportes-export-21): las páginas pasaban 0 y el PDF
   * imprimía "00 / 00".
   */
  pageNumber?: number;
  /** Total fijo (ver `pageNumber`); omitido = total real del documento. */
  totalPages?: number;
  sectionLabel?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Footer: thin gold top rule, left-aligned uppercase section label, right-
 * aligned champagne page numeral with smaller "/ N" denominator.
 *
 * `fixed`: se repite en cada página física de una `<Page>` que se parte
 * (notas, anexo), cada una con su propio número.
 */
export function PaginationFooter(props: PaginationFooterProps): React.ReactElement {
  const { pageNumber, totalPages, sectionLabel } = props;
  const staticPage = typeof pageNumber === 'number' && pageNumber > 0 ? pageNumber : null;
  const staticTotal = typeof totalPages === 'number' && totalPages > 0 ? totalPages : null;
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 24,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        borderTopWidth: 0.5,
        borderTopColor: GOLD_500,
        borderTopStyle: 'solid',
        paddingTop: S1,
      }}
    >
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE_CAPTION,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: N700,
        }}
      >
        {sectionLabel ?? ''}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 18,
            color: GOLD_500,
            // Sin `lineHeight`: react-pdf no dibuja el texto dinámico
            // (`render`) de un <Text> con interlineado explícito.
          }}
          // Sin la clave `render` en modo fijo: react-pdf trata como dinámico
          // todo nodo que la tenga, aunque valga undefined.
          {...(staticPage === null ? { render: ({ pageNumber: n }: { pageNumber: number }) => pad2(n) } : {})}
        >
          {staticPage === null ? '' : pad2(staticPage)}
        </Text>
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: TYPE_CAPTION,
            color: N500,
            marginLeft: 4,
          }}
          {...(staticTotal === null
            ? { render: ({ totalPages: t }: { totalPages: number }) => ` / ${pad2(t)}` }
            : {})}
        >
          {staticTotal === null ? '' : ` / ${pad2(staticTotal)}`}
        </Text>
      </View>
    </View>
  );
}

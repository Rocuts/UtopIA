// PageNumberBadge.tsx — Circular cream-filled page badge, bottom-right corner.
// Matches the ESLOP reference: small circle ~24pt diameter, forest numeral
// inside, positioned absolutely so it sits flush at the page bottom-right.
//
// Usage: place inside a <Page> component. Without `pageNumber` the numeral is
// the REAL page of the document, read at layout time through react-pdf's
// `render` prop (auditoría 2026-09-24, reportes-export-21: the pages passed 0
// or a per-section index and the PDF printed "0", "1", "1"...).
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import {
  FONT_DISPLAY,
  GOLD_300,
  N1000,
  PAGE_MARGIN,
  R_PILL,
  TYPE_CAPTION,
} from '../tokens';

// Why: The ESLOP badge is ~24pt diameter. At TYPE_CAPTION (8pt) the numeral
// sits centered with comfortable padding. We derive diameter from font size
// to keep the ratio stable if the token changes.
const BADGE_DIAMETER = 24;
// Forest green: AREA_FUTURO is teal but the ESLOP badge background is the
// deep cream/sand (GOLD_300 at full opacity) with the dark numeral inside.
// Matching page 4, 5, 8, 13, 20, 83, 84: cream-sand circle, dark numeral.
const BADGE_BG = GOLD_300;
const BADGE_NUMERAL_COLOR = N1000;

export interface PageNumberBadgeProps {
  /**
   * Número fijo, sólo para vistas aisladas. Omitido (todas las páginas del
   * informe), el número real de la página en el documento.
   */
  pageNumber?: number;
  /**
   * Distance from right edge (defaults to PAGE_MARGIN / 2 so the badge
   * sits inside the margin column without overlapping body text).
   */
  right?: number;
  /**
   * Distance from bottom edge. Defaults to 20 to match the ESLOP bottom
   * positioning (just above the page edge).
   */
  bottom?: number;
}

/**
 * Circular cream badge with a dark numeral. Absolute-positioned bottom-right.
 * Caller must place this inside a `<Page>` (or a full-bleed absolute wrapper).
 *
 * `fixed`: se repite en cada página física de una `<Page>` que se parte.
 */
export function PageNumberBadge(props: PageNumberBadgeProps): React.ReactElement {
  const { pageNumber, right = PAGE_MARGIN / 2, bottom = 20 } = props;
  const staticPage = typeof pageNumber === 'number' && pageNumber > 0 ? pageNumber : null;

  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom,
        right,
        width: BADGE_DIAMETER,
        height: BADGE_DIAMETER,
        borderRadius: R_PILL,
        backgroundColor: BADGE_BG,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: TYPE_CAPTION,
          color: BADGE_NUMERAL_COLOR,
          // Sin `lineHeight`: react-pdf no dibuja el texto dinámico
          // (`render`) de un <Text> con interlineado explícito.
        }}
        // Sin la clave `render` en modo fijo: react-pdf trata como dinámico todo
        // nodo que la tenga, aunque valga undefined.
        {...(staticPage === null ? { render: ({ pageNumber: n }: { pageNumber: number }) => String(n) } : {})}
      >
        {staticPage === null ? '' : String(staticPage)}
      </Text>
    </View>
  );
}

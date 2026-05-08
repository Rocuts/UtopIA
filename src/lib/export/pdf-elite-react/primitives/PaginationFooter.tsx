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
  pageNumber: number;
  totalPages: number;
  sectionLabel?: string;
}

/**
 * Footer: thin gold top rule, left-aligned uppercase section label, right-
 * aligned champagne page numeral with smaller "/ N" denominator.
 */
export function PaginationFooter(props: PaginationFooterProps): React.ReactElement {
  const { pageNumber, totalPages, sectionLabel } = props;
  return (
    <View
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
            lineHeight: 1,
          }}
        >
          {String(pageNumber).padStart(2, '0')}
        </Text>
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: TYPE_CAPTION,
            color: N500,
            marginLeft: 4,
          }}
        >
          {' / '}
          {String(totalPages).padStart(2, '0')}
        </Text>
      </View>
    </View>
  );
}

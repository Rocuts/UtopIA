// PageNumberBadge.tsx — Circular cream-filled page badge, bottom-right corner.
// Matches the ESLOP reference: small circle ~24pt diameter, forest numeral
// inside, positioned absolutely so it sits flush at the page bottom-right.
//
// Usage: place inside a <Page> component. The badge reads pageNumber and
// totalPages from react-pdf's render-prop canvas context via the `render`
// prop pattern — but since Page.render is not directly composable in JSX
// children, callers should pass the page number explicitly after forwarding
// it from their Page's render prop (see PaginationFooter pattern).
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
  /** Current 1-based page number. Forward from Page render prop. */
  pageNumber: number;
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
 * Pattern for pages using react-pdf's dynamic page numbers:
 *
 * ```tsx
 * <Page>
 *   {({ pageNumber }) => (
 *     <>
 *       <PageNumberBadge pageNumber={pageNumber} />
 *       ... page content ...
 *     </>
 *   )}
 * </Page>
 * ```
 */
export function PageNumberBadge(props: PageNumberBadgeProps): React.ReactElement {
  const { pageNumber, right = PAGE_MARGIN / 2, bottom = 20 } = props;

  return (
    <View
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
          lineHeight: 1,
        }}
      >
        {String(pageNumber)}
      </Text>
    </View>
  );
}

// NumberedSectionHeader.tsx — Full-width forest banner with circular badge +
// section title + small italic subtitle.
//
// Reference: ESLOP page 20, top banner:
//   - Deep forest green rounded rectangle spanning full content width
//   - Left: cream circle with bold "01." inside (slightly overlapping the banner)
//   - Center-left: section title in sand/GOLD_300, uppercase, condensed
//   - Below title: small italic subtitle in a slightly lighter sand
//
// Spec §2.5.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import {
  AREA_FUTURO,
  FONT_DISPLAY,
  FONT_SANS,
  GOLD_300,
  N0,
  PAGE_MARGIN,
  PAGE_W,
  R_MD,
  R_PILL,
  S3,
  S5,
  TYPE_BODY,
  TYPE_SECTION,
} from '../tokens';

export interface NumberedSectionHeaderProps {
  /** Zero-padded number string: "01.", "02.", "03." */
  number: string;
  /** Section title — rendered uppercase in sand. E.g. "EXPANSIÓN DEL NEGOCIO Y SOLIDEZ FINANCIERA" */
  title: string;
  /** Italic subtitle below the title. E.g. "Orientaciones Estratégicas:" */
  subtitle?: string;
  /**
   * Banner background color. Defaults to AREA_FUTURO (deep teal/forest).
   * Override with any token hex if a section uses a different pillar color.
   */
  bannerColor?: string;
}

// Why: The spec says "full-width rounded forest banner". In react-pdf absolute
// positioning of the badge outside the banner rectangle causes clipping issues
// when the banner is inside a flex column. We instead implement the badge as
// an absolutely-positioned element that overlaps the banner on the left by
// letting the View container be slightly taller than the banner row and using
// a negative left margin on the badge to create the overlap optical effect.
//
// Banner height: 48pt (S7) gives enough room for title + subtitle at
// TYPE_SECTION (24pt) + TYPE_BODY (11pt) with comfortable padding.
const BANNER_H = 48;
const BADGE_SIZE = 36;
// Horizontal overlap: badge hangs ~8pt into the left margin.
const BADGE_OVERLAP = 8;
// Content width = page width minus both page margins.
const CONTENT_W = PAGE_W - PAGE_MARGIN * 2;

/**
 * Full-width section divider banner. Returns a `<View>` at content-column
 * width. Caller places it flush to the page content area (no extra margins).
 */
export function NumberedSectionHeader(props: NumberedSectionHeaderProps): React.ReactElement {
  const {
    number,
    title,
    subtitle,
    bannerColor = AREA_FUTURO,
  } = props;

  return (
    // Outer wrapper: full content width, slightly taller than the banner so
    // the badge circle can overlap the top edge without clipping.
    <View
      style={{
        width: CONTENT_W,
        height: BANNER_H + 4,
        position: 'relative',
        marginBottom: S3,
      }}
    >
      {/* Forest banner — starts at y=4 to leave room above for badge overflow */}
      <View
        style={{
          position: 'absolute',
          top: 4,
          left: 0,
          right: 0,
          height: BANNER_H,
          backgroundColor: bannerColor,
          borderRadius: R_MD,
          flexDirection: 'row',
          alignItems: 'center',
          // Left padding accounts for the badge overlap so text starts after it.
          paddingLeft: BADGE_SIZE + S3,
          paddingRight: S5,
        }}
      >
        {/* Title + subtitle column */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: TYPE_SECTION - 4, // 20pt — condensed to fit on one line
              color: GOLD_300,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              lineHeight: 1.1,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontStyle: 'italic',
                // Why: spec says "small italic subtitle" without pinning a size.
                // 9pt sits clearly below the 20pt title and remains legible at
                // A4 print resolution (72dpi minimum for PDF).
                fontSize: 9,
                color: GOLD_300,
                opacity: 0.85,
                marginTop: 2,
                lineHeight: 1.2,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Circular badge — positioned to overlap the left edge of the banner */}
      <View
        style={{
          position: 'absolute',
          top: 4 + (BANNER_H - BADGE_SIZE) / 2, // vertically centered on banner
          left: -BADGE_OVERLAP,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          borderRadius: R_PILL,
          backgroundColor: N0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            // Why: 11pt fits "01." inside a 36pt badge with comfortable padding
            // and is consistent with the reference design's proportions.
            fontSize: TYPE_BODY,
            color: bannerColor,
            lineHeight: 1,
          }}
        >
          {number}
        </Text>
      </View>
    </View>
  );
}

// GoldRule.tsx — Thin sand-colored horizontal rule at page bottom with a
// small filled dot on the right end. ESLOP signature page frame.
//
// Reference: visible on pages 8, 16, 17, 20, 84 — a 0.5–1pt horizontal line
// in sand/gold near the page bottom, with a small circle (5–6pt diameter)
// sitting just above or on the right terminus of the line.
//
// Spec §2.6.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View } from '@react-pdf/renderer';
import {
  GOLD_400,
  PAGE_MARGIN,
  PAGE_W,
  R_PILL,
} from '../tokens';

export interface GoldRuleProps {
  /**
   * Color of rule and dot. Defaults to GOLD_400 (sand — matches ESLOP pages
   * 16 / 17 where the rule is the warm sand/champagne tone, not deep gold).
   */
  color?: string;
  /** Rule stroke width. Defaults to 0.75pt. */
  strokeWidth?: number;
  /** Dot diameter. Defaults to 6pt. */
  dotSize?: number;
  /**
   * Distance from page bottom. Defaults to 14pt — sits just above the
   * PageNumberBadge (20pt bottom, 24pt diameter) so the two don't overlap.
   */
  bottom?: number;
  /** Left inset from page edge. Defaults to PAGE_MARGIN. */
  left?: number;
  /** Right inset from page edge. Defaults to PAGE_MARGIN / 2 to leave room
   * for the PageNumberBadge circle in the bottom-right corner. */
  right?: number;
}

/**
 * Absolute-positioned gold rule with right-end dot. Place inside a `<Page>`
 * alongside `PageNumberBadge` — they are vertically independent (different
 * bottom offsets).
 */
export function GoldRule(props: GoldRuleProps): React.ReactElement {
  const {
    color = GOLD_400,
    strokeWidth = 0.75,
    dotSize = 6,
    bottom = 14,
    left = PAGE_MARGIN,
    // Why: right inset is PAGE_MARGIN / 2 + BADGE_DIAMETER + small gap so
    // the rule terminates before the circular page badge. PAGE_MARGIN / 2 is
    // the badge's own right offset; 24 is the badge diameter; +4 is clearance.
    right = PAGE_MARGIN / 2 + 24 + 4,
  } = props;

  const ruleW = PAGE_W - left - right;
  // Dot is vertically centered on the rule line, at the right end.
  const dotOffset = dotSize / 2; // how far the dot center is above the rule

  return (
    <View
      style={{
        position: 'absolute',
        bottom,
        left,
        width: ruleW,
        height: dotSize,
        // Flex row so we can place the line and dot side-by-side.
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {/* The rule itself — thin horizontal border drawn as a View bottom edge */}
      <View
        style={{
          flex: 1,
          height: strokeWidth,
          backgroundColor: color,
          // Terminate rule before the dot to avoid overlap artifacts.
          marginRight: dotSize / 2,
        }}
      />

      {/* Dot — filled circle at the right terminus */}
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: R_PILL,
          backgroundColor: color,
          // Slight upward offset so the dot center aligns with rule midline.
          marginTop: -(dotOffset - strokeWidth / 2),
        }}
      />
    </View>
  );
}

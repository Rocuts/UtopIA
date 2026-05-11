// MixedWeightHeadline.tsx — Composes a multi-part headline where each word
// can be light, regular, or bold, with an optional sage highlight rectangle
// behind one or more parts.
//
// Reference: ESLOP pages 4 ("Mensaje de **nuestra gerencia**"), 5
// ("Presentación del **Informe Sostenibilidad**"), 16 (all-bold heavy lead).
//
// The highlight rectangle (spec §2.4) is an absolutely-positioned sage
// (AREA_FUTURO) rect behind the highlighted <Text> token. Because react-pdf
// absolute positioning is against the nearest positioned ancestor, each part
// is wrapped in a relative <View>. Parts flow left-to-right as a flex-row
// with flexWrap so multi-line headlines wrap naturally.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import {
  AREA_FUTURO,
  FONT_DISPLAY,
  N0,
  N1000,
  TYPE_PAGE,
} from '../tokens';

export type HeadlineWeight = 'light' | 'regular' | 'bold';

export interface HeadlinePart {
  text: string;
  weight: HeadlineWeight;
  /** If true, renders a sage highlight rect absolutely behind this token. */
  highlight?: boolean;
}

export interface MixedWeightHeadlineProps {
  parts: HeadlinePart[];
  /** Font size in points. Defaults to TYPE_PAGE (36pt). */
  fontSize?: number;
  /**
   * 'dark-on-light': N1000 text (default — body/content pages).
   * 'light-on-dark': N0 text (cover/section-divider dark pages).
   */
  tone?: 'dark-on-light' | 'light-on-dark';
  /** Highlight rect opacity. Defaults to 0.55 — visible but not overpowering. */
  highlightOpacity?: number;
}

// Why: react-pdf does not support fontWeight:'300' on all font families.
// Fraunces has a registered 'normal' (400) and 'bold' (700) variant.
// We simulate 'light' with fontWeight:'normal' + color at 70% — sufficient
// for the visual contrast the spec requires without needing a third font file.
function weightStyle(
  weight: HeadlineWeight,
  baseColor: string,
): {
  fontWeight: 'bold' | 'normal';
  color: string;
} {
  switch (weight) {
    case 'bold':
      return { fontWeight: 'bold', color: baseColor };
    case 'light':
      // Light: normal weight, color dialed back to 70% so it reads as the
      // "thinner" token while remaining legible. The actual ESLOP treatment
      // is a lighter weight cut of the same sans; Fraunces normal is the
      // closest available in the font registry.
      return { fontWeight: 'normal', color: withAlpha(baseColor, 0.70) };
    case 'regular':
    default:
      return { fontWeight: 'normal', color: baseColor };
  }
}

/**
 * Multi-weight editorial headline. Each part renders as an inline `<Text>`
 * inside a flex-row wrapper. Parts with `highlight: true` get an absolute
 * sage rect behind them.
 */
export function MixedWeightHeadline(props: MixedWeightHeadlineProps): React.ReactElement {
  const {
    parts,
    fontSize = TYPE_PAGE,
    tone = 'dark-on-light',
    highlightOpacity = 0.55,
  } = props;

  const baseColor = tone === 'dark-on-light' ? N1000 : N0;
  // Estimate highlight rect height from font size + a small vertical padding.
  const highlightH = fontSize * 1.1;
  const highlightPadV = fontSize * 0.05;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
      }}
    >
      {parts.map((part, i) => {
        const ws = weightStyle(part.weight, baseColor);
        const isLast = i === parts.length - 1;

        if (!part.highlight) {
          return (
            <Text
              key={i}
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: ws.fontWeight,
                fontSize,
                color: ws.color,
                lineHeight: 1.05,
                // Add trailing space between parts (except the last one).
                marginRight: isLast ? 0 : fontSize * 0.28,
              }}
            >
              {part.text}
            </Text>
          );
        }

        // Highlighted part — wrap in a relative View so the absolute rect is
        // contained, then render the sage slab behind and the Text on top.
        return (
          <View
            key={i}
            style={{
              position: 'relative',
              marginRight: isLast ? 0 : fontSize * 0.28,
            }}
          >
            {/* Sage highlight rectangle behind text */}
            <View
              style={{
                position: 'absolute',
                top: -highlightPadV,
                left: -4,
                right: -4,
                height: highlightH,
                backgroundColor: AREA_FUTURO,
                opacity: highlightOpacity,
                borderRadius: 2,
              }}
            />
            <Text
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: ws.fontWeight,
                fontSize,
                // On highlight, always use the base color at full opacity so
                // it reads over the tinted rect regardless of tone.
                color: baseColor,
                lineHeight: 1.05,
              }}
            >
              {part.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helper (same as in EditorialTitle but co-located to avoid cross-
// primitive imports which create fragile dependency order issues in react-pdf).
// ───────────────────────────────────────────────────────────────────────────
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

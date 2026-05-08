// EditorialTitle.tsx — Mixed-weight display title with optional shaded
// keyword box. Emulates the ESLOP CI editorial signature ("Informe DE
// sostenibilidad" with one keyword in a colored shade box).
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import type { AreaKey } from '../types';
import {
  AREA_HEX,
  AREA_VALOR,
  FONT_DISPLAY,
  N0,
  N1000,
  R_SM,
  S1,
  S2,
  TYPE_HERO,
  TYPE_PAGE,
  TYPE_SECTION,
} from '../tokens';

export type EditorialTitleSize = 'hero' | 'page' | 'section';
export type EditorialTitleEmphasis = 'italic' | 'box';
export type EditorialTitleTone = 'dark-on-light' | 'light-on-dark';

export interface EditorialTitleProps {
  /** Lead segment in standard weight (Fraunces Bold). */
  leadText: string;
  /** Emphasis word(s) — receives italic or shaded-box treatment. */
  emphasisText: string;
  /** Treatment of the emphasis token. */
  emphasisStyle: EditorialTitleEmphasis;
  /** Optional area accent (drives the box / italic color). Defaults to gold. */
  areaAccent?: AreaKey;
  /** 60pt hero / 36pt page / 24pt section. */
  size?: EditorialTitleSize;
  /** Drives default text color when no override is computed. */
  tone?: EditorialTitleTone;
}

function sizeFor(size: EditorialTitleSize): number {
  switch (size) {
    case 'hero':
      return TYPE_HERO;
    case 'page':
      return TYPE_PAGE;
    case 'section':
    default:
      return TYPE_SECTION;
  }
}

/**
 * Mixed-weight editorial title.
 *
 * `'italic'`: the emphasis word renders inline with `fontStyle: italic` and
 * the area accent color (no background).
 * `'box'`: the emphasis word renders inside a `<View>` with the area accent
 * at 65% opacity as background, the word in the OPPOSITE tone for contrast.
 *
 * Lead and emphasis are concatenated with a single intervening space.
 */
export function EditorialTitle(props: EditorialTitleProps): React.ReactElement {
  const {
    leadText,
    emphasisText,
    emphasisStyle,
    areaAccent,
    size = 'page',
    tone = 'dark-on-light',
  } = props;

  const fontSize = sizeFor(size);
  const accentHex = areaAccent ? AREA_HEX[areaAccent] : AREA_VALOR;
  const baseColor = tone === 'dark-on-light' ? N1000 : N0;
  const oppositeColor = tone === 'dark-on-light' ? N0 : N1000;

  // Box uses accent at 65% opacity as background; word renders in the
  // opposite tone so it remains legible regardless of accent luminance.
  const boxBg = withAlpha(accentHex, 0.65);

  const baseStyle = {
    fontFamily: FONT_DISPLAY,
    fontWeight: 'bold' as const,
    fontSize,
    color: baseColor,
    lineHeight: 1.05,
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
      }}
    >
      <Text style={baseStyle}>{leadText} </Text>

      {emphasisStyle === 'italic' ? (
        <Text
          style={{
            ...baseStyle,
            fontStyle: 'italic',
            color: accentHex,
          }}
        >
          {emphasisText}
        </Text>
      ) : (
        // 'box' — wrap the emphasis token in a colored shade box.
        <View
          style={{
            backgroundColor: boxBg,
            borderRadius: R_SM,
            paddingHorizontal: S2,
            paddingVertical: S1,
          }}
        >
          <Text
            style={{
              ...baseStyle,
              fontStyle: 'italic',
              color: oppositeColor,
            }}
          >
            {emphasisText}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Convert a `#rrggbb` hex into an `rgba(r,g,b,a)` string. React-PDF accepts
 * rgba in `backgroundColor`, but not the modern `#rrggbbaa` form on every
 * platform/version, so we render explicit rgba to be safe.
 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

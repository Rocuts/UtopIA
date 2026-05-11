// EditorialTitle.tsx — Mixed-weight display title with optional shaded
// keyword box. Emulates the ESLOP CI editorial signature ("Informe DE
// sostenibilidad" with one keyword in a colored shade box).
//
// Reworked to compose MixedWeightHeadline internally for the 'box' emphasis
// path so the highlight-rect logic is shared. The 'italic' path keeps its
// own inline rendering (it needs per-word accent color overrides that
// MixedWeightHeadline intentionally does not expose — see Why comment below).
//
// External API is unchanged: existing page components continue to import
// EditorialTitle with the same props.
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
  TYPE_H1,
  TYPE_PAGE,
  TYPE_SECTION,
} from '../tokens';
import { MixedWeightHeadline } from './MixedWeightHeadline';

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
      // TYPE_H1 (54pt) — cover title, section divider title, closing greeting.
      // TYPE_HERO (120pt) is reserved for direct use on KPI mega-numbers and
      // the oversized "01"/"02" numerals on SectionDivider, NOT for prose
      // titles which need to share vertical space with subtitle + meta blocks.
      return TYPE_H1;
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
 * `'box'` emphasis delegates to `MixedWeightHeadline` with `highlight: true`
 * on the emphasis part — renders the ESLOP sage slab behind the word.
 *
 * `'italic'` emphasis uses inline rendering with the area accent color applied
 * directly to the emphasis Text node.
 *
 * Why MixedWeightHeadline is NOT used for 'italic': that primitive is
 * intentionally color-neutral (tone-palette only, no per-part accent override)
 * to keep it composable. Wiring in an accent color escape hatch would complicate
 * the primitive for a single caller. The 'italic' branch is simple enough to
 * keep inline.
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

  if (emphasisStyle === 'box') {
    return (
      <MixedWeightHeadline
        fontSize={fontSize}
        tone={tone}
        parts={[
          { text: leadText, weight: 'bold', highlight: false },
          { text: emphasisText, weight: 'bold', highlight: true },
        ]}
      />
    );
  }

  // 'italic' — inline rendering with accent color override on emphasis word.
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
      }}
    >
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize,
          color: baseColor,
          lineHeight: 1.05,
          marginRight: fontSize * 0.28,
        }}
      >
        {leadText}
      </Text>
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontStyle: 'italic',
          fontSize,
          color: accentHex,
          lineHeight: 1.05,
        }}
      >
        {emphasisText}
      </Text>
    </View>
  );
}

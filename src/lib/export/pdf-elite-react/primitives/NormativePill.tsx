// NormativePill.tsx — Small monospace pill for normative citations.
// Examples: "GRI 2-22", "NIIF 1", "IAS 1.81", "Art. 240 E.T."
//
// Three tone variants (spec §2.3):
//   'sage-on-cream'    — AREA_FUTURO (teal) stroke + text, cream/N50 fill
//   'sand-on-forest'   — GOLD_300 text on AREA_FUTURO fill (deep teal bg)
//   'cream-outline'    — N0 border + text, transparent fill (for dark pages)
//
// Replaces AuthorityChip but keeps it alive — Team Z retires that at final
// integration.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import {
  AREA_FUTURO,
  FONT_MONO,
  GOLD_300,
  N0,
  N50,
  R_PILL,
  S1,
  S2,
  TYPE_CHIP,
} from '../tokens';

export type NormativePillTone = 'sage-on-cream' | 'sand-on-forest' | 'cream-outline';

export interface NormativePillProps {
  label: string;
  tone?: NormativePillTone;
  /** Optional href — react-pdf Link wrapping not done here to keep the
   * primitive layout-only; callers wrap with <Link> if needed. */
}

interface PillStyle {
  bg: string;
  border: string;
  text: string;
}

function resolveStyle(tone: NormativePillTone): PillStyle {
  switch (tone) {
    case 'sage-on-cream':
      // Teal (sage) text + teal border on pale cream background. Matches GRI
      // pills on white pages in the reference (pages 4-5).
      return { bg: N50, border: AREA_FUTURO, text: AREA_FUTURO };
    case 'sand-on-forest':
      // ESLOP "inverse" pill: sand/gold text on deep teal fill.
      // Matches the section divider page styling (page 83).
      return { bg: AREA_FUTURO, border: AREA_FUTURO, text: GOLD_300 };
    case 'cream-outline':
      // Transparent fill, cream border + text. For dark/forest backgrounds
      // (cover page, SectionDivider pages).
      return { bg: 'transparent', border: N0, text: N0 };
  }
}

/**
 * Monospace pill tag. 7pt font, pill radius, 0.6pt border.
 * Self-sizes (alignSelf: 'flex-start') — caller sets flex direction.
 */
export function NormativePill(props: NormativePillProps): React.ReactElement {
  const { label, tone = 'sage-on-cream' } = props;
  const s = resolveStyle(tone);

  return (
    <View
      style={{
        backgroundColor: s.bg,
        borderWidth: 0.6,
        borderColor: s.border,
        borderStyle: 'solid',
        borderRadius: R_PILL,
        paddingHorizontal: S2,
        paddingVertical: S1,
        alignSelf: 'flex-start',
        marginRight: S1,
      }}
    >
      <Text
        style={{
          fontFamily: FONT_MONO,
          fontSize: TYPE_CHIP,
          color: s.text,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

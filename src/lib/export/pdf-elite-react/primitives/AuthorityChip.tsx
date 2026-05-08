// AuthorityChip.tsx — Tiny uppercase letterspaced chip used as authority tag
// (NIIF Secc. 17, Art. 240 ET, Decreto 2420/2015) below editorial titles.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { FONT_SANS, GOLD_500, N500, R_SM, S1, TYPE_CHIP, WINE_500, AREA_VERDAD } from '../tokens';

export type AuthorityChipTone = 'gold' | 'wine' | 'midnight' | 'dim';

export interface AuthorityChipProps {
  label: string;
  tone?: AuthorityChipTone;
}

const TONE_HEX: Record<AuthorityChipTone, string> = {
  gold: GOLD_500,
  wine: WINE_500,
  midnight: AREA_VERDAD,
  dim: N500,
};

/**
 * Bordered chip with letterspaced uppercase text. 7pt font, 0.5pt border.
 * Used as authority/source tag (e.g. GRI tags in the reference design).
 */
export function AuthorityChip(props: AuthorityChipProps): React.ReactElement {
  const { label, tone = 'gold' } = props;
  const color = TONE_HEX[tone];
  return (
    <View
      style={{
        borderWidth: 0.5,
        borderColor: color,
        borderStyle: 'solid',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: R_SM,
        alignSelf: 'flex-start',
        marginRight: S1,
      }}
    >
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE_CHIP,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

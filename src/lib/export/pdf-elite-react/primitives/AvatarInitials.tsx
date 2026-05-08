// AvatarInitials.tsx — Circular avatar with area-accent gradient backdrop and
// initials in Fraunces Bold. Used inside CrescentMask portraits.
// ───────────────────────────────────────────────────────────────────────────
//
// Implementation note: SVG <Text> in @react-pdf does not expose font typing
// (SVGPresentationAttributes lacks fontFamily/Size/Weight). To keep this
// primitive type-clean, we render the gradient circle as Svg and overlay
// the initials with a layout View+Text positioned absolutely.

import * as React from 'react';
import { View, Text, Svg, Defs, LinearGradient, Stop, Circle } from '@react-pdf/renderer';
import type { AreaKey } from '../types';
import { AREA_HEX, FONT_DISPLAY, N0, darken } from '../tokens';

export interface AvatarInitialsProps {
  initials: string;
  areaAccent: AreaKey;
  size: number;
}

let __id = 0;
function uid(prefix: string): string {
  __id = (__id + 1) % 1_000_000;
  return `${prefix}-${__id}`;
}

/**
 * Circular avatar: linear gradient from area accent (top) to a 30%-darker
 * shade (bottom), with initials in Fraunces Bold centered.
 */
export function AvatarInitials(props: AvatarInitialsProps): React.ReactElement {
  const { initials, areaAccent, size } = props;
  const top = AREA_HEX[areaAccent];
  const bottom = darken(top, 0.3);
  const r = size / 2;
  const gradId = uid(`grad-${areaAccent}`);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={top} stopOpacity={1} />
            <Stop offset="100%" stopColor={bottom} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill={`url(#${gradId})`} />
      </Svg>

      {/* Initials overlay — Fraunces Bold, white, centered. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: size * 0.4,
            color: N0,
          }}
        >
          {initials}
        </Text>
      </View>
    </View>
  );
}

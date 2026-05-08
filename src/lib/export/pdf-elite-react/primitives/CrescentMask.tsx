// CrescentMask.tsx — Circular / crescent portrait container with optional
// satellite circle. Wraps a PortraitSpec (initials avatar OR image).
// ───────────────────────────────────────────────────────────────────────────
//
// Strategy: render the main portrait inside a square <View> with overflow
// hidden + circular borderRadius — this clips both <AvatarInitials> and
// raster <Image> children to a perfect circle without needing SVG clipPath
// (which has variable @react-pdf support for raster bitmap clipping).
//
// The "crescent" optical signature comes from the satellite ball offset
// outside the main circle, mimicking the moon-arc + bubble portraits in the
// editorial reference design.

import * as React from 'react';
import { View, Image } from '@react-pdf/renderer';
import type { PortraitSpec } from '../types';
import { R_PILL } from '../tokens';
import { AvatarInitials } from './AvatarInitials';

export interface CrescentSatellite {
  size: number;
  offset?: { x: number; y: number };
}

export interface CrescentMaskProps {
  portrait: PortraitSpec;
  size: number;
  satellite?: CrescentSatellite;
}

function PortraitContent(props: { portrait: PortraitSpec; size: number }): React.ReactElement {
  const { portrait, size } = props;
  if (portrait.kind === 'image' && portrait.imageUrl) {
    return (
      <Image
        src={portrait.imageUrl}
        style={{ width: size, height: size, objectFit: 'cover' }}
      />
    );
  }
  // Fallback / 'initials' case.
  return (
    <AvatarInitials
      initials={portrait.initials ?? '••'}
      areaAccent={portrait.areaAccent}
      size={size}
    />
  );
}

/**
 * Circular portrait + optional satellite. Caller positions the wrapper.
 * Returns a `<View>` with explicit width/height so it can be flexed.
 */
export function CrescentMask(props: CrescentMaskProps): React.ReactElement {
  const { portrait, size, satellite } = props;
  const totalW = satellite ? size + (satellite.offset?.x ?? satellite.size * 0.3) + satellite.size : size;
  const totalH = satellite ? size + Math.max(0, -(satellite.offset?.y ?? -satellite.size * 0.4)) : size;

  return (
    <View style={{ width: totalW, height: totalH, position: 'relative' }}>
      {/* Main circle — clipped via borderRadius + overflow hidden. */}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: R_PILL,
          overflow: 'hidden',
        }}
      >
        <PortraitContent portrait={portrait} size={size} />
      </View>

      {/* Optional satellite — smaller circle offset to create the crescent
         optical signature. */}
      {satellite ? (
        <View
          style={{
            position: 'absolute',
            top: satellite.offset?.y ?? -satellite.size * 0.4,
            left: satellite.offset?.x ?? size - satellite.size * 0.3,
            width: satellite.size,
            height: satellite.size,
            borderRadius: R_PILL,
            overflow: 'hidden',
          }}
        >
          <PortraitContent portrait={portrait} size={satellite.size} />
        </View>
      ) : null}
    </View>
  );
}

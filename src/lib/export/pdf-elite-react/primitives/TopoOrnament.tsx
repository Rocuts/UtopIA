// TopoOrnament.tsx — Topographic-line ornament rendered as inline SVG.
// Variants:
//   ribbons: 6–8 cubic Bézier curves (deterministic, seeded LCG)
//   hex:     low-density hex grid
//   lines:   horizontal sine-perturbed lines
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { Svg, Path, G, Line } from '@react-pdf/renderer';
import type { AreaKey } from '../types';
import { AREA_HEX, AREA_VALOR, PAGE_H, PAGE_W } from '../tokens';

export type TopoVariant = 'ribbons' | 'hex' | 'lines';

export interface TopoOrnamentProps {
  variant: TopoVariant;
  /** Stroke alpha, 0..1. Defaults to 0.08. */
  opacity?: number;
  /** Optional area accent (drives stroke color). Defaults to gold/valor. */
  areaAccent?: AreaKey;
  /** Deterministic seed for ribbons/hex jitter. Defaults to 1337. */
  seed?: number;
  width?: number;
  height?: number;
}

// Linear-congruential generator — deterministic & lib-free.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function ribbonsPaths(rng: () => number, w: number, h: number): string[] {
  const PATH_COUNT = 8;
  const out: string[] = [];
  for (let i = 0; i < PATH_COUNT; i++) {
    const y0 = h * (0.1 + rng() * 0.8);
    const y1 = h * (0.1 + rng() * 0.8);
    const c1x = w * (0.15 + rng() * 0.2);
    const c1y = h * (0.05 + rng() * 0.9);
    const c2x = w * (0.55 + rng() * 0.3);
    const c2y = h * (0.05 + rng() * 0.9);
    out.push(
      `M -10 ${y0.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${(w + 10).toFixed(2)} ${y1.toFixed(2)}`,
    );
  }
  return out;
}

function hexElements(w: number, h: number, stroke: string, opacity: number): React.ReactElement[] {
  const r = 18; // hex radius (point)
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  const cols = Math.ceil(w / dx) + 1;
  const rows = Math.ceil(h / dy) + 1;
  const out: React.ReactElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * dx + (row % 2 === 1 ? dx / 2 : 0);
      const cy = row * dy;
      const points: string[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = (Math.PI / 3) * k - Math.PI / 6;
        const x = cx + r * Math.cos(ang);
        const y = cy + r * Math.sin(ang);
        points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      const d = `M ${points.join(' L ')} Z`;
      out.push(
        <Path
          key={`h-${row}-${col}`}
          d={d}
          stroke={stroke}
          strokeOpacity={opacity}
          strokeWidth={0.4}
          fill="none"
        />,
      );
    }
  }
  return out;
}

function lineElements(w: number, h: number, stroke: string, opacity: number): React.ReactElement[] {
  const stride = 24;
  const out: React.ReactElement[] = [];
  for (let y = 0; y < h; y += stride) {
    out.push(
      <Line
        key={`l-${y}`}
        x1={0}
        y1={y}
        x2={w}
        y2={y}
        stroke={stroke}
        strokeOpacity={opacity}
        strokeWidth={0.4}
      />,
    );
  }
  return out;
}

/**
 * Editorial topographic ornament. Returns a positioned `<Svg>` block. Caller
 * is responsible for absolute positioning (this primitive is layout-neutral).
 */
export function TopoOrnament(props: TopoOrnamentProps): React.ReactElement {
  const {
    variant,
    opacity = 0.08,
    areaAccent,
    seed = 1337,
    width = PAGE_W,
    height = PAGE_H,
  } = props;

  const stroke = areaAccent ? AREA_HEX[areaAccent] : AREA_VALOR;
  const rng = lcg(seed);

  if (variant === 'ribbons') {
    const paths = ribbonsPaths(rng, width, height);
    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <G>
          {paths.map((d, i) => (
            <Path
              key={`r-${i}`}
              d={d}
              stroke={stroke}
              strokeOpacity={opacity}
              strokeWidth={0.6}
              fill="none"
            />
          ))}
        </G>
      </Svg>
    );
  }

  if (variant === 'hex') {
    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <G>{hexElements(width, height, stroke, opacity)}</G>
      </Svg>
    );
  }

  // 'lines'
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <G>{lineElements(width, height, stroke, opacity)}</G>
    </Svg>
  );
}

// TopoOrnament.tsx — Topographic-line ornament rendered as inline SVG.
//
// ESLOP visual DNA: concentric, irregular, organic contour lines — like
// topographic maps of a river delta or mineral vein cross-section. The
// reference pages (cover, p.2, p.8, p.16, p.17, p.83, p.84) show two
// distinct topologies:
//
//   1. Corner cluster: dense concentric contours in the top-right or
//      bottom-left corner, fading outward. The cluster is visually "rounded
//      irregular" — not perfectly circular, slightly off-center.
//
//   2. Full-bleed field: contours span the full page width/height as
//      flowing, wavy horizontal bands (pages 2, 83).
//
// Variants (spec §2.1):
//   'corner-tr'     — concentric organic cluster, top-right corner
//   'corner-bl'     — same cluster, bottom-left corner (mirrored)
//   'full-bleed'    — flowing wavy contours across full width/height
//   'masked-circle' — contour cluster cropped to a circular clipPath
//
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { Svg, Path, G, Defs, ClipPath } from '@react-pdf/renderer';
import type { AreaKey } from '../types';
import { AREA_HEX, GOLD_300, PAGE_H, PAGE_W } from '../tokens';

/**
 * ESLOP spec §2.1 variants:
 *   'corner-tr'    — concentric organic cluster, top-right corner
 *   'corner-bl'    — concentric organic cluster, bottom-left corner
 *   'full-bleed'   — flowing wavy contours, full page field
 *   'masked-circle'— contour cluster inside a circular clip region
 *
 * Legacy aliases (backwards-compat — CoverPage, SectionDivider, OrbitalPillarsPage
 * and existing tests use these names; Team Z migrates call-sites to the new names):
 *   'ribbons' → alias for 'full-bleed' (was: sparse random Bézier curves)
 *   'lines'   → alias for 'full-bleed'
 *   'hex'     → alias for 'corner-tr'
 */
export type TopoVariant =
  | 'corner-tr'
  | 'corner-bl'
  | 'full-bleed'
  | 'masked-circle'
  // Legacy aliases — kept for backwards-compat
  | 'ribbons'
  | 'lines'
  | 'hex';

export interface TopoOrnamentProps {
  variant: TopoVariant;
  /** Stroke alpha, 0..1. Defaults to 0.10. */
  opacity?: number;
  /** Optional area accent (drives stroke color). Defaults to gold/valor. */
  areaAccent?: AreaKey;
  /** Deterministic seed for line jitter. Defaults to 1337. */
  seed?: number;
  width?: number;
  height?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Deterministic LCG — same as before, keeps seeded results stable.
// ───────────────────────────────────────────────────────────────────────────
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Contour ring generator — concentric organic loops.
//
// Each ring is a closed cubic Bézier approximating an ellipse with controlled
// random perturbation applied to each control handle. The result is an
// irregular, organic closed contour — not a perfect circle.
//
// cx, cy: center of the cluster in SVG coordinates.
// baseR:  radius of the innermost ring.
// count:  number of concentric rings.
// spread: radial increment per ring.
// jitter: 0..1, how much each control handle is perturbed.
// ───────────────────────────────────────────────────────────────────────────
function buildConcentricRings(
  cx: number,
  cy: number,
  baseR: number,
  count: number,
  spread: number,
  jitter: number,
  rng: () => number,
): string[] {
  const rings: string[] = [];

  for (let i = 0; i < count; i++) {
    const r = baseR + i * spread;
    // 4-point cubic Bézier approximation of a circle.
    // k = 0.5522847 is the magic constant for cubic Bézier circles.
    const k = 0.5522847;
    // Apply independent jitter to each handle to break the perfect circle.
    const j = () => (rng() - 0.5) * 2 * jitter * r;

    const rings_d =
      `M ${(cx).toFixed(2)} ${(cy - r + j()).toFixed(2)} ` +
      `C ${(cx + r * k + j()).toFixed(2)} ${(cy - r + j()).toFixed(2)}, ` +
      `${(cx + r + j()).toFixed(2)} ${(cy - r * k + j()).toFixed(2)}, ` +
      `${(cx + r + j()).toFixed(2)} ${(cy + j()).toFixed(2)} ` +
      `C ${(cx + r + j()).toFixed(2)} ${(cy + r * k + j()).toFixed(2)}, ` +
      `${(cx + r * k + j()).toFixed(2)} ${(cy + r + j()).toFixed(2)}, ` +
      `${(cx + j()).toFixed(2)} ${(cy + r + j()).toFixed(2)} ` +
      `C ${(cx - r * k + j()).toFixed(2)} ${(cy + r + j()).toFixed(2)}, ` +
      `${(cx - r + j()).toFixed(2)} ${(cy + r * k + j()).toFixed(2)}, ` +
      `${(cx - r + j()).toFixed(2)} ${(cy + j()).toFixed(2)} ` +
      `C ${(cx - r + j()).toFixed(2)} ${(cy - r * k + j()).toFixed(2)}, ` +
      `${(cx - r * k + j()).toFixed(2)} ${(cy - r + j()).toFixed(2)}, ` +
      `${(cx).toFixed(2)} ${(cy - r + j()).toFixed(2)} Z`;

    rings.push(rings_d);
  }
  return rings;
}

// ───────────────────────────────────────────────────────────────────────────
// Full-bleed wavy contours — flowing horizontal bands with organic Y
// displacement. Matches pages 2, 83 (the wide wavy topo field).
// ───────────────────────────────────────────────────────────────────────────
function buildWavyContours(
  w: number,
  h: number,
  count: number,
  rng: () => number,
): string[] {
  const lines: string[] = [];
  const stride = h / (count + 1);

  for (let i = 1; i <= count; i++) {
    const baseY = stride * i;
    // Two waves per line: long-wavelength (terrain) + short-wavelength (detail).
    const amp1 = h * (0.03 + rng() * 0.04); // 3–7% of height
    const amp2 = h * (0.008 + rng() * 0.012); // 0.8–2% of height
    const phase1 = rng() * Math.PI * 2;
    const phase2 = rng() * Math.PI * 2;
    const freq1 = 1.5 + rng() * 1.5; // 1.5–3 full cycles across width
    const freq2 = 4 + rng() * 4; // 4–8 full cycles

    // Sample 32 points across the width and build a polyline approximated
    // as a single SVG path with short line segments. For print resolution
    // 32 samples across 595pt gives segments of ~18pt which looks smooth.
    const SAMPLES = 48;
    const pts: string[] = [];
    for (let s = 0; s <= SAMPLES; s++) {
      const x = (s / SAMPLES) * w;
      const t = s / SAMPLES; // 0..1
      const y =
        baseY +
        amp1 * Math.sin(t * Math.PI * 2 * freq1 + phase1) +
        amp2 * Math.sin(t * Math.PI * 2 * freq2 + phase2);
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }

    lines.push(`M ${pts[0]} L ${pts.slice(1).join(' L ')}`);
  }
  return lines;
}

// ───────────────────────────────────────────────────────────────────────────
// Unique ID utility (same approach as AvatarInitials)
// ───────────────────────────────────────────────────────────────────────────
let __clipId = 0;
function uid(): string {
  __clipId = (__clipId + 1) % 1_000_000;
  return `topo-clip-${__clipId}`;
}

/**
 * Editorial topographic ornament. Returns a positioned `<Svg>` block.
 * Caller is responsible for absolute positioning (layout-neutral).
 */
export function TopoOrnament(props: TopoOrnamentProps): React.ReactElement {
  const {
    variant,
    opacity = 0.10,
    areaAccent,
    seed = 1337,
    width = PAGE_W,
    height = PAGE_H,
  } = props;

  // Why: On cream/light pages AREA_VALOR (gold) reads well. On forest/dark
  // pages GOLD_300 (lighter sand) is preferred. The caller can override via
  // areaAccent. The default stroke is GOLD_300 (lighter than AREA_VALOR)
  // to match the reference pages where the contours appear as a pale veil.
  const stroke = areaAccent ? AREA_HEX[areaAccent] : GOLD_300;
  const rng = lcg(seed);

  // Normalize legacy aliases to canonical variant names.
  const resolvedVariant: 'corner-tr' | 'corner-bl' | 'full-bleed' | 'masked-circle' =
    variant === 'ribbons' || variant === 'lines' ? 'full-bleed' :
    variant === 'hex' ? 'corner-tr' :
    variant;

  // ── corner-tr ─────────────────────────────────────────────────────────
  if (resolvedVariant === 'corner-tr') {
    // Cluster center at top-right: roughly (width * 0.85, height * 0.12).
    // 14 rings, innermost radius 18pt, spreading 14pt per ring, jitter 0.18.
    const cx = width * 0.85;
    const cy = height * 0.12;
    const rings = buildConcentricRings(cx, cy, 18, 14, 14, 0.18, rng);

    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <G>
          {rings.map((d, i) => (
            <Path
              key={`ctr-${i}`}
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

  // ── corner-bl ─────────────────────────────────────────────────────────
  if (resolvedVariant === 'corner-bl') {
    // Mirror of corner-tr: bottom-left at (width * 0.15, height * 0.88).
    const cx = width * 0.15;
    const cy = height * 0.88;
    const rings = buildConcentricRings(cx, cy, 18, 14, 14, 0.18, rng);

    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <G>
          {rings.map((d, i) => (
            <Path
              key={`cbl-${i}`}
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

  // ── masked-circle ─────────────────────────────────────────────────────
  if (resolvedVariant === 'masked-circle') {
    // Contour cluster confined to a circular clip region. Used on pages 17 and
    // 84 (top-right corner, medium-sized circle containing dense topo lines).
    // The ClipPath circle matches the ornament bounding box inscribed circle.
    const clipId = uid();
    const cr = Math.min(width, height) / 2;
    const cx = width / 2;
    const cy = height / 2;
    // More rings, tighter spread for the denser "fingerprint" look on p.17/84.
    const rings = buildConcentricRings(cx, cy, 8, 22, 9, 0.22, rng);

    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={`M ${cx} ${cy - cr} A ${cr} ${cr} 0 1 1 ${cx - 0.001} ${cy - cr} Z`} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          {rings.map((d, i) => (
            <Path
              key={`mc-${i}`}
              d={d}
              stroke={stroke}
              strokeOpacity={opacity}
              strokeWidth={0.5}
              fill="none"
            />
          ))}
        </G>
      </Svg>
    );
  }

  // ── full-bleed ────────────────────────────────────────────────────────
  // Flowing horizontal wavy contours across the full field. 20 lines.
  const wavePaths = buildWavyContours(width, height, 20, rng);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <G>
        {wavePaths.map((d, i) => (
          <Path
            key={`fb-${i}`}
            d={d}
            stroke={stroke}
            strokeOpacity={opacity}
            strokeWidth={0.5}
            fill="none"
          />
        ))}
      </G>
    </Svg>
  );
}

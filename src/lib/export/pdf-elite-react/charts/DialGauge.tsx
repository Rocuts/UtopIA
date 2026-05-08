// charts/DialGauge.tsx — semicircle gauge with 3 colored zones + needle.
// Hand-coded SVG. Self-contained.
import React from 'react';
import { Svg, Path, Line, Circle, Text as SvgText, G } from '@react-pdf/renderer';
import type { DialGaugeSpec } from '../types';
import {
  WINE_500,
  GOLD_400,
  AREA_VALOR,
  N1000,
  N700,
  N300,
} from '../tokens';

interface Props {
  gauge: DialGaugeSpec;
  size?: number;
}

/**
 * Polar -> cartesian for a semicircle from 180° (left) to 0° (right).
 * Angle in degrees: 180 = left, 90 = top, 0 = right.
 */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (Math.PI / 180) * angleDeg;
  return {
    x: cx + r * Math.cos(rad),
    // SVG y grows downward; we want "top" at angle=90 to be visually up,
    // so y = cy - r * sin(angle).
    y: cy - r * Math.sin(rad),
  };
}

/**
 * SVG arc path from `startAngle` to `endAngle` (degrees, 180→0 sweep).
 * Uses A (elliptical arc) command. For a half-circle going clockwise from
 * 180° down to 0°, we sweep flag = 0 (counter-clockwise in SVG screen coords
 * because we inverted Y). This is the conventional editorial gauge orientation.
 */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  // sweep 0 because Y is inverted (visual screen coords)
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function DialGauge({ gauge, size = 180 }: Props) {
  const W = size;
  const H = size * 0.78; // semicircle + room for label
  const cx = W / 2;
  const cy = H * 0.78;
  const radius = size * 0.42;
  const arcThickness = Math.max(8, size * 0.07);

  const { value, min, max, thresholds, label, caption } = gauge;
  const [low, mid, high] = thresholds;

  // Map value range [min, max] to angle range [180°, 0°]
  function valueToAngle(v: number): number {
    const t = clamp((v - min) / (max - min || 1), 0, 1);
    return 180 - t * 180;
  }

  // Three zones
  const zones: Array<{ from: number; to: number; color: string }> = [
    { from: min, to: low, color: WINE_500 },
    { from: low, to: mid, color: GOLD_400 },
    { from: mid, to: high, color: AREA_VALOR },
  ];

  const needleAngle = valueToAngle(value);
  const needleEnd = polar(cx, cy, radius - arcThickness / 2, needleAngle);

  const valueText =
    Math.abs(value) >= 100
      ? value.toFixed(0)
      : Math.abs(value) >= 10
        ? value.toFixed(1)
        : value.toFixed(2);

  return (
    <Svg width={W} height={H + 36}>
      {/* Background arc (full track, lightly tinted) */}
      <Path
        d={arcPath(cx, cy, radius, 180, 0)}
        stroke={N300}
        strokeWidth={arcThickness}
        fill="none"
      />

      {/* Three colored zones */}
      {zones.map((z, i) => {
        const a1 = valueToAngle(z.from);
        const a2 = valueToAngle(z.to);
        // Skip degenerate zones (from === to) — they'd produce zero-length arcs
        if (Math.abs(a1 - a2) < 0.5) return null;
        return (
          <Path
            key={`zone-${i}`}
            d={arcPath(cx, cy, radius, a1, a2)}
            stroke={z.color}
            strokeWidth={arcThickness}
            fill="none"
          />
        );
      })}

      {/* Needle */}
      <Line
        x1={cx}
        y1={cy}
        x2={needleEnd.x}
        y2={needleEnd.y}
        stroke={N1000}
        strokeWidth={2}
      />
      <Circle cx={cx} cy={cy} r={4} fill={N1000} />

      {/* Big numeric */}
      <SvgText
        x={cx}
        y={cy + 4}
        style={{
          fontFamily: 'Fraunces',
          fontWeight: 700,
          fontSize: size * 0.13,
          fill: N1000,
          textAnchor: 'middle',
        }}
      >
        {valueText}
      </SvgText>

      {/* Label uppercase letterspaced */}
      <SvgText
        x={cx}
        y={H + 14}
        style={{
          fontFamily: 'Geist',
          fontSize: 8,
          fill: N700,
          textAnchor: 'middle',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </SvgText>

      {caption && (
        <SvgText
          x={cx}
          y={H + 26}
          style={{
            fontFamily: 'Geist',
            fontSize: 7,
            fill: N300,
            textAnchor: 'middle',
          }}
        >
          {caption}
        </SvgText>
      )}
    </Svg>
  );
}

// charts/DialGauge.tsx — Semicircle gauge with 3 colored zones + needle.
// Hand-coded SVG. Palette: SAGE_500 (low zone) → SAND_500 (mid) → WINE_700 (high).
// Track: SAND_200. Needle + center dot: FOREST_900.
// Spec §3.8: arc width 14pt, numeral Fraunces 32pt FOREST_900.
import React from 'react';
import { Svg, Path, Line, Circle, Text as SvgText, G } from '@react-pdf/renderer';
import type { DialGaugeSpec } from '../types';
import {
  CHARCOAL_700,
  FOREST_900,
  SAGE_500,
  SAND_200,
  SAND_500,
  WINE_700,
} from '../tokens';

interface Props {
  gauge: DialGaugeSpec;
  size?: number;
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (Math.PI / 180) * angleDeg;
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  };
}

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
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function DialGauge({ gauge, size = 180 }: Props) {
  const W = size;
  const H = size * 0.78;
  const cx = W / 2;
  const cy = H * 0.78;
  const radius = size * 0.42;
  // Spec §3.8: arc width 14pt. Scale with gauge size proportionally from 180pt base.
  const arcThickness = Math.round(14 * (size / 180));

  const { value, min, max, thresholds, label, caption } = gauge;
  const [low, mid, high] = thresholds;

  function valueToAngle(v: number): number {
    const t = clamp((v - min) / (max - min || 1), 0, 1);
    return 180 - t * 180;
  }

  // Zone colors per spec §3.8: SAGE_500 (low) → SAND_500 (mid) → WINE_700 (high)
  const zones: Array<{ from: number; to: number; color: string }> = [
    { from: min, to: low, color: SAGE_500 },
    { from: low, to: mid, color: SAND_500 },
    { from: mid, to: high, color: WINE_700 },
  ];

  const needleAngle = valueToAngle(value);
  const needleEnd = polar(cx, cy, radius - arcThickness / 2, needleAngle);

  // Spec §3.8: numeral Fraunces 32pt FOREST_900 (from size 180 baseline)
  const numeralSize = Math.round(32 * (size / 180));

  const valueText =
    Math.abs(value) >= 100
      ? value.toFixed(0)
      : Math.abs(value) >= 10
        ? value.toFixed(1)
        : value.toFixed(2);

  return (
    <Svg width={W} height={H + 36}>
      {/* Background arc track — SAND_200 (spec §3.8) */}
      <Path
        d={arcPath(cx, cy, radius, 180, 0)}
        stroke={SAND_200}
        strokeWidth={arcThickness}
        fill="none"
      />

      {/* Three colored zone arcs */}
      {zones.map((z, i) => {
        const a1 = valueToAngle(z.from);
        const a2 = valueToAngle(z.to);
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

      {/* Needle — FOREST_900 (spec §3.8) */}
      <Line
        x1={cx}
        y1={cy}
        x2={needleEnd.x}
        y2={needleEnd.y}
        stroke={FOREST_900}
        strokeWidth={2}
      />
      <Circle cx={cx} cy={cy} r={4} fill={FOREST_900} />

      {/* Numeral — Fraunces, FOREST_900 (spec §3.8) */}
      <SvgText
        x={cx}
        y={cy + 4}
        style={{
          fontFamily: 'Fraunces',
          fontWeight: 700,
          fontSize: numeralSize,
          fill: FOREST_900,
          textAnchor: 'middle',
        }}
      >
        {valueText}
      </SvgText>

      {/* Label — Geist 12pt 600 FOREST_900 (spec §3.8) */}
      <SvgText
        x={cx}
        y={H + 14}
        style={{
          fontFamily: 'Geist',
          fontSize: Math.round(12 * (size / 180)),
          fill: FOREST_900,
          textAnchor: 'middle',
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </SvgText>

      {/* SAND_200 underline 50pt (spec §3.8) */}
      <Line
        x1={cx - 25}
        y1={H + 20}
        x2={cx + 25}
        y2={H + 20}
        strokeWidth={0.5}
        stroke={SAND_200}
      />

      {/* Caption — Geist 9pt CHARCOAL_700 italic (spec §3.8) */}
      {caption && (
        <SvgText
          x={cx}
          y={H + 30}
          style={{
            fontFamily: 'Geist',
            fontSize: Math.round(9 * (size / 180)),
            fill: CHARCOAL_700,
            textAnchor: 'middle',
            fontStyle: 'italic',
          }}
        >
          {caption}
        </SvgText>
      )}
    </Svg>
  );
}

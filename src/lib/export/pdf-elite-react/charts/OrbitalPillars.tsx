// charts/OrbitalPillars.tsx — Central health score with 4 satellite pillars.
// Hand-coded SVG. Forest/sage/sand palette.
// Center: FOREST_900 disc, score in SAND_500 Fraunces 48pt.
// Satellites: filled with their areaAccent color, score in CREAM_0.
// Connectors: SAND_300 0.5pt lines (spec §3.9).
import React from 'react';
import { Svg, Circle, Path, Text as SvgText, G, Line } from '@react-pdf/renderer';
import type { PillarsSpec, AreaKey } from '../types';
import {
  AREA_ESCUDO,
  AREA_FUTURO,
  AREA_VALOR,
  AREA_VERDAD,
  CREAM_0,
  FOREST_700,
  FOREST_900,
  SAGE_300,
  SAND_300,
  SAND_500,
} from '../tokens';

interface Props {
  pillars: PillarsSpec;
  width?: number;
  height?: number;
}

function areaHex(area: AreaKey): string {
  switch (area) {
    case 'escudo': return AREA_ESCUDO;
    case 'valor':  return AREA_VALOR;
    case 'verdad': return AREA_VERDAD;
    case 'futuro': return AREA_FUTURO;
  }
}

export function OrbitalPillars({ pillars, width = 300, height = 300 }: Props) {
  const cx = width / 2;
  const cy = height / 2;
  // Scale radii with the available space
  const scale = Math.min(width, height) / 500;
  const centerR = Math.round(80 * scale);
  const satR    = Math.round(50 * scale);
  const orbitR  = Math.round(180 * scale);

  // Compass positions: N=Escudo (12), E=Valor (3), S=Futuro (6), W=Verdad (9)
  const positions = [
    { x: cx,           y: cy - orbitR }, // N
    { x: cx + orbitR,  y: cy           }, // E
    { x: cx,           y: cy + orbitR }, // S
    { x: cx - orbitR,  y: cy           }, // W
  ];

  const labelFontSize = Math.max(7, Math.round(9 * scale));
  const scoreFontSize = Math.max(12, Math.round(22 * scale));
  const centerFontSize = Math.max(18, Math.round(36 * scale));
  const eyebrowFontSize = Math.max(6, Math.round(9 * scale));
  const kpiFontSize = Math.max(6, Math.round(8 * scale));

  return (
    <Svg width={width} height={height}>
      {/* Connectors — SAND_300 0.5pt (spec §3.9) */}
      {pillars.satellites.map((s, i) => {
        const p = positions[i];
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        return (
          <Line
            key={`conn-${i}`}
            x1={cx + ux * centerR}
            y1={cy + uy * centerR}
            x2={p.x - ux * satR}
            y2={p.y - uy * satR}
            stroke={SAND_300}
            strokeWidth={0.5}
          />
        );
      })}

      {/* Central disc */}
      <Circle cx={cx} cy={cy} r={centerR} fill={FOREST_900} />
      {/* Outer ring accent */}
      <Circle cx={cx} cy={cy} r={centerR} fill="none" stroke={SAND_300} strokeWidth={0.8} />

      {/* Overall score numeral */}
      <SvgText
        x={cx}
        y={cy - 4}
        style={{
          fontFamily: 'Fraunces',
          fontWeight: 700,
          fontSize: centerFontSize,
          fill: SAND_500,
          textAnchor: 'middle',
        }}
      >
        {pillars.overall.toFixed(0)}
      </SvgText>

      {/* "OVERALL" eyebrow */}
      <SvgText
        x={cx}
        y={cy + eyebrowFontSize + 4}
        style={{
          fontFamily: 'Geist',
          fontSize: eyebrowFontSize,
          fill: SAGE_300,
          textAnchor: 'middle',
          letterSpacing: 1,
        }}
      >
        OVERALL
      </SvgText>

      {/* Satellites */}
      {pillars.satellites.map((s, i) => {
        const p = positions[i];
        const color = areaHex(s.areaAccent);
        // topKpi label position: above for N satellite, below for S, left for W, right for E
        const isNorth = i === 0;
        const isSouth = i === 2;
        const isEast  = i === 1;
        const labelY  = isSouth
          ? p.y + satR + kpiFontSize + 6
          : p.y - satR - kpiFontSize - 2;

        return (
          <G key={`sat-${i}`}>
            <Circle cx={p.x} cy={p.y} r={satR} fill={color} />

            {/* Score numeral inside satellite */}
            <SvgText
              x={p.x}
              y={p.y + 2}
              style={{
                fontFamily: 'Fraunces',
                fontWeight: 700,
                fontSize: scoreFontSize,
                fill: CREAM_0,
                textAnchor: 'middle',
              }}
            >
              {s.score.toFixed(0)}
            </SvgText>

            {/* Satellite name — below the score, inside the circle */}
            <SvgText
              x={p.x}
              y={p.y + scoreFontSize * 0.8 + 4}
              style={{
                fontFamily: 'Geist',
                fontSize: labelFontSize,
                fill: CREAM_0,
                textAnchor: 'middle',
                letterSpacing: 0.4,
              }}
            >
              {s.label.length > 9 ? `${s.label.slice(0, 8)}…` : s.label}
            </SvgText>

            {/* topKpi — outside the satellite */}
            <SvgText
              x={p.x}
              y={labelY}
              style={{
                fontFamily: 'GeistMono',
                fontSize: kpiFontSize,
                fill: SAND_300,
                textAnchor: 'middle',
              }}
            >
              {s.topKpi.length > 28 ? `${s.topKpi.slice(0, 26)}…` : s.topKpi}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

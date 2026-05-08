// charts/OrbitalPillars.tsx — central health score with 4 satellites at 12/3/6/9.
// Hand-coded SVG.
import React from 'react';
import { Svg, Circle, Path, Text as SvgText, G } from '@react-pdf/renderer';
import type { PillarsSpec, AreaKey } from '../types';
import {
  AREA_ESCUDO,
  AREA_VALOR,
  AREA_VERDAD,
  AREA_FUTURO,
  GOLD_500,
  N0,
  N1000,
  N700,
} from '../tokens';

interface Props {
  pillars: PillarsSpec;
  width?: number;
  height?: number;
}

function areaHex(area: AreaKey): string {
  switch (area) {
    case 'escudo':
      return AREA_ESCUDO;
    case 'valor':
      return AREA_VALOR;
    case 'verdad':
      return AREA_VERDAD;
    case 'futuro':
      return AREA_FUTURO;
  }
}

export function OrbitalPillars({ pillars, width = 500, height = 500 }: Props) {
  const cx = width / 2;
  const cy = height / 2;
  const centerR = 80;
  const satR = 50;
  const orbitR = 180;

  // Positions for satellites at 12, 3, 6, 9 (clockwise from top).
  // SVG coords: top is (cx, cy - orbitR), right is (cx + orbitR, cy), etc.
  const positions = [
    { x: cx, y: cy - orbitR }, // 12
    { x: cx + orbitR, y: cy }, // 3
    { x: cx, y: cy + orbitR }, // 6
    { x: cx - orbitR, y: cy }, // 9
  ];

  return (
    <Svg width={width} height={height}>
      {/* Connector arcs from center to each satellite */}
      {pillars.satellites.map((s, i) => {
        const p = positions[i];
        const color = areaHex(s.areaAccent);
        // Compute the unit direction from center to satellite, then start/end
        // points at the edges of the circles (outside the central + before the
        // satellite). This avoids overlapping the circles.
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const startX = cx + ux * centerR;
        const startY = cy + uy * centerR;
        const endX = p.x - ux * satR;
        const endY = p.y - uy * satR;
        return (
          <Path
            key={`connector-${i}`}
            d={`M ${startX} ${startY} L ${endX} ${endY}`}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
        );
      })}

      {/* Central circle */}
      <Circle cx={cx} cy={cy} r={centerR} fill={N1000} />
      <SvgText
        x={cx}
        y={cy + 4}
        style={{
          fontFamily: 'Fraunces',
          fontWeight: 700,
          fontSize: 36,
          fill: GOLD_500,
          textAnchor: 'middle',
        }}
      >
        {pillars.overall.toFixed(0)}
      </SvgText>
      <SvgText
        x={cx}
        y={cy + 22}
        style={{
          fontFamily: 'Geist',
          fontSize: 9,
          fill: N0,
          textAnchor: 'middle',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        salud
      </SvgText>

      {/* Satellites */}
      {pillars.satellites.map((s, i) => {
        const p = positions[i];
        const color = areaHex(s.areaAccent);
        return (
          <G key={`sat-${i}`}>
            <Circle cx={p.x} cy={p.y} r={satR} fill={color} />
            <SvgText
              x={p.x}
              y={p.y + 2}
              style={{
                fontFamily: 'Fraunces',
                fontWeight: 700,
                fontSize: 22,
                fill: N0,
                textAnchor: 'middle',
              }}
            >
              {s.score.toFixed(0)}
            </SvgText>
            <SvgText
              x={p.x}
              y={p.y + 18}
              style={{
                fontFamily: 'Geist',
                fontSize: 8,
                fill: N0,
                textAnchor: 'middle',
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              {s.label.length > 12 ? `${s.label.slice(0, 11)}…` : s.label}
            </SvgText>
            {/* topKpi drill-down below the satellite */}
            <SvgText
              x={p.x}
              y={p.y + satR + 14}
              style={{
                fontFamily: 'Geist Mono',
                fontSize: 8,
                fill: N700,
                textAnchor: 'middle',
              }}
            >
              {s.topKpi.length > 32 ? `${s.topKpi.slice(0, 30)}…` : s.topKpi}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

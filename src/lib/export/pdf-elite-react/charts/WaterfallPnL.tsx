// charts/WaterfallPnL.tsx — bridge waterfall (ingresos → costos → impuestos → utilidad)
// Hand-coded SVG via @react-pdf/renderer. Self-contained; no external chart lib.
import React from 'react';
import { Svg, Rect, Line, Text as SvgText, G } from '@react-pdf/renderer';
import type { WaterfallItem } from '../types';
import {
  GOLD_500,
  WINE_500,
  AREA_VALOR,
  N300,
  N700,
  N1000,
} from '../tokens';

interface Props {
  items: WaterfallItem[];
  width?: number;
  height?: number;
}

function formatCOP(amount: number): string {
  // $1.234.567,89 — dot thousands, comma decimal (es-CO style, sin decimales)
  const abs = Math.abs(Math.round(amount));
  const sign = amount < 0 ? '-' : '';
  const withThousands = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withThousands}`;
}

function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${(amount / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(amount / 1e3).toFixed(0)}K`;
  return amount.toFixed(0);
}

export function WaterfallPnL({ items, width = 500, height = 300 }: Props) {
  if (!items || items.length === 0) return null;

  // Layout
  const padding = { top: 24, right: 24, bottom: 64, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Compute cumulative running total to scale Y axis. Bars are signed; totals reset to absolute value at point.
  let running = 0;
  const bars = items.map((it) => {
    if (it.sign === 'total') {
      const start = 0;
      const end = it.amount;
      running = it.amount;
      return { ...it, start, end };
    }
    const start = running;
    const end = running + (it.sign === 'pos' ? it.amount : -Math.abs(it.amount));
    running = end;
    return { ...it, start, end };
  });

  // Y range: include 0 always.
  const allY = bars.flatMap((b) => [b.start, b.end, 0]);
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;

  // Bar geometry
  const n = bars.length;
  const barGap = 8;
  const barW = Math.max(8, (plotW - barGap * (n - 1)) / n);

  function yToPx(v: number): number {
    return padding.top + plotH - ((v - yMin) / yRange) * plotH;
  }

  const zeroY = yToPx(0);

  return (
    <Svg width={width} height={height}>
      {/* Y axis (very subtle) */}
      <Line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={padding.top + plotH}
        strokeWidth={0.5}
        stroke={N300}
      />
      {/* Zero baseline */}
      <Line
        x1={padding.left}
        y1={zeroY}
        x2={padding.left + plotW}
        y2={zeroY}
        strokeWidth={0.5}
        stroke={N300}
      />

      {/* Y axis labels (3 ticks: min, 0, max) */}
      {[yMin, 0, yMax].map((tick, i) => (
        <G key={`y-${i}`}>
          <SvgText
            x={padding.left - 6}
            y={yToPx(tick) + 3}
            style={{ fontFamily: 'Geist Mono', fontSize: 7, fill: N700, textAnchor: 'end' }}
          >
            {formatCompact(tick)}
          </SvgText>
        </G>
      ))}

      {bars.map((b, i) => {
        const x = padding.left + i * (barW + barGap);
        const top = Math.min(yToPx(b.start), yToPx(b.end));
        const bottom = Math.max(yToPx(b.start), yToPx(b.end));
        const h = Math.max(1, bottom - top);
        const fill =
          b.sign === 'total'
            ? AREA_VALOR
            : b.sign === 'pos'
              ? GOLD_500
              : WINE_500;

        // Step line connecting prior bar's end to current bar's start
        const prevX = i > 0 ? padding.left + (i - 1) * (barW + barGap) + barW : null;
        const stepY = yToPx(b.start);

        return (
          <G key={`bar-${i}`}>
            {prevX !== null && b.sign !== 'total' && (
              <Line
                x1={prevX}
                y1={stepY}
                x2={x}
                y2={stepY}
                strokeWidth={0.5}
                stroke={N700}
                strokeDasharray="2 2"
              />
            )}
            <Rect x={x} y={top} width={barW} height={h} fill={fill} />
            {/* Value label above bar */}
            <SvgText
              x={x + barW / 2}
              y={top - 4}
              style={{
                fontFamily: 'Geist Mono',
                fontSize: 7,
                fill: N1000,
                textAnchor: 'middle',
              }}
            >
              {formatCompact(b.end)}
            </SvgText>
            {/* X axis label */}
            <SvgText
              x={x + barW / 2}
              y={padding.top + plotH + 14}
              style={{
                fontFamily: 'Geist',
                fontSize: 7,
                fill: N700,
                textAnchor: 'middle',
              }}
            >
              {b.label.length > 14 ? `${b.label.slice(0, 12)}…` : b.label}
            </SvgText>
            {/* Detailed COP amount on second line */}
            <SvgText
              x={x + barW / 2}
              y={padding.top + plotH + 26}
              style={{
                fontFamily: 'Geist Mono',
                fontSize: 6,
                fill: N300,
                textAnchor: 'middle',
              }}
            >
              {formatCOP(b.amount)}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

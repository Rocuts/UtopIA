// charts/WaterfallPnL.tsx — Bridge waterfall (ingresos → costos → impuestos → utilidad).
// Hand-coded SVG via @react-pdf/renderer. Palette: SAGE_500 (pos) / WINE_700 (neg) / SAND_500 (total).
// Spec §3.7: Y-axis SAND_200 gridlines, no X-axis line.
import React from 'react';
import { Svg, Rect, Line, Text as SvgText, G } from '@react-pdf/renderer';
import type { WaterfallItem } from '../types';
import {
  CHARCOAL_700,
  SAGE_500,
  SAND_200,
  SAND_300,
  SAND_500,
  WINE_700,
} from '../tokens';

interface Props {
  items: WaterfallItem[];
  width?: number;
  height?: number;
}

function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const sign = amount < 0 ? '-' : '';
  const withThousands = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withThousands}`;
}

export function WaterfallPnL({ items, width = 500, height = 300 }: Props) {
  if (!items || items.length === 0) return null;

  const padding = { top: 28, right: 20, bottom: 64, left: 52 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  let running = 0;
  const bars = items.map((it) => {
    if (it.sign === 'total') {
      running = it.amount;
      return { ...it, start: 0, end: it.amount };
    }
    const start = running;
    const end = running + (it.sign === 'pos' ? it.amount : -Math.abs(it.amount));
    running = end;
    return { ...it, start, end };
  });

  const allY = bars.flatMap((b) => [b.start, b.end, 0]);
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;

  const n = bars.length;
  const barGap = 10;
  const barW = Math.max(8, (plotW - barGap * (n - 1)) / n);

  function yToPx(v: number): number {
    return padding.top + plotH - ((v - yMin) / yRange) * plotH;
  }

  const zeroY = yToPx(0);

  // 4 horizontal SAND_200 gridlines (spec §3.7: every 25% of range)
  const gridTicks = [0, 0.25, 0.5, 0.75, 1.0].map(
    (t) => yMin + t * yRange,
  );

  return (
    <Svg width={width} height={height}>
      {/* Gridlines — SAND_200, no X-axis line per spec */}
      {gridTicks.map((tick, i) => (
        <Line
          key={`grid-${i}`}
          x1={padding.left}
          y1={yToPx(tick)}
          x2={padding.left + plotW}
          y2={yToPx(tick)}
          strokeWidth={0.4}
          stroke={SAND_200}
        />
      ))}

      {/* Y axis labels */}
      {[yMin, 0, yMax].map((tick, i) => (
        <G key={`ylabel-${i}`}>
          <SvgText
            x={padding.left - 5}
            y={yToPx(tick) + 3}
            style={{
              fontFamily: 'GeistMono',
              fontSize: 7,
              fill: CHARCOAL_700,
              textAnchor: 'end',
            }}
          >
            {formatCompact(tick)}
          </SvgText>
        </G>
      ))}

      {/* Bars */}
      {bars.map((b, i) => {
        const x = padding.left + i * (barW + barGap);
        const top = Math.min(yToPx(b.start), yToPx(b.end));
        const bottom = Math.max(yToPx(b.start), yToPx(b.end));
        const h = Math.max(2, bottom - top);

        // Palette: SAGE_500 pos / WINE_700 neg / SAND_500 total (spec §3.7)
        const fill =
          b.sign === 'total'
            ? SAND_500
            : b.sign === 'pos'
              ? SAGE_500
              : WINE_700;

        const prevX = i > 0 ? padding.left + (i - 1) * (barW + barGap) + barW : null;
        const stepY = yToPx(b.start);

        return (
          <G key={`bar-${i}`}>
            {/* Step connector line */}
            {prevX !== null && b.sign !== 'total' && (
              <Line
                x1={prevX}
                y1={stepY}
                x2={x}
                y2={stepY}
                strokeWidth={0.5}
                stroke={SAND_300}
                strokeDasharray="2 2"
              />
            )}
            <Rect x={x} y={top} width={barW} height={h} fill={fill} />
            {/* Value label above bar */}
            <SvgText
              x={x + barW / 2}
              y={top - 4}
              style={{
                fontFamily: 'GeistMono',
                fontSize: 7,
                fill: CHARCOAL_700,
                textAnchor: 'middle',
              }}
            >
              {formatCompact(b.end)}
            </SvgText>
            {/* X label */}
            <SvgText
              x={x + barW / 2}
              y={padding.top + plotH + 14}
              style={{
                fontFamily: 'Geist',
                fontSize: 7,
                fill: CHARCOAL_700,
                textAnchor: 'middle',
              }}
            >
              {b.label.length > 14 ? `${b.label.slice(0, 12)}…` : b.label}
            </SvgText>
            {/* COP amount below label */}
            <SvgText
              x={x + barW / 2}
              y={padding.top + plotH + 26}
              style={{
                fontFamily: 'GeistMono',
                fontSize: 6,
                fill: SAND_300,
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

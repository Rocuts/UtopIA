'use client';

/**
 * DuPontTreemap — heatmap segmentado:
 *   tamaño = ROE de cada segmento
 *   color  = Rotación de Activos
 *
 * Permite ver de un vistazo si la rentabilidad es real (operativa, alta
 * rotación = gold/success) o financiera (apalancada, baja rotación = wine).
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { formatPct } from '@/lib/charts/format';
import { ChartContainer } from './ChartContainer';

export interface DuPontSegment {
  name: string;
  /** Magnitud para el tamaño del bloque. Usamos ROE (decimal). */
  roe: number;
  /** Para el color: rotación de activos (revenue/assets). */
  rotacionActivos: number;
  /** Ventas absolutas — solo para tooltip. */
  ventas?: number;
}

export interface DuPontTreemapProps {
  segments: DuPontSegment[];
  height?: number;
  density?: 'comfortable' | 'compact';
  title?: string;
  subtitle?: string;
  onDrill?: (segment: DuPontSegment) => void;
}

export function DuPontTreemap({
  segments,
  height = 360,
  density,
  title = 'Mapa de Eficiencia DuPont',
  subtitle = 'Tamaño = ROE · Color = Rotación de Activos',
  onDrill,
}: DuPontTreemapProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const empty = !segments || segments.length === 0;

  const option = useMemo(() => {
    if (empty) return {};

    return {
      tooltip: {
        formatter: (info: { data: DuPontSegment & { value: number } }) => {
          const d = info.data;
          return `<strong>${d.name}</strong><br/>ROE: ${formatPct(d.roe)}<br/>Rotación: ${d.rotacionActivos.toFixed(2)}x<br/>${
            d.ventas !== undefined ? `Ventas: ${d.ventas.toLocaleString('es-CO')}` : ''
          }`;
        },
      },
      visualMap: {
        type: 'continuous',
        min: 0,
        max: Math.max(2, ...segments.map((s) => s.rotacionActivos)),
        dimension: 1,
        // gradiente: wine (baja) → gold (media) → success (alta).
        inRange: { color: [tokens.wine, tokens.gold, tokens.success] },
        text: ['Alta rotación', 'Baja rotación'],
        textStyle: { color: tokens.textSecondary, fontSize: 10 },
        itemWidth: 12,
        itemHeight: 80,
        right: 12,
        top: 'middle',
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: 'zoomToNode',
          breadcrumb: { show: false },
          label: {
            show: true,
            color: tokens.bg,
            fontFamily: 'var(--font-sans), sans-serif',
            fontWeight: 500,
            fontSize: 12,
            formatter: (p: { name: string; data: DuPontSegment }) =>
              `${p.name}\nROE ${formatPct(p.data.roe)}`,
          },
          itemStyle: {
            borderColor: tokens.bg,
            borderWidth: 2,
            gapWidth: 2,
          },
          data: segments.map((s) => ({
            ...s,
            // ECharts treemap usa `value` (1er elem o número) para tamaño;
            // pasar tupla [tamaño, color-dim] para que el visualMap encuentre
            // la dimension 1.
            value: [Math.max(0, s.roe), s.rotacionActivos],
          })),
        },
      ],
    };
  }, [segments, empty, tokens]);

  const onEvents = onDrill
    ? {
        click: (p: { data?: DuPontSegment }) => {
          if (p?.data) onDrill(p.data);
        },
      }
    : undefined;

  return (
    <ChartContainer
      title={title}
      subtitle={subtitle}
      height={height}
      density={density}
      empty={empty}
      emptyLabel="Sin segmentos para visualizar"
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        theme={theme}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        onEvents={onEvents}
        aria-label="Treemap DuPont (ROE × Rotación)"
        data-testid="chart-treemap"
      />
    </ChartContainer>
  );
}

export default DuPontTreemap;

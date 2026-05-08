'use client';

/**
 * RunwayProjection — runway de caja a 36 meses con 3 escenarios.
 * Líneas: base (gold), conservador (warning), agresivo (success).
 * markLine horizontal en y=0 (línea wine punteada) para señalar el umbral.
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { formatBigCop, formatCop } from '@/lib/charts/format';
import { ChartContainer } from './ChartContainer';

export interface RunwayMonth {
  month: string; // 'YYYY-MM' o 'M+1', 'M+2', etc.
  base: number;
  conservador: number;
  agresivo: number;
}

export interface RunwayProjectionProps {
  months: RunwayMonth[];
  height?: number;
  density?: 'comfortable' | 'compact';
  title?: string;
  subtitle?: string;
}

export function RunwayProjection({
  months,
  height = 320,
  density,
  title = 'Runway de Caja · 36 meses',
  subtitle = 'Escenario base, conservador (−15%) y agresivo (+10%)',
}: RunwayProjectionProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const empty = !months || months.length === 0;

  const option = useMemo(() => {
    if (empty) return {};
    const labels = months.map((m) => m.month);

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          if (!arr.length) return '';
          const m = (arr[0] as { axisValue: string }).axisValue;
          const lines = (arr as Array<{ seriesName: string; value: number; color: string }>)
            .map((p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${formatCop(p.value)}`)
            .join('<br/>');
          return `<strong>${m}</strong><br/>${lines}`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: tokens.textSecondary, fontSize: 11 },
        data: ['Base', 'Conservador', 'Agresivo'],
      },
      grid: { top: 32, right: 16, bottom: 32, left: 56, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: { color: tokens.textSecondary, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 10,
          formatter: (v: number) => formatBigCop(v),
        },
      },
      series: [
        {
          name: 'Agresivo',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: tokens.success },
          data: months.map((m) => m.agresivo),
          endLabel: {
            show: true,
            color: tokens.success,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 10,
            formatter: (p: { value: number }) => formatBigCop(p.value),
          },
        },
        {
          name: 'Base',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: tokens.gold },
          data: months.map((m) => m.base),
          endLabel: {
            show: true,
            color: tokens.gold,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 10,
            formatter: (p: { value: number }) => formatBigCop(p.value),
          },
          markLine: {
            silent: true,
            lineStyle: { color: tokens.danger, type: 'dashed', width: 1 },
            symbol: 'none',
            label: {
              color: tokens.danger,
              fontFamily: 'var(--font-mono), monospace',
              fontSize: 10,
              formatter: 'Caja = 0',
            },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: 'Conservador',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: tokens.warning },
          data: months.map((m) => m.conservador),
          endLabel: {
            show: true,
            color: tokens.warning,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 10,
            formatter: (p: { value: number }) => formatBigCop(p.value),
          },
        },
      ],
    };
  }, [months, empty, tokens]);

  return (
    <ChartContainer
      title={title}
      subtitle={subtitle}
      height={height}
      density={density}
      empty={empty}
      emptyLabel="Sin proyección de runway"
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        theme={theme}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        aria-label="Runway de caja 36 meses"
        data-testid="chart-runway"
      />
    </ChartContainer>
  );
}

export default RunwayProjection;

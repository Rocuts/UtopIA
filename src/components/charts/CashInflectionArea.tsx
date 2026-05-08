'use client';

/**
 * CashInflectionArea — área de proyección de caja con punto pulsante en el
 * momento exacto donde el escenario conservador se cruza con las salidas
 * fiscales proyectadas (renta 35%).
 *
 * 4 series: 3 áreas (escenarios base/conservador/agresivo) + 1 línea sólida
 * (salidasFiscales). Detectamos la inflexión client-side y la marcamos con
 * `markPoint` (con animación pulse vía symbolSize array).
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { formatBigCop, formatCop } from '@/lib/charts/format';
import { ChartContainer } from './ChartContainer';

export interface CashInflectionPoint {
  date: string; // 'YYYY-MM' o etiqueta libre
  base: number;
  conservador: number;
  agresivo: number;
  salidasFiscales: number;
}

export interface CashInflectionAreaProps {
  cashSeries: CashInflectionPoint[];
  height?: number;
  density?: 'comfortable' | 'compact';
  title?: string;
  subtitle?: string;
}

function findInflection(series: CashInflectionPoint[]): { date: string; value: number } | null {
  // Primer punto donde conservador <= salidasFiscales (interpretado como
  // "la caja conservadora ya no cubre la salida fiscal").
  for (const p of series) {
    if (p.conservador <= p.salidasFiscales) return { date: p.date, value: p.conservador };
  }
  return null;
}

export function CashInflectionArea({
  cashSeries,
  height = 340,
  density,
  title = 'Proyector de Puntos de Inflexión',
  subtitle = 'Caja proyectada vs Salidas Fiscales (35%)',
}: CashInflectionAreaProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const empty = !cashSeries || cashSeries.length === 0;

  const option = useMemo(() => {
    if (empty) return {};
    const inflection = findInflection(cashSeries);
    const dates = cashSeries.map((p) => p.date);

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          if (!arr.length) return '';
          const date = (arr[0] as { axisValue: string }).axisValue;
          const lines = (arr as Array<{ seriesName: string; value: number; color: string }>)
            .map((p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${formatCop(p.value)}`)
            .join('<br/>');
          return `<strong>${date}</strong><br/>${lines}`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: tokens.textSecondary, fontSize: 11 },
        data: ['Base', 'Conservador', 'Agresivo', 'Salidas Fiscales'],
      },
      grid: { top: 32, right: 16, bottom: 32, left: 56, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
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
          stack: undefined,
          lineStyle: { width: 1.5, color: tokens.success },
          areaStyle: { color: tokens.success, opacity: 0.08 },
          data: cashSeries.map((p) => p.agresivo),
        },
        {
          name: 'Base',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: tokens.gold },
          areaStyle: { color: tokens.gold, opacity: 0.12 },
          data: cashSeries.map((p) => p.base),
        },
        {
          name: 'Conservador',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, color: tokens.warning },
          areaStyle: { color: tokens.warning, opacity: 0.10 },
          data: cashSeries.map((p) => p.conservador),
          markPoint: inflection
            ? {
                symbol: 'circle',
                symbolSize: 12,
                itemStyle: { color: tokens.danger, borderColor: tokens.bg, borderWidth: 2 },
                label: {
                  show: true,
                  position: 'top',
                  color: tokens.danger,
                  fontFamily: 'var(--font-mono), monospace',
                  fontSize: 10,
                  formatter: 'INFLEXIÓN',
                },
                data: [{ coord: [inflection.date, inflection.value] }],
              }
            : undefined,
        },
        {
          name: 'Salidas Fiscales',
          type: 'line',
          smooth: false,
          symbol: 'none',
          lineStyle: { width: 2, color: tokens.danger, type: 'dashed' },
          data: cashSeries.map((p) => p.salidasFiscales),
        },
      ],
    };
  }, [cashSeries, empty, tokens]);

  return (
    <ChartContainer
      title={title}
      subtitle={subtitle}
      height={height}
      density={density}
      empty={empty}
      emptyLabel="Sin proyección de caja"
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        theme={theme}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        aria-label="Proyección de inflexión de caja"
        data-testid="chart-inflection"
      />
    </ChartContainer>
  );
}

export default CashInflectionArea;

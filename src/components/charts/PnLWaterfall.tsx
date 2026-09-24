'use client';

/**
 * PnLWaterfall — cascada de utilidad (P&L Bridge):
 *   Ingresos (operacionales) → Costos → Gastos Op → Otros ingresos (42) →
 *   No operacionales (53) → Impuestos → Utilidad Neta.
 *
 * "Otros ingresos (42)" sólo aparece cuando el puente trae `otrosIngresos`
 * (ingresos operacionales separados de los no operacionales, IW4). La barra
 * "No operacionales (53)" agrupa el grupo 53 (financieros, extraordinarios,
 * diversos) y cualquier otro grupo de la clase 5 distinto de 51, 52 y 54.
 *
 * Implementación: ECharts BarChart con una serie "placeholder" transparente
 * (offset acumulado) + una serie "value" coloreada. Es la técnica canónica
 * para waterfalls en ECharts (la lib no tiene un type 'waterfall' nativo).
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { formatBigCop, formatCop } from '@/lib/charts/format';
import { ChartContainer } from './ChartContainer';

export interface PnLWaterfallData {
  /** Ingresos operacionales netos (41 − 4175) cuando viene `otrosIngresos`. */
  ingresos: number;
  /** Ingresos no operacionales (grupo 42 y demás de la clase 4 ≠ 41). */
  otrosIngresos?: number;
  costos: number;
  gastosOperacionales: number;
  /** No operacionales: grupo 53 y otros grupos de la clase 5 ≠ 51/52/54. */
  gastosFinancieros: number;
  impuestos: number;
  /** Si `null`, se calcula como ingresos - sumas. */
  utilidadNeta?: number;
}

export interface PnLWaterfallProps {
  data: PnLWaterfallData;
  height?: number;
  density?: 'comfortable' | 'compact';
  title?: string;
  subtitle?: string;
}

export interface BarStep {
  label: string;
  /** Valor del segmento visible. Positivo o negativo (negativo se grafica hacia abajo). */
  value: number;
  /** Offset transparente (acumulado anterior). Para "anchor" usamos null y el valor pleno. */
  offset: number;
  kind: 'anchor' | 'positive' | 'negative';
}

export function buildPnlWaterfallSteps(data: PnLWaterfallData): BarStep[] {
  const ut =
    data.utilidadNeta ??
    data.ingresos +
      (data.otrosIngresos ?? 0) -
      data.costos -
      data.gastosOperacionales -
      data.gastosFinancieros -
      data.impuestos;
  const steps: BarStep[] = [];

  // Paso inicial: Ingresos como anchor (full bar from 0 → ingresos).
  steps.push({ label: 'Ingresos', value: data.ingresos, offset: 0, kind: 'anchor' });

  let running = data.ingresos;
  // Montos POSITIVOS son reducciones; los otros ingresos se restan con signo
  // invertido para que sumen al acumulado.
  const reductions: Array<[string, number]> = [
    ['Costos', data.costos],
    ['Gastos Op', data.gastosOperacionales],
    ...(data.otrosIngresos !== undefined
      ? ([['Otros ingresos (42)', -data.otrosIngresos]] as Array<[string, number]>)
      : []),
    ['No operacionales (53)', data.gastosFinancieros],
    ['Impuestos', data.impuestos],
  ];
  for (const [label, val] of reductions) {
    const positive = val >= 0;
    const segValue = Math.abs(val);
    const offset = positive ? running - segValue : running;
    steps.push({
      label,
      value: segValue,
      offset,
      kind: positive ? 'negative' : 'positive', // costos POSITIVOS son reducciones
    });
    running = positive ? running - segValue : running + segValue;
  }
  // Anchor final: utilidad neta como bar pleno.
  steps.push({ label: 'Utilidad Neta', value: ut, offset: 0, kind: 'anchor' });
  return steps;
}

export function PnLWaterfall({
  data,
  height = 340,
  density,
  title = 'Cascada de Utilidad',
  subtitle = 'P&L Bridge · de Ingresos a Utilidad Neta',
}: PnLWaterfallProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const empty =
    !Number.isFinite(data.ingresos) ||
    (data.ingresos === 0 && !(data.otrosIngresos !== undefined && data.otrosIngresos !== 0));

  const option = useMemo(() => {
    const steps = buildPnlWaterfallSteps(data);
    const labels = steps.map((s) => s.label);
    const offsetSeries = steps.map((s) => (s.kind === 'anchor' ? 0 : s.offset));
    const valueSeries = steps.map((s) => s.value);

    const colorOf = (s: BarStep) => {
      if (s.kind === 'anchor') return tokens.gold;
      if (s.kind === 'negative') return tokens.wine;
      return tokens.success;
    };

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const valueParam = (arr as Array<{ axisValue: string; dataIndex: number }>).find(
            (p) => p,
          );
          if (!valueParam) return '';
          const idx = valueParam.dataIndex;
          const s = steps[idx];
          return `<strong>${s.label}</strong><br/>${formatCop(s.value)}`;
        },
      },
      grid: { top: 24, right: 16, bottom: 32, left: 56, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: tokens.textSecondary, fontSize: 11 },
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
        // Offset transparente — invisible.
        {
          name: 'offset',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: 'transparent' },
          emphasis: { itemStyle: { color: 'transparent' } },
          data: offsetSeries,
          silent: true,
        },
        // Valor visible.
        {
          name: 'segment',
          type: 'bar',
          stack: 'total',
          barWidth: '50%',
          data: valueSeries.map((v, i) => ({
            value: v,
            itemStyle: { color: colorOf(steps[i]), borderRadius: [3, 3, 0, 0] },
          })),
          label: {
            show: true,
            position: 'top',
            color: tokens.textPrimary,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 10,
            formatter: (p: { dataIndex: number }) =>
              formatBigCop(steps[p.dataIndex].kind === 'negative' ? -steps[p.dataIndex].value : steps[p.dataIndex].value),
          },
          animationDelay: (idx: number) => idx * 80,
        },
      ],
    };
  }, [data, tokens]);

  return (
    <ChartContainer
      title={title}
      subtitle={subtitle}
      height={height}
      density={density}
      empty={empty}
      emptyLabel="Sin ingresos del periodo"
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        theme={theme}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        aria-label="Cascada de utilidad P&L"
        data-testid="chart-waterfall"
      />
    </ChartContainer>
  );
}

export default PnLWaterfall;

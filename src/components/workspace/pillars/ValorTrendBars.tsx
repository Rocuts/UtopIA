'use client';

/**
 * ValorTrendBars — evolución temporal EBITDA / FCF / Ingresos en barras.
 *
 * Toggle de métrica local (useState). Implementación con ECharts (igual que
 * PnLWaterfall) para mantener coherencia de estilo y temas del proyecto.
 *
 * Colores:
 *   EBITDA   → blue  (tokens.info   #3D6B7E / #6BA0B5)
 *   FCF      → green (tokens.success)
 *   Ingresos → gold  (tokens.gold)
 *
 * Si la serie fue interpolada (1 solo período anual), muestra un badge
 * informativo de "datos provisionales". Cuando metric=FCF y algún punto
 * tiene fcf=null, la barra se pinta con 30% de opacidad.
 */

import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { formatBigCop, formatCop } from '@/lib/charts/format';
import { ChartContainer } from '@/components/charts/ChartContainer';
import type { ValorBarSeries } from '@/lib/pillars/valor-bars';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Metric = 'ebitda' | 'fcf' | 'ingresos';

export interface ValorTrendBarsProps {
  series: ValorBarSeries[];
  language: 'es' | 'en';
  density?: 'comfortable' | 'compact';
}

// ─── Labels i18n ─────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<Metric, { es: string; en: string }> = {
  ebitda: { es: 'EBITDA', en: 'EBITDA' },
  fcf: { es: 'Free Cash Flow', en: 'Free Cash Flow' },
  ingresos: { es: 'Ingresos', en: 'Revenue' },
};

const TOGGLES: Metric[] = ['ebitda', 'fcf', 'ingresos'];

// ─── Helper: valor de una métrica en un punto ────────────────────────────────

function getValue(point: ValorBarSeries, metric: Metric): number {
  if (metric === 'fcf') return point.fcf ?? 0;
  return point[metric];
}

function isFcfNull(point: ValorBarSeries, metric: Metric): boolean {
  return metric === 'fcf' && point.fcf === null;
}

// ─── Componente principal ────────────────────────────────────────────────────

export function ValorTrendBars({ series, language, density }: ValorTrendBarsProps) {
  const [metric, setMetric] = useState<Metric>('ebitda');
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const isEs = language === 'es';
  const isCompact = density === 'compact';
  const chartHeight = isCompact ? 220 : 280;

  const hasInterpolated = series.some((p) => p.isInterpolated);
  const empty = series.length === 0;

  // Color base según métrica.
  const baseColor: Record<Metric, string> = {
    ebitda: tokens.info,
    fcf: tokens.success,
    ingresos: tokens.gold,
  };

  const option = useMemo(() => {
    const labels = series.map((p) => p.label);
    const values = series.map((p) => {
      const v = getValue(p, metric);
      const nullFcf = isFcfNull(p, metric);
      return {
        value: v,
        itemStyle: {
          color: nullFcf ? tokens.textSecondary : baseColor[metric],
          opacity: nullFcf ? 0.3 : p.isInterpolated ? 0.65 : 1,
          borderRadius: [3, 3, 0, 0],
        },
      };
    });

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const first = (arr as Array<{ dataIndex: number; axisValue: string }>)[0];
          if (!first) return '';
          const point = series[first.dataIndex];
          if (!point) return '';
          const nullFcf = isFcfNull(point, metric);
          const v = getValue(point, metric);
          const metricLabel = METRIC_LABELS[metric][isEs ? 'es' : 'en'];
          const valueStr = nullFcf
            ? (isEs ? '— (sin comparativo)' : '— (no comparative period)')
            : formatCop(v);
          const provisional = point.isInterpolated
            ? `<br/><span style="font-size:10px;opacity:0.6">${isEs ? 'Estimado (interpolación lineal)' : 'Estimated (linear interpolation)'}</span>`
            : '';
          return `<strong>${point.label}</strong><br/>${metricLabel}: ${valueStr}${provisional}`;
        },
      },
      grid: { top: 28, right: 16, bottom: 32, left: 56, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: tokens.textSecondary, fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 10,
          formatter: (v: number) => formatBigCop(v),
        },
        splitLine: { lineStyle: { color: tokens.textSecondary + '22', type: 'dashed' } },
      },
      series: [
        {
          name: METRIC_LABELS[metric][isEs ? 'es' : 'en'],
          type: 'bar',
          barWidth: series.length <= 4 ? '45%' : '60%',
          data: values,
          label: {
            show: true,
            position: 'top',
            color: tokens.textSecondary,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 9,
            formatter: (p: { dataIndex: number }) => {
              const v = getValue(series[p.dataIndex], metric);
              return isFcfNull(series[p.dataIndex], metric) ? '?' : formatBigCop(v);
            },
          },
          animationDelay: (idx: number) => idx * 60,
          animationEasing: 'cubicOut',
        },
      ],
    };
  }, [series, metric, tokens, baseColor, isEs]);

  const subtitle = hasInterpolated
    ? (isEs
        ? 'Datos provisionales — interpolación lineal 12 meses'
        : 'Provisional data — 12-month linear interpolation')
    : (isEs ? 'Evolución por período' : 'Period evolution');

  const title = isEs
    ? `Tendencia · ${METRIC_LABELS[metric].es}`
    : `Trend · ${METRIC_LABELS[metric].en}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Toggle de métrica */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">
            {isEs ? 'Tendencia · Pilar Valor' : 'Trend · Value Pillar'}
          </span>
          {hasInterpolated && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
              {subtitle}
            </span>
          )}
        </div>

        <div
          role="group"
          aria-label={isEs ? 'Seleccionar métrica' : 'Select metric'}
          className="flex rounded-md border border-n-200 overflow-hidden dark:border-n-700"
        >
          {TOGGLES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={metric === m}
              className={[
                'px-3 py-1 text-xs font-mono transition-colors focus-visible:outline focus-visible:outline-2',
                metric === m
                  ? 'bg-n-900 text-white dark:bg-n-100 dark:text-n-900'
                  : 'bg-white text-n-600 hover:bg-n-100 dark:bg-n-900 dark:text-n-400 dark:hover:bg-n-800',
              ].join(' ')}
            >
              {METRIC_LABELS[m][language]}
            </button>
          ))}
        </div>
      </div>

      <ChartContainer
        title={title}
        subtitle={hasInterpolated ? '' : subtitle}
        height={chartHeight}
        density={density}
        empty={empty}
        emptyLabel={isEs ? 'Sin datos de tendencia' : 'No trend data available'}
      >
        <ReactECharts
          echarts={echarts}
          option={option}
          theme={theme}
          style={{ height: '100%', width: '100%' }}
          notMerge
          lazyUpdate
          opts={{ renderer: 'canvas' }}
          aria-label={isEs ? 'Gráfico de tendencia de valor' : 'Value trend chart'}
          data-testid="chart-valor-trend"
        />
      </ChartContainer>

      {/* Leyenda FCF null */}
      {metric === 'fcf' && series.some((p) => p.fcf === null) && (
        <p className="text-xs text-n-500 text-right">
          {isEs
            ? 'Barras atenuadas: FCF no disponible (sin período comparativo)'
            : 'Faded bars: FCF unavailable (no comparative period)'}
        </p>
      )}
    </div>
  );
}

export default ValorTrendBars;

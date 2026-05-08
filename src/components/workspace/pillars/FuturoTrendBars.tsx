'use client';

/**
 * FuturoTrendBars — Proyección de caja 12 meses · 3 escenarios.
 *
 * Gráfico de LÍNEAS paralelas para mostrar trayectorias futuras:
 *   Base         → violet-500 (#8b5cf6)  línea principal
 *   Conservadora → red-500    (#ef4444)  escenario de estrés
 *   Agresiva     → emerald-500 (#10b981) escenario optimista
 *
 * Incluye markLine en y=0 para visualizar el umbral de quiebre de caja.
 * Tooltip con formato COP abreviado ($1.234M).
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { ChartContainer } from '@/components/charts/ChartContainer';
import type { FuturoBarSeries } from '@/lib/pillars/futuro-bars';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FuturoTrendBarsProps {
  series: FuturoBarSeries[];
  language: 'es' | 'en';
  density?: 'comfortable' | 'compact';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formatea valor COP en millones con signo. Ej: $1.234M / −$450M */
function formatCopM(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  }
  return `${sign}$${Math.round(abs / 1_000_000).toLocaleString('es-CO')}M`;
}

// ─── Colores fijos ────────────────────────────────────────────────────────────

const COLOR_BASE = '#8b5cf6';        // violet-500
const COLOR_CONSERVADORA = '#ef4444'; // red-500
const COLOR_AGRESIVA = '#10b981';    // emerald-500
const COLOR_ZERO_LINE = '#f59e0b';   // amber-500 — umbral de quiebre

// ─── Componente principal ─────────────────────────────────────────────────────

export function FuturoTrendBars({ series, language, density }: FuturoTrendBarsProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const isEs = language === 'es';
  const isCompact = density === 'compact';
  const chartHeight = isCompact ? 220 : 300;

  const empty = series.length === 0;

  // Detectar si algún escenario cruza cero (alerta de quiebre visible)
  const conservadoraCruzaCero = series.some((p) => p.cajaConservadora <= 0);

  const option = useMemo(() => {
    const labels = series.map((p) => p.label);

    const makeLineData = (key: keyof Pick<FuturoBarSeries, 'cajaBase' | 'cajaConservadora' | 'cajaAgresiva'>) =>
      series.map((p) => Math.round(p[key]));

    const labelBase = isEs ? 'Base' : 'Base';
    const labelCons = isEs ? 'Conservadora' : 'Conservative';
    const labelAgr = isEs ? 'Agresiva' : 'Aggressive';
    const labelZero = isEs ? 'Umbral de quiebre' : 'Break-even threshold';

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: tokens.textSecondary } },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          if (arr.length === 0) return '';
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const point = series[idx];
          if (!point) return '';

          const rows = [
            `<strong>${point.label}</strong>`,
            `<span style="color:${COLOR_BASE}">●</span> ${labelBase}: <strong>${formatCopM(point.cajaBase)}</strong>`,
            `<span style="color:${COLOR_CONSERVADORA}">●</span> ${labelCons}: <strong>${formatCopM(point.cajaConservadora)}</strong>`,
            `<span style="color:${COLOR_AGRESIVA}">●</span> ${labelAgr}: <strong>${formatCopM(point.cajaAgresiva)}</strong>`,
          ];

          if (point.cajaConservadora <= 0) {
            rows.push(
              `<span style="font-size:10px;color:${COLOR_ZERO_LINE}">⚠ ${isEs ? 'Quiebre de caja en escenario conservador' : 'Cash break in conservative scenario'}</span>`,
            );
          }

          return rows.join('<br/>');
        },
      },
      legend: {
        data: [labelBase, labelCons, labelAgr],
        bottom: 4,
        textStyle: { color: tokens.textSecondary, fontSize: 11 },
        itemHeight: 10,
      },
      grid: { top: 20, right: 20, bottom: 48, left: 16, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 10,
          interval: 0,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 10,
          formatter: (v: number) => formatCopM(v),
        },
        splitLine: { lineStyle: { color: tokens.textSecondary + '22', type: 'dashed' } },
      },
      series: [
        {
          name: labelBase,
          type: 'line',
          smooth: true,
          data: makeLineData('cajaBase'),
          lineStyle: { color: COLOR_BASE, width: 2.5 },
          itemStyle: { color: COLOR_BASE },
          symbol: 'circle',
          symbolSize: 5,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: COLOR_BASE + '33' },
                { offset: 1, color: COLOR_BASE + '00' },
              ],
            },
          },
          animationDelay: (idx: number) => idx * 40,
          animationEasing: 'cubicOut',
          markLine: {
            silent: true,
            symbol: 'none',
            label: {
              show: true,
              position: 'end',
              color: COLOR_ZERO_LINE,
              fontSize: 10,
              formatter: labelZero,
            },
            lineStyle: { color: COLOR_ZERO_LINE, type: 'dashed', width: 1.5, opacity: 0.8 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: labelCons,
          type: 'line',
          smooth: true,
          data: makeLineData('cajaConservadora'),
          lineStyle: { color: COLOR_CONSERVADORA, width: 2, type: 'dashed' },
          itemStyle: { color: COLOR_CONSERVADORA },
          symbol: 'circle',
          symbolSize: 4,
          animationDelay: (idx: number) => idx * 40 + 80,
          animationEasing: 'cubicOut',
        },
        {
          name: labelAgr,
          type: 'line',
          smooth: true,
          data: makeLineData('cajaAgresiva'),
          lineStyle: { color: COLOR_AGRESIVA, width: 2 },
          itemStyle: { color: COLOR_AGRESIVA },
          symbol: 'circle',
          symbolSize: 4,
          animationDelay: (idx: number) => idx * 40 + 160,
          animationEasing: 'cubicOut',
        },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, tokens, isEs]);

  const title = isEs ? 'Caja Proyectada' : 'Projected Cash';
  const subtitle = isEs
    ? 'Proyección 12 meses · 3 escenarios'
    : '12-month projection · 3 scenarios';

  return (
    <div className="flex flex-col gap-3">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">
            {isEs ? 'Tendencia · Pilar Futuro' : 'Trend · Future Pillar'}
          </span>
          <span className="text-xs text-n-600 dark:text-n-400">
            {isEs
              ? 'Factores: Base 1.0× · Conservador 0.85× · Agresivo 1.10×'
              : 'Factors: Base 1.0× · Conservative 0.85× · Aggressive 1.10×'}
          </span>
          {conservadoraCruzaCero && (
            <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 shrink-0"
                aria-hidden="true"
              />
              {isEs
                ? 'Escenario conservador cruza umbral de quiebre'
                : 'Conservative scenario crosses break-even threshold'}
            </span>
          )}
        </div>
      </div>

      {/* Gráfico */}
      <ChartContainer
        title={title}
        subtitle={subtitle}
        height={chartHeight}
        density={density}
        empty={empty}
        emptyLabel={isEs ? 'Sin datos de proyección' : 'No projection data available'}
      >
        <ReactECharts
          echarts={echarts}
          option={option}
          theme={theme}
          style={{ height: '100%', width: '100%' }}
          notMerge
          lazyUpdate
          opts={{ renderer: 'canvas' }}
          aria-label={isEs ? 'Gráfico de caja proyectada' : 'Projected cash chart'}
          data-testid="chart-futuro-trend"
        />
      </ChartContainer>
    </div>
  );
}

export default FuturoTrendBars;

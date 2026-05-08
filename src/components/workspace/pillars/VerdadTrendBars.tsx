'use client';

/**
 * VerdadTrendBars — evolución temporal Errores / Descalces / Anomalías en barras.
 *
 * Toggle de métrica local (useState). Implementación con ECharts para mantener
 * coherencia de estilo y temas del proyecto.
 *
 * Colores:
 *   Errores    → red-500    (#ef4444)
 *   Descalces  → amber-500  (#f59e0b)
 *   Anomalías  → violet-500 (#8b5cf6)
 *
 * Si todos los períodos tienen descalces=0, muestra mensaje "ecuación cuadrada"
 * en lugar del gráfico (mejor UX).
 * Si la serie fue interpolada (1 solo período anual), muestra badge ámbar
 * "Datos provisionales".
 */

import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { ChartContainer } from '@/components/charts/ChartContainer';
import type { VerdadBarSeries } from '@/lib/pillars/verdad-bars';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Metric = 'errores' | 'descalces' | 'anomalias';

export interface VerdadTrendBarsProps {
  series: VerdadBarSeries[];
  language: 'es' | 'en';
  density?: 'comfortable' | 'compact';
}

// ─── Labels i18n ─────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<Metric, { es: string; en: string }> = {
  errores:   { es: 'Errores',   en: 'Errors' },
  descalces: { es: 'Descalces', en: 'Mismatches' },
  anomalias: { es: 'Anomalías', en: 'Anomalies' },
};

const METRIC_DESC: Record<Metric, { es: string; en: string }> = {
  errores:   {
    es: 'Hallazgos críticos × 3 + altos + discrepancias + reclasificaciones',
    en: 'Critical findings × 3 + high + discrepancies + reclassifications',
  },
  descalces: {
    es: '1 si la ecuación patrimonial descuadra más de $1.000 COP, 0 si cuadra',
    en: '1 if the equity equation is off by more than $1,000 COP, 0 if balanced',
  },
  anomalias: {
    es: 'Reclasificaciones NIIF aplicadas (proxy de anomalías)',
    en: 'Applied NIIF reclassifications (anomaly proxy)',
  },
};

const TOGGLES: Metric[] = ['errores', 'descalces', 'anomalias'];

// ─── Colores fijos (design tokens independientes de tema) ────────────────────

const METRIC_COLORS: Record<Metric, string> = {
  errores:   '#ef4444', // red-500
  descalces: '#f59e0b', // amber-500
  anomalias: '#8b5cf6', // violet-500
};

// ─── Componente principal ────────────────────────────────────────────────────

export function VerdadTrendBars({ series, language, density }: VerdadTrendBarsProps) {
  const [metric, setMetric] = useState<Metric>('errores');
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const isEs = language === 'es';
  const isCompact = density === 'compact';
  const chartHeight = isCompact ? 220 : 280;

  const hasInterpolated = series.some((p) => p.isInterpolated);
  const empty = series.length === 0;
  const color = METRIC_COLORS[metric];

  // Si seleccionamos "descalces" y todos son 0, mostrar mensaje especial.
  const allDescalcesCero =
    metric === 'descalces' && series.length > 0 && series.every((p) => p.descalces === 0);

  const option = useMemo(() => {
    const labels = series.map((p) => p.label);
    const values = series.map((p) => ({
      value: p[metric],
      itemStyle: {
        color,
        opacity: p.isInterpolated ? 0.65 : 1,
        borderRadius: [3, 3, 0, 0],
      },
    }));

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
          const metricLabel = METRIC_LABELS[metric][isEs ? 'es' : 'en'];
          const metricDesc = METRIC_DESC[metric][isEs ? 'es' : 'en'];
          const v = point[metric];
          const provisional = point.isInterpolated
            ? `<br/><span style="font-size:10px;opacity:0.6">${isEs ? 'Estimado (tendencia descendente interpolada)' : 'Estimated (interpolated descending trend)'}</span>`
            : '';
          return `<strong>${point.label}</strong><br/>${metricLabel}: <strong>${v}</strong><br/><span style="font-size:10px;opacity:0.7">${metricDesc}</span>${provisional}`;
        },
      },
      grid: { top: 28, right: 16, bottom: 32, left: 48, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: tokens.textSecondary, fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 10,
          formatter: (v: number) => String(Math.round(v)),
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
            fontSize: 10,
            formatter: (p: { dataIndex: number }) => {
              const pt = series[p.dataIndex];
              return pt ? String(pt[metric]) : '';
            },
          },
          animationDelay: (idx: number) => idx * 60,
          animationEasing: 'cubicOut',
        },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metric, tokens, color, isEs]);

  const subtitle = hasInterpolated
    ? (isEs
        ? 'Datos provisionales — tendencia descendente interpolada'
        : 'Provisional data — interpolated descending trend')
    : (isEs ? 'Evolución por período' : 'Period evolution');

  const title = isEs
    ? `Salud Contable · ${METRIC_LABELS[metric].es}`
    : `Accounting Health · ${METRIC_LABELS[metric].en}`;

  const goal = isEs
    ? 'Objetivo: tendencia descendente hacia 0'
    : 'Goal: descending trend to 0';

  return (
    <div className="flex flex-col gap-3">
      {/* Toggle de métrica */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">
            {isEs ? 'Tendencia · Pilar Verdad' : 'Trend · Truth Pillar'}
          </span>
          <span className="text-xs text-n-600 dark:text-n-400">{goal}</span>
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

      {/* Mensaje especial cuando todos los descalces = 0 */}
      {allDescalcesCero ? (
        <div className="flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 px-4 py-6 text-center">
          <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
            {isEs
              ? 'Sin descalces — ecuación cuadrada en todos los períodos'
              : 'No mismatches — equation balanced across all periods'}
          </p>
        </div>
      ) : (
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
            aria-label={isEs ? 'Gráfico de salud contable' : 'Accounting health chart'}
            data-testid="chart-verdad-trend"
          />
        </ChartContainer>
      )}
    </div>
  );
}

export default VerdadTrendBars;

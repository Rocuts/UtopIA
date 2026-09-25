'use client';

/**
 * MonteCarloHistogram — escenario simulado: utilidad 12m / PPE neto.
 *
 * Auditoría valoracion-22: grafica el histograma EMPÍRICO de los ROI simulados
 * (`result.roiHistograma`), no una PDF normal teórica; el título usa el N real
 * (`result.iterations`) y la UI muestra los supuestos (distribución, σ,
 * horizonte, N, semilla y exclusiones). Sin PPE (grupo 15) el ROI es N/D.
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { formatPct } from '@/lib/charts/format';
import type { MonteCarloResult } from '@/lib/pillars/types';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MonteCarloHistogramProps {
  result: MonteCarloResult;
  language: 'es' | 'en';
  density?: 'comfortable' | 'compact';
}

// ─── Constantes de color ─────────────────────────────────────────────────────

const COLOR_BAR = '#8b5cf6';       // violet-500
const COLOR_MEAN = '#ef4444';      // red-500 (dashed vertical)
const COLOR_MEDIAN = '#10b981';    // emerald-500

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Porcentaje con el separador decimal del idioma (`12,5%` / `12.5%`), no
 * `toFixed(1)`, que en español mostraba punto decimal (ratios-kpis-27).
 */
export function monteCarloPct(v: number, language: 'es' | 'en'): string {
  return formatPct(v, 1, language);
}

function quiebreColor(prob: number): string {
  if (prob > 0.2) return 'text-red-600 dark:text-red-400';
  if (prob < 0.1) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-amber-600 dark:text-amber-400';
}

function quiebreBg(prob: number): string {
  if (prob > 0.2) return 'bg-red-500/10 border border-red-500/25';
  if (prob < 0.1) return 'bg-emerald-500/10 border border-emerald-500/25';
  return 'bg-amber-500/10 border border-amber-500/25';
}

// ─── Mini-tarjeta ─────────────────────────────────────────────────────────────

interface MiniCardProps {
  label: string;
  value: string;
  color: string;
}

function MiniCard({ label, value, color }: MiniCardProps) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-lg border border-n-200 bg-n-50 px-3 py-2 min-w-[90px]"
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-n-500">{label}</span>
      <span
        className="font-mono text-lg font-semibold tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function MonteCarloHistogram({ result, language, density }: MonteCarloHistogramProps) {
  const isEs = language === 'es';
  const isCompact = density === 'compact';
  const chartHeight = isCompact ? 180 : 240;

  const theme = useChartTheme();
  const tokens = getTokens(theme);

  const roi = result.roiProbabilistico;
  const prob = result.probabilidadQuiebre12m;

  const bins = useMemo(() => result.roiHistograma ?? [], [result.roiHistograma]);

  const option = useMemo(() => {
    if (!roi || bins.length === 0) return null;

    const labels = bins.map((b) => monteCarloPct((b.from + b.to) / 2, language));
    const heights = bins.map((b) => b.count);
    const binLabelOf = (v: number) => {
      const idx = bins.findIndex((b) => v >= b.from && v <= b.to);
      return labels[idx === -1 ? (v < bins[0].from ? 0 : bins.length - 1) : idx];
    };

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          if (!arr[0]) return '';
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const bin = bins[idx];
          if (!bin) return '';
          return [
            `<strong>ROI: ${monteCarloPct(bin.from, language)} – ${monteCarloPct(bin.to, language)}</strong>`,
            `<span style="font-size:10px;color:${tokens.textSecondary}">${isEs ? 'Simulaciones' : 'Simulations'}: ${bin.count} (${monteCarloPct(bin.count / result.iterations, language)})</span>`,
          ].join('<br/>');
        },
      },
      grid: {
        top: 12,
        right: 16,
        bottom: 36,
        left: 16,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 9,
          interval: 4,
          rotate: 0,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        show: false,
      },
      series: [
        {
          type: 'bar',
          data: heights.map((h) => ({
            value: h,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 1, x2: 0, y2: 0,
                colorStops: [
                  { offset: 0, color: COLOR_BAR + '4d' }, // alpha ~0.30
                  { offset: 1, color: COLOR_BAR + 'ff' }, // alpha 1.00
                ],
              },
              borderRadius: [3, 3, 0, 0],
            },
            // Resaltar el bin más alto con un color más sólido
            emphasis: { itemStyle: { color: COLOR_BAR } },
          })),
          barMaxWidth: 28,
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              // Línea roja punteada en mean
              {
                name: isEs ? 'Media' : 'Mean',
                xAxis: binLabelOf(roi.mean),
                lineStyle: { color: COLOR_MEAN, type: 'dashed', width: 1.5 },
                label: {
                  show: true,
                  position: 'insideEndTop',
                  color: COLOR_MEAN,
                  fontSize: 9,
                  formatter: `μ ${monteCarloPct(roi.mean, language)}`,
                },
              },
              // Línea verde sólida en p50
              {
                name: isEs ? 'Mediana' : 'Median',
                xAxis: binLabelOf(roi.p50),
                lineStyle: { color: COLOR_MEDIAN, type: 'solid', width: 1.5 },
                label: {
                  show: true,
                  position: 'insideEndBottom',
                  color: COLOR_MEDIAN,
                  fontSize: 9,
                  formatter: `P50 ${monteCarloPct(roi.p50, language)}`,
                },
              },
            ],
          },
          animationEasing: 'cubicOut',
          animationDuration: 600,
        },
      ],
    };
  }, [roi, bins, tokens, isEs, language, result.iterations]);

  // ── Textos ───────────────────────────────────────────────────────────────────
  const nFmt = result.iterations.toLocaleString(isEs ? 'es-CO' : 'en-US');
  const title = isEs
    ? `Escenario simulado · utilidad 12m / PPE neto (Monte Carlo · ${nFmt} iteraciones)`
    : `Simulated scenario · 12m profit / net PPE (Monte Carlo · ${nFmt} iterations)`;
  const sup = result.supuestos;
  const supuestosLabel = isEs
    ? `Supuestos: ingresos normales i.i.d. mensuales, σ ${(sup.ingresoSigmaMensual * 100).toFixed(0)} %, horizonte ${sup.horizonteMeses} meses, N = ${nFmt}, semilla ${sup.semilla}. ${sup.exclusionesEs}`
    : `Assumptions: i.i.d. normal monthly revenue, σ ${(sup.ingresoSigmaMensual * 100).toFixed(0)}%, ${sup.horizonteMeses}-month horizon, N = ${nFmt}, seed ${sup.semilla}. ${sup.exclusionesEn}`;

  const quiebreLabel = isEs
    ? `Probabilidad de quiebre en 12m: ${monteCarloPct(prob, language)}`
    : `Break probability in 12m: ${monteCarloPct(prob, language)}`;

  const noPpeLabel = isEs
    ? 'N/D — sin propiedad, planta y equipo (grupo 15) para medir el retorno.'
    : 'N/A — no property, plant and equipment (group 15) to measure the return.';

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">
          {isEs ? 'Análisis de Riesgo · Pilar Futuro' : 'Risk Analysis · Future Pillar'}
        </span>
        <h3 className="font-serif-elite text-base font-normal text-n-1000 tracking-tight">
          {title}
        </h3>
        <p className="text-[11px] leading-snug text-n-700" data-testid="montecarlo-assumptions">
          {supuestosLabel}
        </p>

        {/* Probabilidad de quiebre */}
        <div
          className={[
            'inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-medium mt-0.5',
            quiebreBg(prob),
          ].join(' ')}
        >
          <span
            className={['inline-block h-1.5 w-1.5 rounded-full shrink-0', quiebreColor(prob)].join(' ')}
            style={{ background: 'currentColor' }}
            aria-hidden="true"
          />
          <span className={quiebreColor(prob)}>{quiebreLabel}</span>
        </div>
      </div>

      {roi === null ? (
        /* Callout sin PPE */
        <div className="rounded-lg border border-n-200 bg-n-50 px-4 py-3">
          <p className="text-xs text-n-700">{noPpeLabel}</p>
        </div>
      ) : (
        <>
          {/* Mini-tarjetas P10 / P50 / P90 */}
          <div className="flex flex-wrap gap-2">
            <MiniCard
              label="P10"
              value={monteCarloPct(roi.p10, language)}
              color="#ef4444"
            />
            <MiniCard
              label={isEs ? 'P50 (Mediana)' : 'P50 (Median)'}
              value={monteCarloPct(roi.p50, language)}
              color={COLOR_MEDIAN}
            />
            <MiniCard
              label="P90"
              value={monteCarloPct(roi.p90, language)}
              color="#8b5cf6"
            />
          </div>

          {/* Histograma */}
          {option && (
            <ChartContainer
              title=""
              subtitle={isEs ? 'Frecuencia de los ROI simulados (histograma empírico)' : 'Frequency of simulated ROI (empirical histogram)'}
              height={chartHeight}
              density={density}
              empty={bins.length === 0}
              emptyLabel={isEs ? 'Sin datos suficientes' : 'Insufficient data'}
            >
              <ReactECharts
                echarts={echarts}
                option={option}
                theme={theme}
                style={{ height: '100%', width: '100%' }}
                notMerge
                lazyUpdate
                opts={{ renderer: 'canvas' }}
                aria-label={isEs ? 'Histograma de distribución de ROI probabilístico' : 'Probabilistic ROI distribution histogram'}
                data-testid="chart-montecarlo-histogram"
              />
            </ChartContainer>
          )}
        </>
      )}
    </div>
  );
}

export default MonteCarloHistogram;

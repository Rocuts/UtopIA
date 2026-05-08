'use client';

/**
 * MonteCarloHistogram — ROI Probabilístico (Monte Carlo · 9.600 escenarios).
 *
 * Visualiza la distribución del ROI usando una curva normal aproximada (PDF)
 * centrada en `mean` con desviación `stdev` (20 bins en [mean−3σ, mean+3σ]).
 * Si `roiProbabilistico === null` (sin inversión PPE) muestra un callout
 * sin el histograma.
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { ChartContainer } from '@/components/charts/ChartContainer';
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

const N_BINS = 20;

// ─── PDF normal ──────────────────────────────────────────────────────────────

/** PDF de la distribución normal N(mean, stdev). */
function normalPdf(x: number, mean: number, stdev: number): number {
  if (stdev === 0) return 0;
  const z = (x - mean) / stdev;
  return (1 / (stdev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
}

// ─── Generación de bins ──────────────────────────────────────────────────────

interface Bin {
  x: number;   // centro del bin (ROI fracción)
  pdf: number; // altura sin normalizar
}

function buildBins(mean: number, stdev: number): Bin[] {
  // Fallback: si stdev es 0 usamos un rango artificial de ±10% del mean.
  const spread = stdev > 0 ? stdev : Math.max(Math.abs(mean) * 0.1, 0.01);
  const lo = mean - 3 * spread;
  const hi = mean + 3 * spread;
  const step = (hi - lo) / N_BINS;

  const bins: Bin[] = [];
  for (let i = 0; i < N_BINS; i++) {
    const x = lo + step * (i + 0.5);
    bins.push({ x, pdf: normalPdf(x, mean, spread) });
  }
  // Normalizar para que el bin más alto = 1.0.
  const maxPdf = Math.max(...bins.map((b) => b.pdf), Number.EPSILON);
  return bins.map((b) => ({ x: b.x, pdf: b.pdf / maxPdf }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pctStr(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
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
      className="flex flex-col gap-0.5 rounded-lg border border-n-200 dark:border-n-700 bg-n-50 dark:bg-n-900 px-3 py-2 min-w-[90px]"
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

  const bins = useMemo(() => {
    if (!roi) return [];
    return buildBins(roi.mean, roi.stdev);
  }, [roi]);

  const option = useMemo(() => {
    if (!roi || bins.length === 0) return null;

    const labels = bins.map((b) => pctStr(b.x));
    const heights = bins.map((b) => parseFloat(b.pdf.toFixed(4)));

    // Encontrar el índice más cercano a p50 para la línea verde.
    const p50Pct = roi.p50 * 100;
    const meanPct = roi.mean * 100;

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
            `<strong>ROI: ${pctStr(bin.x)}</strong>`,
            `<span style="font-size:10px;color:${tokens.textSecondary}">${isEs ? 'Densidad relativa' : 'Relative density'}: ${(bin.pdf * 100).toFixed(0)}%</span>`,
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
          data: heights.map((h, i) => ({
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
                xAxis: pctStr(roi.mean),
                lineStyle: { color: COLOR_MEAN, type: 'dashed', width: 1.5 },
                label: {
                  show: true,
                  position: 'insideEndTop',
                  color: COLOR_MEAN,
                  fontSize: 9,
                  formatter: `μ ${meanPct.toFixed(1)}%`,
                },
              },
              // Línea verde sólida en p50
              {
                name: isEs ? 'Mediana' : 'Median',
                xAxis: pctStr(roi.p50),
                lineStyle: { color: COLOR_MEDIAN, type: 'solid', width: 1.5 },
                label: {
                  show: true,
                  position: 'insideEndBottom',
                  color: COLOR_MEDIAN,
                  fontSize: 9,
                  formatter: `P50 ${p50Pct.toFixed(1)}%`,
                },
              },
            ],
          },
          animationEasing: 'cubicOut',
          animationDuration: 600,
        },
      ],
    };
  }, [roi, bins, tokens, isEs]);

  // ── Textos ───────────────────────────────────────────────────────────────────
  const title = isEs
    ? 'ROI Probabilístico (Monte Carlo · 9.600 escenarios)'
    : 'Probabilistic ROI (Monte Carlo · 9,600 scenarios)';

  const quiebreLabel = isEs
    ? `Probabilidad de quiebre en 12m: ${pctStr(prob)}`
    : `Break probability in 12m: ${pctStr(prob)}`;

  const noPpeLabel = isEs
    ? 'Sin inversión PPE — ROI no calculable'
    : 'No PPE investment — ROI not computable';

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
        <div className="rounded-lg border border-n-200 dark:border-n-700 bg-n-50 dark:bg-n-900 px-4 py-3">
          <p className="text-xs text-n-600 dark:text-n-400 italic">{noPpeLabel}</p>
        </div>
      ) : (
        <>
          {/* Mini-tarjetas P10 / P50 / P90 */}
          <div className="flex flex-wrap gap-2">
            <MiniCard
              label="P10"
              value={pctStr(roi.p10)}
              color="#ef4444"
            />
            <MiniCard
              label={isEs ? 'P50 (Mediana)' : 'P50 (Median)'}
              value={pctStr(roi.p50)}
              color={COLOR_MEDIAN}
            />
            <MiniCard
              label="P90"
              value={pctStr(roi.p90)}
              color="#8b5cf6"
            />
          </div>

          {/* Histograma */}
          {option && (
            <ChartContainer
              title=""
              subtitle={isEs ? 'Densidad relativa de la distribución normal aproximada (PDF)' : 'Relative density of approximated normal distribution (PDF)'}
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

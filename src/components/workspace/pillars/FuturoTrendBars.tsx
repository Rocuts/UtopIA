'use client';

/**
 * FuturoTrendBars — Proyección de caja 12 meses · 3 escenarios.
 *
 * Gráfico de LÍNEAS paralelas para mostrar trayectorias futuras:
 *   Base         → violet-500 (#8b5cf6)  línea principal (ajustable por el usuario)
 *   Conservadora → red-500    (#ef4444)  escenario de estrés
 *   Agresiva     → emerald-500 (#10b981) escenario optimista
 *
 * Incluye markLine en y=0 para visualizar el umbral de quiebre de caja.
 * Tooltip con formato COP abreviado ($1.234M).
 *
 * Selector "Crecimiento Estimado": cuando se recibe `balance` el usuario puede
 * ajustar el factor de crecimiento del escenario base y ver la línea
 * recalcularse instantáneamente. Sin balance, el selector queda visible pero
 * deshabilitado (modo demo / mock).
 */

import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import { Plus } from 'lucide-react';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { cn } from '@/lib/utils';
import { buildFuturoBarSeries } from '@/lib/pillars/futuro-bars';
import type { FuturoBarSeries } from '@/lib/pillars/futuro-bars';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { useCapexEvents } from '@/hooks/useCapexEvents';
import { CapexEventsModal } from './CapexEventsModal';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FuturoTrendBarsProps {
  series: FuturoBarSeries[];
  language: 'es' | 'en';
  density?: 'comfortable' | 'compact';
  /** Si viene, permite recalcular el escenario base al cambiar growthOverride. */
  balance?: PreprocessedBalance;
  /** workspaceId para namespacing de localStorage de capex events. Fallback 'default'. */
  workspaceId?: string;
}

// ─── Constantes del selector ─────────────────────────────────────────────────

interface GrowthPreset {
  label: string;
  value: number | 'custom';
}

const GROWTH_PRESETS: GrowthPreset[] = [
  { label: '-5%', value: -0.05 },
  { label: '0%',  value: 0 },
  { label: '+5%', value: 0.05 },
  { label: '+10%', value: 0.10 },
  { label: 'Custom', value: 'custom' },
];

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

/** Formatea un factor de crecimiento como porcentaje con signo. Ej: +5% / -5% */
function formatGrowthPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${Math.round(v * 100)}%`;
}

// ─── Colores fijos ────────────────────────────────────────────────────────────

const COLOR_BASE = '#8b5cf6';        // violet-500
const COLOR_CONSERVADORA = '#ef4444'; // red-500
const COLOR_AGRESIVA = '#10b981';    // emerald-500
const COLOR_ZERO_LINE = '#f59e0b';   // amber-500 — umbral de quiebre

// ─── Componente principal ─────────────────────────────────────────────────────

export function FuturoTrendBars({ series, language, density, balance, workspaceId = 'default' }: FuturoTrendBarsProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const isEs = language === 'es';
  const isCompact = density === 'compact';
  const chartHeight = isCompact ? 220 : 300;

  // ── Estado del selector de crecimiento ──────────────────────────────────
  const [selectedPreset, setSelectedPreset] = useState<number | 'custom'>(0);
  const [customPctStr, setCustomPctStr] = useState<string>('0');

  // ── Estado del modal de capex ────────────────────────────────────────────
  const [capexModalOpen, setCapexModalOpen] = useState(false);
  const { events: capexEvents, addEvent, removeEvent } = useCapexEvents(workspaceId);

  const growthOverride: number = useMemo(() => {
    if (selectedPreset === 'custom') {
      const parsed = parseInt(customPctStr, 10);
      if (!isNaN(parsed)) return Math.min(50, Math.max(-50, parsed)) / 100;
      return 0;
    }
    return selectedPreset;
  }, [selectedPreset, customPctStr]);

  // ── Serie efectiva — recalcula con balance, growthOverride y capexEvents ─
  const effectiveSeries: FuturoBarSeries[] = useMemo(() => {
    if (!balance) return series;
    return buildFuturoBarSeries(balance, { growthOverride, capexEvents });
  }, [balance, series, growthOverride, capexEvents]);

  const empty = effectiveSeries.length === 0;

  // Detectar si algún escenario cruza cero (alerta de quiebre visible)
  const conservadoraCruzaCero = effectiveSeries.some((p) => p.cajaConservadora <= 0);

  // Mapa de nombres de eventos por mes para tooltip del markPoint.
  const capexNamesByMonth = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const ev of capexEvents) {
      const names = map.get(ev.monthOffset) ?? [];
      names.push(ev.name);
      map.set(ev.monthOffset, names);
    }
    return map;
  }, [capexEvents]);

  // markPoint data: one pin per month that has capex events.
  const capexMarkPoints = useMemo(() => {
    const labelCapex = isEs ? 'Evento CapEx' : 'CapEx Event';
    return effectiveSeries
      .filter((p) => p.capexAplicado > 0)
      .map((p) => {
        const names = capexNamesByMonth.get(p.monthIndex) ?? [];
        const label = names.length > 0 ? names.join(', ') : labelCapex;
        return {
          name: label,
          coord: [p.label, Math.round(p.cajaBase)],
          value: formatCopM(p.capexAplicado),
          symbolSize: 28,
          itemStyle: { color: '#f59e0b' },
          label: { show: false },
          tooltip: {
            formatter: `<strong>${label}</strong><br/>−${formatCopM(p.capexAplicado)}`,
          },
        };
      });
  }, [effectiveSeries, capexNamesByMonth, isEs]);

  const option = useMemo(() => {
    const labels = effectiveSeries.map((p) => p.label);

    const makeLineData = (key: keyof Pick<FuturoBarSeries, 'cajaBase' | 'cajaConservadora' | 'cajaAgresiva'>) =>
      effectiveSeries.map((p) => Math.round(p[key]));

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
          const point = effectiveSeries[idx];
          if (!point) return '';

          const rows = [
            `<strong>${point.label}</strong>`,
            `<span style="color:${COLOR_BASE}">●</span> ${labelBase}: <strong>${formatCopM(point.cajaBase)}</strong>`,
            `<span style="color:${COLOR_CONSERVADORA}">●</span> ${labelCons}: <strong>${formatCopM(point.cajaConservadora)}</strong>`,
            `<span style="color:${COLOR_AGRESIVA}">●</span> ${labelAgr}: <strong>${formatCopM(point.cajaAgresiva)}</strong>`,
          ];

          if (point.capexAplicado > 0) {
            const names = capexNamesByMonth.get(point.monthIndex) ?? [];
            const evLabel = names.length > 0 ? names.join(', ') : (isEs ? 'Evento CapEx' : 'CapEx Event');
            rows.push(
              `<span style="font-size:10px;color:#f59e0b">▼ ${evLabel}: −${formatCopM(point.capexAplicado)}</span>`,
            );
          }

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
          // markPoint: pines dorados en meses con capex.
          markPoint: capexMarkPoints.length > 0
            ? {
                tooltip: { trigger: 'item' },
                symbol: 'pin',
                data: capexMarkPoints,
              }
            : undefined,
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
  }, [effectiveSeries, tokens, isEs, capexMarkPoints, capexNamesByMonth]);

  const title = isEs ? 'Caja Proyectada' : 'Projected Cash';
  const subtitle = isEs
    ? 'Proyección 12 meses · escenario base ajustable · conservador y agresivo fijos'
    : '12-month projection · adjustable base scenario · fixed conservative & aggressive';

  const hasBalance = !!balance;

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
              ? 'Factores: Base ajustable · Conservador 0.85× · Agresivo 1.10×'
              : 'Factors: Adjustable base · Conservative 0.85× · Aggressive 1.10×'}
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

      {/* ── Selector Crecimiento Estimado + Botón Eventos de Futuro ─────────── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">
            {isEs ? 'Crecimiento Estimado' : 'Estimated Growth'}
          </span>

          {/* Botón Añadir Evento de Futuro */}
          <button
            type="button"
            onClick={() => setCapexModalOpen(true)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs-mono font-medium',
              'bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30',
              'text-amber-600 dark:text-amber-400',
              'transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-1',
            )}
            aria-label={isEs ? 'Gestionar Eventos de Futuro' : 'Manage Future Events'}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {isEs ? 'Añadir Evento' : 'Add Event'}
            {capexEvents.length > 0 && (
              <span className={cn(
                'inline-flex items-center justify-center h-4 min-w-4 rounded-full px-1',
                'bg-amber-500 text-white text-[10px] font-bold leading-none',
              )}>
                {capexEvents.length}
              </span>
            )}
          </button>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={isEs ? 'Selector de crecimiento estimado' : 'Estimated growth selector'}
        >
          {GROWTH_PRESETS.map((preset) => {
            const isActive = selectedPreset === preset.value;
            return (
              <button
                key={String(preset.value)}
                type="button"
                disabled={!hasBalance}
                onClick={() => setSelectedPreset(preset.value)}
                className={[
                  'rounded-full px-3 py-1 text-xs-mono font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1',
                  isActive
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-n-50 text-n-700 hover:bg-n-100 dark:bg-n-800 dark:text-n-300 dark:hover:bg-n-700',
                  !hasBalance ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                ].join(' ')}
                aria-pressed={isActive}
              >
                {preset.label}
              </button>
            );
          })}

          {/* Input numérico inline para Custom */}
          {selectedPreset === 'custom' && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={-50}
                max={50}
                step={1}
                value={customPctStr}
                onChange={(e) => setCustomPctStr(e.target.value)}
                disabled={!hasBalance}
                aria-label={isEs ? 'Porcentaje personalizado' : 'Custom percentage'}
                className={[
                  'w-16 rounded-md border border-n-200 bg-n-50 px-2 py-1 text-xs-mono text-n-900',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500',
                  'dark:border-n-700 dark:bg-n-800 dark:text-n-100',
                  !hasBalance ? 'cursor-not-allowed opacity-40' : '',
                ].join(' ')}
              />
              <span className="text-xs text-n-600 dark:text-n-400">%</span>
            </div>
          )}
        </div>

        {/* Etiqueta dinámica o mensaje "Sube un balance" */}
        {hasBalance ? (
          <p className="text-xs text-n-600 dark:text-n-400">
            {isEs
              ? `Crecimiento esperado: ${formatGrowthPct(growthOverride)} (escenario base)`
              : `Expected growth: ${formatGrowthPct(growthOverride)} (base scenario)`}
          </p>
        ) : (
          <p className="text-xs text-n-500 italic">
            {isEs
              ? 'Sube un balance para activar el ajuste de crecimiento'
              : 'Upload a balance to activate growth adjustment'}
          </p>
        )}
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

      {/* ── Badge resumen de eventos de futuro ─────────────────────────────── */}
      {capexEvents.length > 0 && (
        <button
          type="button"
          onClick={() => setCapexModalOpen(true)}
          className={cn(
            'self-start inline-flex items-center gap-1.5 rounded-full px-3 py-1',
            'bg-amber-500/10 border border-amber-500/20',
            'text-xs text-amber-600 dark:text-amber-400',
            'hover:bg-amber-500/20 transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60',
          )}
          aria-label={isEs ? 'Ver eventos de futuro' : 'View future events'}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
          {capexEvents.length === 1
            ? (isEs ? '1 evento programado' : '1 scheduled event')
            : (isEs
                ? `${capexEvents.length} eventos · Total ${formatCopM(capexEvents.reduce((s, e) => s + e.amountCop, 0))}`
                : `${capexEvents.length} events · Total ${formatCopM(capexEvents.reduce((s, e) => s + e.amountCop, 0))}`
              )}
        </button>
      )}

      {/* ── Modal Eventos de Futuro ─────────────────────────────────────────── */}
      <CapexEventsModal
        open={capexModalOpen}
        onOpenChange={setCapexModalOpen}
        events={capexEvents}
        onAdd={addEvent}
        onRemove={removeEvent}
      />
    </div>
  );
}

export default FuturoTrendBars;

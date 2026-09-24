'use client';

/**
 * RunwayProjection — runway de caja a 36 meses con 3 escenarios.
 * Líneas: base (gold), conservador (warning), agresivo (success).
 * markLine horizontal en y=0 (línea wine punteada) para señalar el umbral.
 *
 * valoracion-24: conservador y agresivo son SUPUESTOS DE SENSIBILIDAD sobre
 * los ingresos, no pronósticos. El subtítulo por defecto toma sus rótulos de
 * RUNWAY_ESCENARIOS (src/lib/kpis/runway.ts), la misma fuente que calcula la
 * serie, en es/en según `language`.
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { formatBigCop, formatCop } from '@/lib/charts/format';
import { RUNWAY_ESCENARIOS, RUNWAY_SERIE_BASE } from '@/lib/kpis/runway';
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
  /** Idioma de los rótulos por defecto (título, subtítulo, leyenda). */
  language?: 'es' | 'en';
  title?: string;
  subtitle?: string;
}

/**
 * Textos del gráfico por idioma. Los nombres de las series (leyenda y
 * tooltip) y los rótulos del subtítulo salen de RUNWAY_ESCENARIOS /
 * RUNWAY_SERIE_BASE (I5-niif 7), la misma fuente que calcula la serie.
 */
export function runwayProjectionTexts(language: 'es' | 'en') {
  const { conservador, agresivo } = RUNWAY_ESCENARIOS;
  const base = RUNWAY_SERIE_BASE;
  if (language === 'en') {
    return {
      title: 'Cash runway · 36 months',
      subtitle:
        `${base.nombreEn}: ${base.rotuloEn} · ${conservador.nombreEn}: ${conservador.rotuloEn} · ` +
        `${agresivo.nombreEn}: ${agresivo.rotuloEn}`,
      series: { base: base.nombreEn, conservador: conservador.nombreEn, agresivo: agresivo.nombreEn },
      cashZero: 'Cash = 0',
      empty: 'No runway projection',
      ariaLabel: '36-month cash runway',
    };
  }
  return {
    title: 'Runway de Caja · 36 meses',
    subtitle:
      `${base.nombre}: ${base.rotulo} · ${conservador.nombre}: ${conservador.rotulo} · ` +
      `${agresivo.nombre}: ${agresivo.rotulo}`,
    series: { base: base.nombre, conservador: conservador.nombre, agresivo: agresivo.nombre },
    cashZero: 'Caja = 0',
    empty: 'Sin proyección de runway',
    ariaLabel: 'Runway de caja 36 meses',
  };
}

export function RunwayProjection({
  months,
  height = 320,
  density,
  language = 'es',
  title,
  subtitle,
}: RunwayProjectionProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const empty = !months || months.length === 0;
  const texts = useMemo(() => runwayProjectionTexts(language), [language]);

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
            .map((p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${formatCop(p.value, language)}`)
            .join('<br/>');
          return `<strong>${m}</strong><br/>${lines}`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: tokens.textSecondary, fontSize: 11 },
        data: [texts.series.base, texts.series.conservador, texts.series.agresivo],
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
          name: texts.series.agresivo,
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
          name: texts.series.base,
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
              formatter: texts.cashZero,
            },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: texts.series.conservador,
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
  }, [months, empty, tokens, texts, language]);

  return (
    <ChartContainer
      title={title ?? texts.title}
      subtitle={subtitle ?? texts.subtitle}
      height={height}
      density={density}
      empty={empty}
      emptyLabel={texts.empty}
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        theme={theme}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        aria-label={texts.ariaLabel}
        data-testid="chart-runway"
      />
    </ChartContainer>
  );
}

export default RunwayProjection;

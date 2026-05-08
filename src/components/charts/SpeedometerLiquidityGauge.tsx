'use client';

/**
 * SpeedometerLiquidityGauge — velocímetro semicircular 180° para el Pilar
 * Escudo. Combina Razón Corriente (eje principal) + Prueba Ácida (anillo
 * interno) + Días Autonomía (color del dial).
 *
 * Color del dial según `diasAutonomia`:
 *   ≥ 60   → gold-500 (saludable)
 *   30-59  → warning  (vigilar)
 *   < 30   → wine-700 (sangría — crítico)
 *   null   → neutral
 */

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';

import { echarts } from '@/lib/charts/setup';
import { getTokens } from '@/lib/charts/echarts-theme';
import { useChartTheme } from '@/lib/charts/use-theme';
import { ChartContainer } from './ChartContainer';

export interface SpeedometerLiquidityGaugeProps {
  data: {
    razonCorriente: number | null;
    pruebaAcida?: number | null;
    diasAutonomia: number | null;
  };
  height?: number;
  density?: 'comfortable' | 'compact';
  title?: string;
  subtitle?: string;
}

function dialColor(dias: number | null, t: ReturnType<typeof getTokens>): string {
  if (dias === null) return t.textSecondary;
  if (dias >= 60) return t.gold;
  if (dias >= 30) return t.warning;
  return t.wineDeep;
}

export function SpeedometerLiquidityGauge({
  data,
  height = 320,
  density,
  title = 'Velocímetro de Resiliencia',
  subtitle = 'Razón Corriente + Prueba Ácida · color por días de autonomía',
}: SpeedometerLiquidityGaugeProps) {
  const theme = useChartTheme();
  const tokens = getTokens(theme);
  const empty = data.razonCorriente === null;

  const option = useMemo(() => {
    const rc = data.razonCorriente ?? 0;
    const dial = dialColor(data.diasAutonomia, tokens);
    const max = Math.max(3, rc * 1.5);

    return {
      animation: true,
      series: [
        {
          type: 'gauge',
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max,
          splitNumber: 6,
          radius: '92%',
          center: ['50%', '70%'],
          itemStyle: { color: dial },
          progress: { show: true, width: 14, itemStyle: { color: dial } },
          axisLine: {
            lineStyle: {
              width: 14,
              color: [
                [1, theme === 'utopia-dark' ? '#3A3528' : '#E2DCC8'],
              ],
            },
          },
          pointer: {
            length: '60%',
            width: 4,
            itemStyle: { color: dial },
          },
          axisTick: { distance: -22, length: 6, lineStyle: { color: tokens.textSecondary, width: 1 } },
          splitLine: { distance: -28, length: 10, lineStyle: { color: tokens.textSecondary, width: 2 } },
          axisLabel: {
            distance: -8,
            color: tokens.textSecondary,
            fontSize: 10,
            formatter: (v: number) => v.toFixed(1),
          },
          anchor: {
            show: true,
            showAbove: true,
            size: 14,
            itemStyle: { borderWidth: 2, borderColor: dial, color: tokens.bg },
          },
          title: {
            offsetCenter: [0, '-22%'],
            color: tokens.textSecondary,
            fontSize: 11,
            fontFamily: 'var(--font-mono), monospace',
          },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, '-2%'],
            formatter: (v: number) => v.toFixed(2),
            color: tokens.textPrimary,
            fontFamily: 'var(--font-mono), monospace',
            fontWeight: 600,
            fontSize: 28,
          },
          data: [{ value: rc, name: 'Razón Corriente' }],
        },
        // Anillo interno con Prueba Ácida (opcional)
        ...(data.pruebaAcida !== null && data.pruebaAcida !== undefined
          ? [
              {
                type: 'gauge',
                startAngle: 200,
                endAngle: -20,
                min: 0,
                max,
                radius: '70%',
                center: ['50%', '70%'],
                progress: { show: true, width: 6, itemStyle: { color: tokens.goldSoft } },
                axisLine: { lineStyle: { width: 6, color: [[1, 'transparent']] } },
                pointer: { show: false },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: { show: false },
                anchor: { show: false },
                title: { show: false },
                detail: { show: false },
                data: [{ value: data.pruebaAcida, name: 'Prueba Ácida' }],
              },
            ]
          : []),
      ],
    };
  }, [data, tokens, theme]);

  // Subtítulo dinámico con días de autonomía
  const subtitleWithDays = useMemo(() => {
    if (data.diasAutonomia === null) return subtitle;
    return `${subtitle} · ${Math.round(data.diasAutonomia)} días`;
  }, [data.diasAutonomia, subtitle]);

  return (
    <ChartContainer
      title={title}
      subtitle={subtitleWithDays}
      height={height}
      density={density}
      empty={empty}
      emptyLabel="Sin datos de razón corriente"
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        theme={theme}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        aria-label="Velocímetro de liquidez"
        data-testid="chart-speedometer"
      />
    </ChartContainer>
  );
}

export default SpeedometerLiquidityGauge;

// ---------------------------------------------------------------------------
// Charts barrel — re-exports los 5 widgets del Command Center + helpers.
// ---------------------------------------------------------------------------
// Para mantener tree-shake intacto, NO re-exportamos directamente desde
// `echarts/core` aquí — el caller debe importar de `@/lib/charts/setup` si
// necesita el handle de echarts.
// ---------------------------------------------------------------------------

export { ChartContainer } from './ChartContainer';
export type { ChartContainerProps } from './ChartContainer';

export { SpeedometerLiquidityGauge } from './SpeedometerLiquidityGauge';
export type { SpeedometerLiquidityGaugeProps } from './SpeedometerLiquidityGauge';

export { PnLWaterfall } from './PnLWaterfall';
export type { PnLWaterfallProps, PnLWaterfallData } from './PnLWaterfall';

export { DuPontTreemap } from './DuPontTreemap';
export type { DuPontTreemapProps, DuPontSegment } from './DuPontTreemap';

export { CashInflectionArea } from './CashInflectionArea';
export type { CashInflectionAreaProps, CashInflectionPoint } from './CashInflectionArea';

export { RunwayProjection } from './RunwayProjection';
export type { RunwayProjectionProps, RunwayMonth } from './RunwayProjection';

// Helpers de formato re-exportados para conveniencia.
export {
  formatCop,
  formatBigCop,
  formatPct,
  formatMonths,
  formatDays,
} from '@/lib/charts/format';

export { useChartTheme } from '@/lib/charts/use-theme';
export type { ChartTheme } from '@/lib/charts/use-theme';

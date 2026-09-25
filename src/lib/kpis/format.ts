// ---------------------------------------------------------------------------
// Formato de los KPIs (ratios-kpis-27)
// ---------------------------------------------------------------------------
// Los motores de KPI (exit-value, roi-probabilistic, tax-efficiency) tenían
// su propio formateador con sufijo `B`/`T`/`K`, punto decimal y `$0 COP` /
// `0.0%` para un valor no finito. En español `$2.40B` se lee como dos
// billones (10^12) y `1.5` como mil quinientos; y un NaN publicado como cero
// es una cifra inventada. Aquí se delega en el formato es-CO único de
// `@/lib/charts/format` (coma decimal, escalas `mil` / `M` / `mil M`,
// negativos entre paréntesis) y un valor no finito es `N/D`.
// ---------------------------------------------------------------------------

import { formatBigCop, formatPct } from '@/lib/charts/format';

/** Texto de un KPI sin valor verificable. */
export const KPI_ND = 'N/D';

/** Monto en pesos, compacto es-CO (`$5,4 mil M`, `($1,5 M)`); no finito ⇒ N/D. */
export function formatKpiCop(pesos: number): string {
  return Number.isFinite(pesos) ? formatBigCop(pesos) : KPI_ND;
}

/** Porcentaje expresado en PUNTOS (20 = 20 %) con coma decimal; no finito ⇒ N/D. */
export function formatKpiPercentPoints(points: number, digits = 1): string {
  return Number.isFinite(points) ? formatPct(points / 100, digits) : KPI_ND;
}

/** Tasa expresada como DECIMAL (0.35 = 35 %) con coma decimal; no finita ⇒ N/D. */
export function formatKpiRate(decimal: number, digits = 1): string {
  return Number.isFinite(decimal) ? formatPct(decimal, digits) : KPI_ND;
}

/** Número con coma decimal y `digits` decimales fijos (`7,00`); no finito ⇒ N/D. */
export function formatKpiNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return KPI_ND;
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Múltiplo (`7,00×`); no finito ⇒ N/D. */
export function formatKpiMultiple(n: number, digits = 2): string {
  return Number.isFinite(n) ? `${formatKpiNumber(n, digits)}×` : KPI_ND;
}

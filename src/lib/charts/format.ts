// ---------------------------------------------------------------------------
// Format helpers for chart axis labels, tooltips, and KPI values.
// ---------------------------------------------------------------------------
// Convención del proyecto: los KPIs llegan en PESOS (números planos), no en
// centavos. La capa DB usa BigInt centavos pero el preprocesador y los
// pilares devuelven pesos. Si en el futuro un widget necesita centavos,
// añade `formatCopFromCentavos`.
// ---------------------------------------------------------------------------

const COP_LOCALE = 'es-CO';

/**
 * `$1.234.567` (sin decimales, signo negativo conservado).
 * Apto para tooltips y labels donde la precisión céntima distrae.
 */
export function formatCop(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString(COP_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * `$2.4B` / `$345M` / `$12K` — para etiquetas de eje compactas.
 */
export function formatBigCop(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * `15.6%` — formato de porcentaje. Acepta el valor como decimal (0.156).
 */
export function formatPct(decimal: number | null | undefined, digits = 1): string {
  if (decimal === null || decimal === undefined || !Number.isFinite(decimal)) return '—';
  return `${(decimal * 100).toFixed(digits)}%`;
}

/**
 * `12 meses` / `8 m` según `style`.
 */
export function formatMonths(n: number | null | undefined, style: 'long' | 'short' = 'long'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  if (style === 'short') return `${rounded} m`;
  return `${rounded} ${rounded === 1 ? 'mes' : 'meses'}`;
}

/**
 * `45 días` — lo mismo para días.
 */
export function formatDays(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  return `${rounded} ${rounded === 1 ? 'día' : 'días'}`;
}

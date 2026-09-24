// ---------------------------------------------------------------------------
// Periodo del informe desde el balance preprocesado (pipeline-flujo-17 d)
// ---------------------------------------------------------------------------
// Módulo puro (sin `node:*`): lo usan la UI, al componer la metadata del HTML,
// y /api/financial-report/html, al recomponerla desde la versión persistida.
// ---------------------------------------------------------------------------

const MONTH_TOKENS: Array<[RegExp, number]> = [
  [/^(ene|enero|jan|january)$/, 1],
  [/^(feb|febrero|february)$/, 2],
  [/^(mar|marzo|march)$/, 3],
  [/^(abr|abril|apr|april)$/, 4],
  [/^(may|mayo)$/, 5],
  [/^(jun|junio|june)$/, 6],
  [/^(jul|julio|july)$/, 7],
  [/^(ago|agosto|aug|august)$/, 8],
  [/^(sep|sept|septiembre|setiembre|september)$/, 9],
  [/^(oct|octubre|october)$/, 10],
  [/^(nov|noviembre|november)$/, 11],
  [/^(dic|diciembre|dec|december)$/, 12],
];

function lastMonthInLabel(label: string): number | null {
  const numeric = /\b(\d{4})[-_/](\d{1,2})\b/.exec(label);
  if (numeric) {
    const m = Number(numeric[2]);
    if (m >= 1 && m <= 12) return m;
  }
  let found: number | null = null;
  for (const word of label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/)) {
    for (const [rx, month] of MONTH_TOKENS) {
      if (rx.test(word)) found = month;
    }
  }
  return found;
}

/**
 * Periodo del HTML (pipeline-flujo-17 d): año, inicio y cierre desde el
 * periodo del balance preprocesado, no `AAAA-01-01 / AAAA-12-31` fijos. Un
 * corte parcial (`2025-06`, `Ene-Jun 2025`) cierra el último día de su mes; un
 * rótulo con sólo el año se toma como ejercicio completo (mismo supuesto que el
 * resto del pipeline). Sin preprocesado se usa el año de respaldo.
 */
export function derivePeriodBounds(
  preprocessed: unknown,
  fallbackYear: string | null | undefined,
): { periodYear: string; periodStart: string; periodEnd: string } {
  const primary =
    preprocessed && typeof preprocessed === 'object'
      ? ((preprocessed as Record<string, unknown>).primary as Record<string, unknown> | undefined)
      : undefined;
  const label = typeof primary?.period === 'string' ? primary.period : '';
  const yearOf = (s: string | null | undefined) => /(?:^|\D)(\d{4})(?:\D|$)/.exec(s ?? '')?.[1] ?? null;
  const year = yearOf(label) ?? yearOf(fallbackYear) ?? '';
  const month = label && yearOf(label) ? lastMonthInLabel(label) ?? 12 : 12;
  const lastDay = year ? new Date(Date.UTC(Number(year), month, 0)).getUTCDate() : 31;
  const mm = String(month).padStart(2, '0');
  return {
    periodYear: year,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

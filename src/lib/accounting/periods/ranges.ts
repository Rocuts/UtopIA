// ---------------------------------------------------------------------------
// Rangos de períodos contables — solapamiento y período destino de una fecha
// ---------------------------------------------------------------------------
// contab-nomina-26 (auditoría 2026-09-24):
//   - El período 13 ("ajustes de cierre") tiene startsAt = endsAt = 31-dic
//     23:59:59.999, instante que también contiene diciembre. Buscar "el"
//     período que contiene una fecha sin orden (reverseEntry) podía caer en
//     cualquiera de los dos.
//   - createPeriod aceptaba startsAt/endsAt explícitos sin comprobar que no se
//     solaparan con otros períodos del workspace.
//
// Reglas:
//   - Los meses 1–12 no pueden solaparse entre sí.
//   - El período 13 vive en el instante canónico de fin de año; no admite
//     rangos explícitos distintos y su solapamiento con diciembre es por diseño.
//   - Para ubicar una fecha se prefiere un mes 1–12 sobre el 13 (el 13 sólo se
//     usa cuando se pide explícitamente), y entre meses el de inicio más
//     reciente; el orden es total, así que la elección es determinista.
// ---------------------------------------------------------------------------

export const YEAR_END_ADJUSTMENTS_MONTH = 13;

export interface PeriodRange {
  id?: string;
  year: number;
  month: number;
  startsAt: Date;
  endsAt: Date;
}

/** Instante canónico del período 13 del año (31-dic 23:59:59.999 UTC). */
export function yearEndAdjustmentsInstant(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
}

/** ¿El rango explícito del período 13 es el canónico? */
export function isCanonicalYearEndRange(year: number, startsAt: Date, endsAt: Date): boolean {
  const t = yearEndAdjustmentsInstant(year).getTime();
  return startsAt.getTime() === t && endsAt.getTime() === t;
}

/**
 * Límites del mes declarado (UTC, como `computePeriodBoundaries` de la API):
 * del día 1 a las 00:00:00.000 al último día a las 23:59:59.999. El período
 * 13 vive en el instante canónico de fin de año.
 */
export function declaredPeriodBounds(year: number, month: number): { startsAt: Date; endsAt: Date } {
  if (month === YEAR_END_ADJUSTMENTS_MONTH) {
    const t = yearEndAdjustmentsInstant(year);
    return { startsAt: t, endsAt: t };
  }
  return {
    startsAt: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    endsAt: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

/**
 * ¿El rango cae dentro del (año, mes) declarado? Re-auditoría 2026-09-24
 * (ICU-05): un período «2026-03» con fechas de enero de 2027 se aceptaba;
 * después el enero real de 2027 chocaba con él (409) y sus asientos se
 * contabilizaban en el cierre de 2026. Un subrango del mes es válido; el
 * período 13 sólo admite su instante canónico.
 */
export function isRangeWithinDeclaredPeriod(year: number, month: number, startsAt: Date, endsAt: Date): boolean {
  if (month === YEAR_END_ADJUSTMENTS_MONTH) return isCanonicalYearEndRange(year, startsAt, endsAt);
  const b = declaredPeriodBounds(year, month);
  return (
    startsAt.getTime() >= b.startsAt.getTime() &&
    endsAt.getTime() <= b.endsAt.getTime() &&
    startsAt.getTime() <= endsAt.getTime()
  );
}

/**
 * Primer período de meses 1–12 cuyo rango se solapa con el candidato, o
 * `null`. El mismo (año, mes) no cuenta: lo rechaza el índice único.
 */
export function findOverlappingPeriod<T extends PeriodRange>(
  candidate: PeriodRange,
  existing: readonly T[],
): T | null {
  if (candidate.month === YEAR_END_ADJUSTMENTS_MONTH) return null;
  const a0 = candidate.startsAt.getTime();
  const a1 = candidate.endsAt.getTime();
  for (const e of existing) {
    if (e.month === YEAR_END_ADJUSTMENTS_MONTH) continue;
    if (e.year === candidate.year && e.month === candidate.month) continue;
    if (a0 <= e.endsAt.getTime() && e.startsAt.getTime() <= a1) return e;
  }
  return null;
}

/**
 * Período que contiene `date`, elegido de forma determinista: meses 1–12
 * antes que el 13, luego el de inicio más reciente, luego (año, mes, id).
 */
export function pickPeriodForDate<T extends PeriodRange>(
  periods: readonly T[],
  date: Date,
): T | null {
  const t = date.getTime();
  const containing = periods.filter(
    (p) => p.startsAt.getTime() <= t && t <= p.endsAt.getTime(),
  );
  containing.sort((x, y) => {
    const x13 = x.month === YEAR_END_ADJUSTMENTS_MONTH ? 1 : 0;
    const y13 = y.month === YEAR_END_ADJUSTMENTS_MONTH ? 1 : 0;
    if (x13 !== y13) return x13 - y13;
    const byStart = y.startsAt.getTime() - x.startsAt.getTime();
    if (byStart !== 0) return byStart;
    if (x.year !== y.year) return y.year - x.year;
    if (x.month !== y.month) return y.month - x.month;
    return String(x.id ?? '').localeCompare(String(y.id ?? ''));
  });
  return containing[0] ?? null;
}

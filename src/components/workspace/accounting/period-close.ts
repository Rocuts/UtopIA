/**
 * Cierre de períodos contables — decisiones puras de la UI.
 *
 * Auditoría 2026-09 (contab-nomina-04): los cierres mensuales (períodos 1-12)
 * ya no generan asiento de cierre; el traslado del resultado del ejercicio a
 * patrimonio (360505 / 361005) lo hace el workflow de cierre sobre el período
 * 13 («ajustes de cierre», 31-dic). La UI debe:
 *   - permitir crear el período 13 (la API ya admite month = 13),
 *   - ofrecer el cierre anual como corrida del workflow
 *     (POST /api/accounting/close/start) mientras el período 13 está abierto,
 *   - y no prometer «asientos de cierre» en el cierre mensual, que sólo marca
 *     el período como cerrado (POST /api/accounting/periods/close).
 */

export const ANNUAL_CLOSE_MONTH = 13;

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  'Cierre anual',
];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Year-end close',
];

/** Rótulo del período (1-12 = mes; 13 = cierre anual). */
export function periodMonthLabel(month: number, lang: 'es' | 'en'): string {
  const idx = Math.max(1, Math.min(ANNUAL_CLOSE_MONTH, month)) - 1;
  return (lang === 'es' ? MONTHS_ES : MONTHS_EN)[idx];
}

/** Opciones del selector de mes al abrir un período, incluido el 13. */
export function periodMonthOptions(lang: 'es' | 'en'): Array<{ value: number; label: string }> {
  return Array.from({ length: ANNUAL_CLOSE_MONTH }, (_, i) => {
    const value = i + 1;
    const label = periodMonthLabel(value, lang);
    const suffix = value === ANNUAL_CLOSE_MONTH ? (lang === 'es' ? ' — 31 dic' : ' — Dec 31') : '';
    return { value, label: `${label} (${value})${suffix}` };
  });
}

export function isAnnualClosePeriod(period: { month: number }): boolean {
  return period.month === ANNUAL_CLOSE_MONTH;
}

export interface CloseRequest {
  kind: 'annual_workflow' | 'monthly';
  url: string;
  body: { periodId: string };
}

/** Qué endpoint cierra el período: workflow anual (13) o cierre mensual. */
export function closeRequestFor(period: { id: string; month: number }): CloseRequest {
  if (isAnnualClosePeriod(period)) {
    return {
      kind: 'annual_workflow',
      url: '/api/accounting/close/start',
      body: { periodId: period.id },
    };
  }
  return {
    kind: 'monthly',
    url: '/api/accounting/periods/close',
    body: { periodId: period.id },
  };
}

/**
 * Balanza SIMPLE vs Ordinario (Mis Pagos) — decisiones puras de la vista.
 *
 * Auditoría 2026-09 (tributario-calc-11): la tarjeta «Régimen Ordinario»
 * mostraba una cifra calculada con un margen del 35 % supuesto y sin ICA; la
 * cifra no es del cliente. Sin margen ni tarifa de ICA del usuario se muestra
 * N/D con el motivo, y la tarifa de renta aplicada se rotula (Art. 241 PN /
 * Art. 240 PJ). Los datos los escribe el usuario.
 */

/** "15" / "15,5" → 0.155. Vacío o fuera de (0, 100) → undefined (dato faltante). */
export function parseMarginInput(raw: string): number | undefined {
  const n = Number(raw.trim().replace(',', '.'));
  if (raw.trim() === '' || !Number.isFinite(n) || n <= 0 || n >= 100) return undefined;
  return n / 100;
}

/**
 * Tarifa de ICA en por mil ("9,66" → 0.00966). Vacío o fuera de (0, 30] →
 * undefined. El techo es sólo un control de digitación: la tarifa la fija
 * cada concejo (Ley 14 de 1983, arts. 32-33).
 */
export function parseIcaPorMilInput(raw: string): number | undefined {
  const n = Number(raw.trim().replace(',', '.'));
  if (raw.trim() === '' || !Number.isFinite(n) || n <= 0 || n > 30) return undefined;
  return n / 1000;
}

export interface FaltantesLabels {
  faltaMargen: string;
  faltaIca: string;
  faltaY: string;
}

/** Datos del usuario que faltan para la cifra ordinaria (mismo criterio que compare()). */
export function faltantesOrdinario(
  opts: { margin?: number; icaRate?: number },
  labels: FaltantesLabels,
): string | null {
  const faltan = [
    opts.margin == null ? labels.faltaMargen : null,
    opts.icaRate == null ? labels.faltaIca : null,
  ].filter((x): x is string => x !== null);
  return faltan.length === 0 ? null : faltan.join(labels.faltaY);
}

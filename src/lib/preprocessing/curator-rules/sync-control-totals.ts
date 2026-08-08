// ---------------------------------------------------------------------------
// Sincronización de las tres representaciones de ControlTotals
// ---------------------------------------------------------------------------
// `ControlTotals` lleva el mismo dato tres veces:
//   - `activo` / `pasivo` / `patrimonio`  → number (pesos, float)
//   - `cents.*`                           → bigint (centavos, exacto)
//   - `raw.*`                             → string canónica "-?\d+\.\d{2}"
//
// El consumidor de cada una es distinto, y ahí está el peligro:
//   - Los renderers y los pilares leen el `number`.
//   - El gate `auditReportEmittable` compara SIEMPRE en `cents` con tolerancia
//     `0n`, y el validador de anclas del período comparativo también.
//   - El bloque TOTALES VINCULANTES que ve el LLM se construye desde `raw`.
//
// Auditoría 2026-08: las reglas del curator que MUTAN el balance (R1, R5, R8)
// recalculaban sólo el `number`. R5 escribía `controlTotals.patrimonio` sin
// tocar nada más; R8 recalculaba activo/pasivo/patrimonio y dejaba `cents` y
// `raw` con los valores PRE-cierre; R1 sincronizaba `cents.activo` y
// `cents.pasivo` pero nunca `cents.patrimonio`. Resultado: el gate comparaba
// el reporte contra un patrimonio obsoleto y la ecuación A = P + K "fallaba"
// en centavos aunque cuadrara en pesos — o peor, pasaba cuando no debía.
//
// Regla: TODA regla que mute un total pasa por aquí. Una sola función, tres
// representaciones, siempre coherentes.
// ---------------------------------------------------------------------------

import type { ControlTotals, PUCClass, ValidatedAccount } from '../trial-balance';

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/**
 * Convierte pesos (float) a centavos exactos. `Math.round` corrige el drift de
 * punto flotante ANTES de pasar a BigInt — mismo contrato que `toCents` en
 * `trial-balance.ts`.
 */
export function pesosToCents(value: number): bigint {
  if (!Number.isFinite(value)) return ZERO;
  return BigInt(Math.round(value * 100));
}

/** Centavos exactos → string canónica `-?\d+\.\d{2}`. */
export function centsToCanonical(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const integer = abs / HUNDRED;
  const fraction = (abs % HUNDRED).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${integer.toString()}.${fraction}`;
}

/**
 * Suma los saldos de una clase en centavos EXACTOS: redondea cada cuenta al
 * centavo y acumula en BigInt. Es más preciso que redondear la suma en float,
 * porque el error de punto flotante no llega a acumularse.
 */
export function sumClassCents(cl: PUCClass | undefined): bigint {
  if (!cl) return ZERO;
  let acc = ZERO;
  for (const a of cl.accounts as ValidatedAccount[]) {
    acc += pesosToCents(a.balance);
  }
  return acc;
}

/**
 * Campos de ControlTotals que se derivan directamente de las clases del
 * balance y que las reglas del curator pueden mutar.
 */
export type SyncableTotalKey = 'activo' | 'pasivo' | 'patrimonio';

const CLASS_CODE_BY_KEY: Record<SyncableTotalKey, number> = {
  activo: 1,
  pasivo: 2,
  patrimonio: 3,
};

/**
 * Realinea `cents` y `raw` con el valor `number` vigente, recalculando desde
 * las cuentas cuando las clases están disponibles (camino exacto) y cayendo a
 * la conversión desde el float sólo si no lo están.
 *
 * @param totals   ControlTotals a sincronizar (se muta in situ).
 * @param classes  Clases del snapshot ya mutadas por la regla.
 * @param keys     Qué totales sincronizar. Por defecto los tres.
 */
export function syncControlTotals(
  totals: ControlTotals,
  classes: PUCClass[] | undefined,
  keys: readonly SyncableTotalKey[] = ['activo', 'pasivo', 'patrimonio'],
): void {
  for (const key of keys) {
    const cls = classes?.find((c) => c.code === CLASS_CODE_BY_KEY[key]);

    // Camino exacto: recomputar desde las cuentas. Camino de respaldo:
    // convertir el `number` que la regla ya dejó escrito. El respaldo importa
    // para R5, que ancla el patrimonio a una cifra del ECP que NO proviene de
    // sumar las cuentas del balance.
    const cents =
      cls && totals[key] === sumClassPesos(cls)
        ? sumClassCents(cls)
        : pesosToCents(totals[key]);

    if (totals.cents) totals.cents[key] = cents;
    if (totals.raw) totals.raw[key] = centsToCanonical(cents);
  }
}

function sumClassPesos(cl: PUCClass): number {
  let sum = 0;
  for (const a of cl.accounts as ValidatedAccount[]) sum += a.balance;
  return sum;
}

/**
 * Diferencia `activo − (pasivo + patrimonio)` en centavos exactos. Es la
 * ecuación patrimonial evaluada sobre la representación que el gate usa —
 * si esto no da `0n`, el reporte no es emitible por mucho que el float cuadre.
 */
export function equationGapCents(totals: ControlTotals): bigint {
  if (!totals.cents) {
    return pesosToCents(totals.activo) - pesosToCents(totals.pasivo) - pesosToCents(totals.patrimonio);
  }
  return totals.cents.activo - totals.cents.pasivo - totals.cents.patrimonio;
}

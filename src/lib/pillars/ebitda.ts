// ---------------------------------------------------------------------------
// EBITDA — definición ÚNICA y determinística para todas las superficies.
// ---------------------------------------------------------------------------
// Antes convivían cuatro fórmulas (auditoría ratios-kpis-05):
//   - tarjeta/PDF: utilidad neta + 5410 + 5415 + 5305 + 5160 + 5165
//     (el impuesto de renta vive en 5405 — grupo 54 —, así que nunca se sumaba
//     de vuelta; omitía 5260/5265 y arrastraba no operacionales).
//   - barras: utilidad neta + SALDO del pasivo 24 (incluye IVA/ICA).
//   - pillar-view: clase 4 − 5 − 6 (eso es resultado neto, no EBITDA).
//   - spec: EBIT + D&A.
//
// Definición adoptada (spec financial-pipeline v2.1 + decisión del
// coordinador de la auditoría sobre grupos 42/53):
//
//   Ingresos operacionales netos = |Σ 41 (sin 4175)| − |Σ 4175|
//   Utilidad operacional (EBIT)  = ingresos operacionales netos
//                                  − costos (clases 6 y 7)
//                                  − gastos operacionales (grupos 51 y 52)
//   D&A                          = 5160 + 5165 + 5260 + 5265   (gasto)
//                                  + 7360 + 7365                (costos
//                                    indirectos de producción)
//   EBITDA                       = EBIT + D&A
//
// Los grupos 42 (ingresos no operacionales), 53 (gastos no operacionales) y
// 54 (impuesto de renta) quedan DEBAJO de la utilidad operacional y no entran.
// La clase 7 se resta porque el P&L del preprocesador (utilidad neta) también
// la resta; su D&A (7360/7365) se suma de vuelta.
//
// Códigos PUC: Decreto 2650/1993 (referencia técnica de uso generalizado):
// 5160/5260 Depreciaciones, 5165/5265 Amortizaciones (gastos operacionales de
// administración / ventas); 7360 Depreciaciones y 7365 Amortizaciones dentro
// del grupo 73 Costos indirectos.
//
// Sin desglose del grupo 41 no hay forma de separar lo operacional de lo no
// operacional: EBITDA = null con motivo (nunca una aproximación silenciosa).
// Aritmética en BigInt centavos para no acumular error de punto flotante.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PUCClass } from '@/lib/preprocessing/trial-balance';

export const DA_EXPENSE_DEPRECIATION_PREFIXES = ['5160', '5260'] as const;
export const DA_EXPENSE_AMORTIZATION_PREFIXES = ['5165', '5265'] as const;
export const DA_COST_DEPRECIATION_PREFIXES = ['7360'] as const;
export const DA_COST_AMORTIZATION_PREFIXES = ['7365'] as const;

export interface EbitdaResult {
  /** EBITDA en COP. `null` cuando no hay base verificable (ver `reason`). */
  ebitda: number | null;
  /** Utilidad operacional (EBIT) en COP. `null` si falta el grupo 41. */
  utilidadOperacional: number | null;
  /** Ingresos operacionales netos de devoluciones (41 − 4175). */
  ingresosOperacionalesNetos: number | null;
  /** Costos del periodo (clases 6 + 7). */
  costos: number;
  /** Gastos operacionales (grupos 51 + 52). */
  gastosOperacionales: number;
  /** Depreciaciones del periodo (5160 + 5260 + 7360). */
  depreciaciones: number;
  /** Amortizaciones del periodo (5165 + 5265 + 7365). */
  amortizaciones: number;
  /** depreciaciones + amortizaciones. */
  depreciacionAmortizacion: number;
  /** true si se identificó al menos una cuenta de D&A con saldo. */
  daIdentificada: boolean;
  /** Motivo cuando `ebitda` es null; o advertencia cuando D&A = 0. */
  reason: string | null;
}

/** Cuentas virtuales que inyecta el Curator (no son saldos del cliente). */
export function isVirtualCuratorAccount(code: string): boolean {
  return (
    code.endsWith('VC') ||
    code.endsWith('ZZ') ||
    code.startsWith('2810ZZ-') ||
    code.startsWith('3710ZZ')
  );
}

function toCents(n: number): bigint {
  if (!Number.isFinite(n)) return BigInt(0);
  return BigInt(Math.round(n * 100));
}

function fromCents(c: bigint): number {
  return Number(c) / 100;
}

function absBig(v: bigint): bigint {
  return v < BigInt(0) ? -v : v;
}

function sumWhere(cl: PUCClass | undefined, pred: (code: string) => boolean): bigint {
  if (!cl) return BigInt(0);
  let acc = BigInt(0);
  for (const a of cl.accounts) {
    if (isVirtualCuratorAccount(a.code)) continue;
    if (!pred(a.code)) continue;
    acc += toCents(a.balance);
  }
  return acc;
}

function startsWithAny(code: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => code.startsWith(p));
}

/**
 * EBITDA canónico del snapshot. Función pura, no muta el snapshot.
 */
export function computeEbitda(snapshot: PeriodSnapshot): EbitdaResult {
  const classes = snapshot.classes ?? [];
  const c4 = classes.find((c) => c.code === 4);
  const c5 = classes.find((c) => c.code === 5);
  const c6 = classes.find((c) => c.code === 6);
  const c7 = classes.find((c) => c.code === 7);

  const hasGrupo41 = (c4?.accounts ?? []).some(
    (a) => a.code.startsWith('41') && !isVirtualCuratorAccount(a.code),
  );

  const costosC = sumWhere(c6, () => true) + sumWhere(c7, () => true);
  const gastosOpC = sumWhere(c5, (code) => code.startsWith('51') || code.startsWith('52'));

  const depC =
    sumWhere(c5, (code) => startsWithAny(code, DA_EXPENSE_DEPRECIATION_PREFIXES)) +
    sumWhere(c7, (code) => startsWithAny(code, DA_COST_DEPRECIATION_PREFIXES));
  const amorC =
    sumWhere(c5, (code) => startsWithAny(code, DA_EXPENSE_AMORTIZATION_PREFIXES)) +
    sumWhere(c7, (code) => startsWithAny(code, DA_COST_AMORTIZATION_PREFIXES));
  const daC = depC + amorC;
  const daIdentificada = depC !== BigInt(0) || amorC !== BigInt(0);

  const base = {
    costos: fromCents(costosC),
    gastosOperacionales: fromCents(gastosOpC),
    depreciaciones: fromCents(depC),
    amortizaciones: fromCents(amorC),
    depreciacionAmortizacion: fromCents(daC),
    daIdentificada,
  };

  if (!hasGrupo41) {
    return {
      ...base,
      ebitda: null,
      utilidadOperacional: null,
      ingresosOperacionalesNetos: null,
      reason:
        'Sin desglose del grupo 41 (ingresos operacionales): no es posible separar la ' +
        'utilidad operacional de los ingresos no operacionales (grupo 42).',
    };
  }

  // Misma regla que el preprocesador para 4175: magnitud del total FIRMADO de
  // las ordinarias menos magnitud del total firmado de las devoluciones.
  const ordinariasC = absBig(
    sumWhere(c4, (code) => code.startsWith('41') && !code.startsWith('4175')),
  );
  const devolucionesC = absBig(sumWhere(c4, (code) => code.startsWith('4175')));
  const ingresosOpNetosC = ordinariasC - devolucionesC;

  const ebitC = ingresosOpNetosC - costosC - gastosOpC;
  const ebitdaC = ebitC + daC;

  return {
    ...base,
    ebitda: fromCents(ebitdaC),
    utilidadOperacional: fromCents(ebitC),
    ingresosOperacionalesNetos: fromCents(ingresosOpNetosC),
    reason: daIdentificada
      ? null
      : 'Sin cuentas de depreciación/amortización (5160, 5165, 5260, 5265, 7360, 7365) ' +
        'con saldo: EBITDA = utilidad operacional.',
  };
}

/** Margen EBITDA sobre ingresos operacionales netos. null si no es calculable. */
export function computeEbitdaMargin(res: EbitdaResult): number | null {
  if (res.ebitda === null || res.ingresosOperacionalesNetos === null) return null;
  if (res.ingresosOperacionalesNetos <= 0) return null;
  return res.ebitda / res.ingresosOperacionalesNetos;
}

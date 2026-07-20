// Cálculo DETERMINISTA del descuento por donaciones (Art. 257 E.T.). PURO —
// los porcentajes salen del registro normativo (fuente única, sin literales
// hardcodeados). Split crédito/tope: el CRÉDITO (25% de la donación) es
// independiente del impuesto (se computa en la confirmación del hecho); el TOPE
// (25% del impuesto) se aplica en el reporte, donde existe el impuesto.

import type { NormativeRuleVersion } from './rules-registry';
import { pctFloorMoneyCop, minMoneyCop, subMoneyCop } from '@/lib/agents/financial/contracts/money';

/** Extrae y valida los porcentajes del rule resuelto. Fail-loud si faltan. */
export function art257Params(rule: NormativeRuleVersion): {
  tasaDescuentoPct: number;
  limitePctImpuesto: number;
} {
  const tasa = rule.params.tasaDescuentoPct;
  const tope = rule.params.limitePctImpuesto;
  if (typeof tasa !== 'number') {
    throw new Error('Regla 257: falta el param numérico "tasaDescuentoPct" (rules-registry.ts).');
  }
  if (typeof tope !== 'number') {
    throw new Error('Regla 257: falta el param numérico "limitePctImpuesto" (rules-registry.ts).');
  }
  return { tasaDescuentoPct: tasa, limitePctImpuesto: tope };
}

/** Crédito Art. 257 = tasa% del valor donado (floor). Independiente del impuesto. */
export function computeCredito257(montoCentavos: string, tasaDescuentoPct: number): string {
  return pctFloorMoneyCop(montoCentavos, tasaDescuentoPct);
}

/**
 * Aplica el tope (limitePct% del impuesto) al crédito y netea:
 * descuento = min(crédito, 25% × impuesto) ; impuestoNeto = impuesto − descuento.
 */
export function computeDescuentoAplicado257(args: {
  creditoCents: string;
  impuestoBaseCents: string;
  limitePctImpuesto: number;
}): { limiteCents: string; descuentoCents: string; impuestoNetoCents: string } {
  const limiteCents = pctFloorMoneyCop(args.impuestoBaseCents, args.limitePctImpuesto);
  const descuentoCents = minMoneyCop(args.creditoCents, limiteCents);
  const impuestoNetoCents = subMoneyCop(args.impuestoBaseCents, descuentoCents);
  return { limiteCents, descuentoCents, impuestoNetoCents };
}

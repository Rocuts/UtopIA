// ---------------------------------------------------------------------------
// Fiscal Anchor — Extractor
// ---------------------------------------------------------------------------
// Lee del PeriodSnapshot (preprocesado determinístico) las cifras crudas
// que alimentan F03/F05/F06/F07/F08:
//   - F03 base: Σ(Cta.1355) + Σ(Cta.1805) SIN 135517 ni 135518
//                                          → crédito imputable a RENTA.
//   - F05    : |Σ(Cta.2408)|               → IVA por pagar.
//   - F06    : |Σ(Cta.2365)|               → Retefuente por declarar.
//   - F07    : |Σ(Cta.2368)|               → ICA por pagar.
//   - F08    : |Σ(Grupo 24)|               → total pasivos fiscales.
//
// Todo el cálculo intermedio en BigInt centavos. Conversión a string ocurre
// fuera de este módulo (block-builder.ts). Si una cuenta no existe, su
// contribución es 0n — el calculador / alertas verán la ausencia y disparará
// la bandera correspondiente.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, ValidatedAccount } from '@/lib/preprocessing/trial-balance';
import type { FiscalRawBase } from './internal-types';

/**
 * Convierte un balance en pesos (number) a centavos (bigint) sin floating-point
 * drift. Equivalente al `toCents` privado del preprocesador.
 */
function pesosToCents(value: number): bigint {
  if (!Number.isFinite(value)) return BigInt(0);
  return BigInt(Math.round(value * 100));
}

/** Magnitud absoluta de un BigInt. */
function absBigInt(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}

/**
 * Devuelve TODAS las hojas (isLeaf === true) del snapshot, atravesando las
 * 7 clases PUC. Reconstruye el conjunto que el preprocesador llamó `leafRows`
 * durante `buildSnapshotForPeriod`.
 */
function collectLeafAccounts(snapshot: PeriodSnapshot): ValidatedAccount[] {
  const leaves: ValidatedAccount[] = [];
  for (const cls of snapshot.classes) {
    for (const acct of cls.accounts) {
      if (acct.isLeaf) leaves.push(acct);
    }
  }
  return leaves;
}

/**
 * Suma cents de todas las hojas cuyo `code` empieza por uno de los prefijos
 * provistos. Mantiene la operación en BigInt para evitar drift.
 *
 * `excludePrefixes` gana sobre `prefixes`: una hoja que caiga en ambos NO
 * se suma. Se usa para sacar del crédito de renta las subcuentas 135517 y
 * 135518, que están dentro del 1355 pero pertenecen a otros impuestos.
 */
function sumLeavesByPrefix(
  leaves: readonly ValidatedAccount[],
  prefixes: readonly string[],
  excludePrefixes: readonly string[] = [],
): bigint {
  let acc = BigInt(0);
  for (const leaf of leaves) {
    if (excludePrefixes.some((p) => leaf.code.startsWith(p))) continue;
    if (prefixes.some((p) => leaf.code.startsWith(p))) {
      acc += pesosToCents(leaf.balance);
    }
  }
  return acc;
}

/**
 * Subcuentas del PUC 1355 que NO son crédito del impuesto de renta.
 *
 * Por qué se excluyen (auditoría fiscal 2026-08, superficie 2):
 *   - 135517 «Impuesto a las ventas retenido» (ReteIVA). El Art. 484-1 E.T.
 *     ordena llevarlo «como menor valor del saldo a pagar o mayor valor del
 *     saldo a favor» EN LA DECLARACIÓN DE IVA del período en que se practicó.
 *     No es una retención a título de renta y por tanto el Art. 373 E.T. no
 *     lo deja imputar al impuesto de renta.
 *   - 135518 «Impuesto de industria y comercio retenido» / anticipo de ICA.
 *     El ICA es un tributo municipal: lo retenido se acredita en la
 *     declaración de ICA del municipio, jamás contra renta. Lo pagado por ICA
 *     es deducción del 100% en renta (Art. 115 E.T., tras Ley 2277/2022), que
 *     es una cosa distinta de un descuento o de una retención imputable.
 *
 * Sumarlas a F03 infla el crédito, reduce el «neto a pagar» F04 y lleva al
 * contribuyente a subdeclarar: sanción por inexactitud del 100% del mayor
 * impuesto (Art. 647 E.T.) y, si además se pide devolución, 20% adicional
 * sobre el monto improcedente (Art. 670 E.T.).
 */
const PREFIJOS_NO_CREDITO_RENTA = ['135517', '135518'] as const;

/**
 * Extrae las cifras fiscales crudas del balance preprocesado.
 *
 * Comportamiento ante ausencias:
 *   - Cuenta inexistente → contribución 0n (no excepción).
 *   - Cuenta con saldo crédito (negativo) en pasivos → se invierte signo via
 *     `absBigInt` para emitir magnitudes presentables.
 *   - Cta.1355 y Cta.1805 siguen su signo natural (débito = positivo);
 *     si por algún motivo viniera negativa el calculator decide cómo proyectar.
 *   - El ReteIVA (135517) y el ReteICA (135518) se extraen aparte: existen en
 *     el balance y hay que mostrarlos, pero no acreditan renta.
 */
export function extractFiscalBaseFromTrialBalance(
  snapshot: PeriodSnapshot,
): FiscalRawBase {
  const leaves = collectLeafAccounts(snapshot);

  // F03 sólo con lo imputable a renta (Art. 373 E.T.).
  const retencionesAFavorCents = sumLeavesByPrefix(
    leaves,
    ['1355', '1805'],
    PREFIJOS_NO_CREDITO_RENTA,
  );
  const reteIvaAFavorCents = sumLeavesByPrefix(leaves, ['135517']);
  const reteIcaAFavorCents = sumLeavesByPrefix(leaves, ['135518']);
  const ivaPorPagarCents = absBigInt(sumLeavesByPrefix(leaves, ['2408']));
  const reteFuentePorPagarCents = absBigInt(sumLeavesByPrefix(leaves, ['2365']));
  const icaPorPagarCents = absBigInt(sumLeavesByPrefix(leaves, ['2368']));
  const totalPasivosFiscalesCents = absBigInt(sumLeavesByPrefix(leaves, ['24']));

  return {
    retencionesAFavorCents,
    reteIvaAFavorCents,
    reteIcaAFavorCents,
    ivaPorPagarCents,
    reteFuentePorPagarCents,
    icaPorPagarCents,
    totalPasivosFiscalesCents,
  };
}

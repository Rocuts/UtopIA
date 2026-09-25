// ---------------------------------------------------------------------------
// Fiscal Anchor — Extractor
// ---------------------------------------------------------------------------
// Lee del PeriodSnapshot (preprocesado determinístico) las cifras crudas
// que alimentan F03/F05/F06/F07/F08:
//   - F03 base: lista blanca de crédito imputable a RENTA (135505, 135515,
//               135595/1805 sólo si el nombre lo indica) — ver credito-renta.ts.
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
import { componerActivosImpuestoSnapshot } from './credito-renta';

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
 */
function sumLeavesByPrefix(
  leaves: readonly ValidatedAccount[],
  prefixes: readonly string[],
): bigint {
  let acc = BigInt(0);
  for (const leaf of leaves) {
    if (prefixes.some((p) => leaf.code.startsWith(p))) {
      acc += pesosToCents(leaf.balance);
    }
  }
  return acc;
}

// Composición de F03 (auditoría 2026-08 superficie 2 + auditoría 2026-09,
// tributario-modulos-01): antes se sumaba todo 1355 y 1805 excluyendo sólo
// 135517/135518, con lo que 135510 (anticipo ICA), 135530 (impuestos
// descontables), 135520/135525 y 1805 «Bienes de arte y cultura» inflaban el
// crédito de renta, bajaban F04 y fabricaban un «saldo a favor». Ahora la
// composición es una lista blanca (credito-renta.ts); lo demás se informa aparte
// y nunca netea F02 (Arts. 373, 647 y 670 E.T.).

/**
 * Extrae las cifras fiscales crudas del balance preprocesado.
 *
 * Comportamiento ante ausencias:
 *   - Cuenta inexistente → contribución 0n (no excepción).
 *   - Cuenta con saldo crédito (negativo) en pasivos → se invierte signo via
 *     `absBigInt` para emitir magnitudes presentables.
 *   - Cta.1355 y Cta.1805 siguen su signo natural (débito = positivo);
 *     si por algún motivo viniera negativa el calculator decide cómo proyectar.
 *   - ReteIVA, ReteICA/anticipo de ICA y el resto de 1355/1805 que no es
 *     crédito de renta se extraen aparte: existen en el balance y hay que
 *     mostrarlos, pero no acreditan renta.
 */
export function extractFiscalBaseFromTrialBalance(
  snapshot: PeriodSnapshot,
): FiscalRawBase {
  const leaves = collectLeafAccounts(snapshot);

  // F03 sólo con lo imputable a renta (Art. 373 E.T.) — lista blanca.
  const composicion = componerActivosImpuestoSnapshot(snapshot);
  const retencionesAFavorCents = composicion.creditoRentaCents;
  const reteIvaAFavorCents = composicion.reteIvaCents;
  const reteIcaAFavorCents = composicion.reteIcaCents;
  const otrosActivosImpuestoNoRentaCents = composicion.otrosNoRentaCents;
  const ivaPorPagarCents = absBigInt(sumLeavesByPrefix(leaves, ['2408']));
  const reteFuentePorPagarCents = absBigInt(sumLeavesByPrefix(leaves, ['2365']));
  const icaPorPagarCents = absBigInt(sumLeavesByPrefix(leaves, ['2368']));
  const totalPasivosFiscalesCents = absBigInt(sumLeavesByPrefix(leaves, ['24']));

  return {
    retencionesAFavorCents,
    reteIvaAFavorCents,
    reteIcaAFavorCents,
    otrosActivosImpuestoNoRentaCents,
    ivaPorPagarCents,
    reteFuentePorPagarCents,
    icaPorPagarCents,
    totalPasivosFiscalesCents,
  };
}

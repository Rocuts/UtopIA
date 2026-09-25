// ---------------------------------------------------------------------------
// Fiscal Anchor — Clasificación de activos por impuestos (1355 / 1805)
// ---------------------------------------------------------------------------
// Fuente única de la composición de F03 («crédito imputable al impuesto de
// RENTA»). La usan el extractor del Âncora Fiscal y el cálculo alternativo del
// Bloque Âncora NIIF (`ancora/build-ancora.ts`) para que ambas superficies
// publiquen la misma cifra.
//
// La regla por hoja vive en UN solo módulo, compartido con el preprocesador
// (saldo a favor de renta) y el Doctor de Datos: `@/lib/accounting/renta-credit`
// (auditoría 2026-09, integración W3-B). Aquí sólo se compone en centavos.
//
//   · 135505 y 135515 → crédito de renta (Arts. 365, 373 y 807 E.T.), salvo
//     nombre de IVA / ICA / predial / timbre / GMF / contribuciones.
//   · 135595, 1805 (PUC oficial: «Bienes de arte y cultura») y la hoja 1355
//     sin subcuenta → crédito de renta sólo si el NOMBRE es de renta.
//   · 135517 (ReteIVA, Art. 484-1 E.T.) → aparte, contra IVA.
//   · 135518 (ReteICA) y 135510 (anticipo de ICA) → aparte, tributo municipal.
//   · 135520, 135525, 135530 y el resto de 1355 → no es crédito de renta.
//
// Todo lo que no es crédito de renta se informa aparte y NUNCA netea F02.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, ValidatedAccount } from '@/lib/preprocessing/trial-balance';
import {
  clasificarActivoImpuesto,
  nombresConAncestros,
  type ClaseActivoImpuesto,
} from '@/lib/accounting/renta-credit';

export { clasificarActivoImpuesto };
export type { ClaseActivoImpuesto };

export interface ComposicionActivosImpuesto {
  /** F03 — crédito imputable al impuesto de renta (centavos). */
  creditoRentaCents: bigint;
  /** ReteIVA (135517 o nombre de IVA) — se acredita en la declaración de IVA. */
  reteIvaCents: bigint;
  /** ReteICA / anticipo de ICA (135518, 135510 o nombre de ICA). */
  reteIcaCents: bigint;
  /** Resto de 1355/1805 que no es crédito de renta (p. ej. 135530, bienes de arte). */
  otrosNoRentaCents: bigint;
}

function pesosToCents(value: number): bigint {
  if (!Number.isFinite(value)) return BigInt(0);
  return BigInt(Math.round(value * 100));
}

/** Composición de 1355/1805 en centavos BigInt para una lista de cuentas. */
export function componerActivosImpuesto(
  accounts: readonly ValidatedAccount[],
): ComposicionActivosImpuesto {
  const porCodigo = new Map<string, string>();
  for (const a of accounts) porCodigo.set(a.code, a.name ?? '');
  const out: ComposicionActivosImpuesto = {
    creditoRentaCents: BigInt(0),
    reteIvaCents: BigInt(0),
    reteIcaCents: BigInt(0),
    otrosNoRentaCents: BigInt(0),
  };
  for (const acct of accounts) {
    if (!acct.isLeaf) continue;
    const clase = clasificarActivoImpuesto(
      acct.code,
      nombresConAncestros(acct.code, acct.name ?? '', (codigo) => porCodigo.get(codigo)),
    );
    if (clase === null) continue;
    const cents = pesosToCents(acct.balance);
    if (clase === 'credito_renta') out.creditoRentaCents += cents;
    else if (clase === 'rete_iva') out.reteIvaCents += cents;
    else if (clase === 'rete_ica') out.reteIcaCents += cents;
    else out.otrosNoRentaCents += cents;
  }
  return out;
}

/** Igual que `componerActivosImpuesto`, sobre todas las clases del snapshot. */
export function componerActivosImpuestoSnapshot(
  snapshot: PeriodSnapshot,
): ComposicionActivosImpuesto {
  const accounts: ValidatedAccount[] = [];
  for (const cls of snapshot.classes ?? []) {
    for (const acct of cls.accounts ?? []) accounts.push(acct);
  }
  return componerActivosImpuesto(accounts);
}

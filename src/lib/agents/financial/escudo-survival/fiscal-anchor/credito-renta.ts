// ---------------------------------------------------------------------------
// Fiscal Anchor — Clasificación de activos por impuestos (1355 / 1805)
// ---------------------------------------------------------------------------
// Fuente única de la composición de F03 («crédito imputable al impuesto de
// RENTA»). La usan el extractor del Âncora Fiscal y el cálculo alternativo del
// Bloque Âncora NIIF (`ancora/build-ancora.ts`) para que ambas superficies
// publiquen la misma cifra.
//
// Regla (lista blanca por código y nombre — decisión del coordinador de la
// auditoría 2026-09, hallazgo tributario-modulos-01):
//
//   · 135505 «Anticipo de impuestos de renta y complementarios» y
//     135515 «Retención en la fuente» → crédito de renta (Arts. 365, 373 y 807
//     E.T.), salvo que el nombre de la hoja declare otro tributo (IVA / ICA).
//   · 135595 «Otros» → crédito de renta sólo si el NOMBRE es de renta
//     (renta / retención en la fuente / autorretención).
//   · 135517 (ReteIVA, Art. 484-1 E.T.) → aparte, contra IVA.
//   · 135518 (ReteICA) y 135510 (anticipo de ICA) → aparte, tributo municipal.
//   · 135520 (sobrantes), 135525 (contribuciones), 135530 (impuestos
//     descontables) y cualquier otra subcuenta de 1355 → no es crédito de renta.
//   · 1805: en el PUC oficial (Decreto 2650/1993) es «Bienes de arte y
//     cultura». Sólo cuenta como crédito de renta si el nombre de la hoja o de
//     su cuenta padre dentro de 1805 indica un impuesto (impuesto / anticipo /
//     retención / saldo a favor / sobrante) y no es IVA ni ICA.
//
// Todo lo que no es crédito de renta se informa aparte y NUNCA netea F02.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, ValidatedAccount } from '@/lib/preprocessing/trial-balance';

export type ClaseActivoImpuesto =
  | 'credito_renta'
  | 'rete_iva'
  | 'rete_ica'
  | 'otro_no_renta';

const PATRON_IVA = /(\biva\b|i\.v\.a|impuestos? (a|sobre) las ventas|rete\s*iva|descontable)/i;
const PATRON_ICA = /(\bica\b|industria y comercio|rete\s*ica|avisos y tableros)/i;
const PATRON_RENTA = /(renta|retenci[oó]n en la fuente|rete\s*fuente|autorretenci[oó]n|auto\s*retenci[oó]n)/i;
const PATRON_IMPUESTO_1805 = /(impuesto|anticipo|retenci[oó]n|rete\s*fuente|saldo a favor|sobrante)/i;

function nombreDeclaraIvaOIca(nombres: readonly string[]): ClaseActivoImpuesto | null {
  if (nombres.some((n) => PATRON_IVA.test(n))) return 'rete_iva';
  if (nombres.some((n) => PATRON_ICA.test(n))) return 'rete_ica';
  return null;
}

/**
 * Clasifica una hoja de 1355/1805. Devuelve `null` si la cuenta no pertenece a
 * esos grupos (no es un activo por impuestos que F03 deba considerar).
 *
 * @param nombresContexto nombres de la propia hoja y de sus cuentas padre dentro
 *   del subgrupo que decide la regla (p. ej. 1805 → 180505 → 18050504).
 */
export function clasificarActivoImpuesto(
  code: string,
  nombresContexto: readonly string[],
): ClaseActivoImpuesto | null {
  if (code.startsWith('135517')) return 'rete_iva';
  if (code.startsWith('135518') || code.startsWith('135510')) return 'rete_ica';
  if (code.startsWith('135505') || code.startsWith('135515')) {
    return nombreDeclaraIvaOIca(nombresContexto) ?? 'credito_renta';
  }
  if (code.startsWith('135595')) {
    const otro = nombreDeclaraIvaOIca(nombresContexto);
    if (otro) return otro;
    return nombresContexto.some((n) => PATRON_RENTA.test(n)) ? 'credito_renta' : 'otro_no_renta';
  }
  if (code.startsWith('1355')) return 'otro_no_renta';
  if (code.startsWith('1805')) {
    const otro = nombreDeclaraIvaOIca(nombresContexto);
    if (otro) return otro;
    return nombresContexto.some((n) => PATRON_IMPUESTO_1805.test(n))
      ? 'credito_renta'
      : 'otro_no_renta';
  }
  return null;
}

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

/**
 * Nombres de la hoja y de sus padres presentes en el catálogo del cliente que
 * comparten el prefijo que decide la regla (1805 completo o 135595).
 */
function nombresContexto(leaf: ValidatedAccount, porCodigo: ReadonlyMap<string, string>): string[] {
  const raiz = leaf.code.startsWith('1805') ? '1805' : leaf.code.startsWith('135595') ? '135595' : null;
  const nombres = [leaf.name ?? ''];
  if (!raiz) return nombres;
  for (let len = raiz.length; len < leaf.code.length; len += 1) {
    const nombre = porCodigo.get(leaf.code.slice(0, len));
    if (nombre) nombres.push(nombre);
  }
  return nombres;
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
    const clase = clasificarActivoImpuesto(acct.code, nombresContexto(acct, porCodigo));
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

// ---------------------------------------------------------------------------
// Capa 4 — Módulo 2 — Tool: Conciliación Borrador Skeleton
// ---------------------------------------------------------------------------
//
// Genera el esqueleto determinístico de la conciliación fiscal (UAI contable
// → renta líquida gravable → impuesto bruto → descuentos → impuesto neto →
// retenciones → saldo final). El LLM rellena las líneas no triviales (gastos
// no deducibles particulares, rentas exentas aplicables) sobre este esqueleto.
//
// Cero LLM, cero red, cero filesystem.
// ---------------------------------------------------------------------------

import {
  parseMoneyCop,
  serializeMoneyCop,
} from '@/lib/agents/financial/contracts/money';
import { uvtToCopByYear } from '@/lib/accounting/tax-engine/constants';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

/**
 * Tarifa general PJ — Art. 240 E.T. 35%.
 * Sectores especiales (financiero +5pp = 40%, hidro +3pp = 38%, zona franca
 * 20%/35% híbrida) los maneja el LLM porque requieren contexto sectorial.
 */
const TARIFA_GENERAL_PCT = 35;

export interface ConciliacionSkeleton {
  uaiContable: string;
  /** Renta líquida gravable = UAI (el LLM ajusta con adiciones/deducciones). */
  rentaLiquidaGravableBase: string;
  tarifaPct: number;
  /** Impuesto bruto base = UAI × tarifa. */
  impuestoBrutoBase: string;
  /** F03 — retenciones y anticipos a favor. */
  retencionesYAnticipos: string;
  /** Saldo final SIN adiciones / deducciones / descuentos (skeleton). */
  saldoFinalBase: string;
  /** Disclaimer obligatorio. */
  disclaimer: string;
}

function pctOf(amountCents: bigint, pct: number): bigint {
  if (amountCents <= ZERO) return ZERO;
  const pctBig = BigInt(Math.round(pct * 100)); // 2 decimales de tarifa
  const numerator = amountCents * pctBig;
  const DIV = BigInt(10_000); // 100 (pct base) × 100 (decimales)
  const quotient = numerator / DIV;
  const remainder = numerator % DIV;
  return remainder * BigInt(2) >= DIV ? quotient + BigInt(1) : quotient;
}

/**
 * Construye el esqueleto numérico de la conciliación a partir del Âncora.
 * El LLM consume este esqueleto + datos del balance para emitir las líneas
 * de adiciones, deducciones, rentas exentas y descuentos contextuales.
 */
export function buildConciliacionSkeleton(
  anchor: FiscalAnchorBlock,
): ConciliacionSkeleton {
  const uaiCents = parseMoneyCop(anchor.f01);
  const f03Cents = parseMoneyCop(anchor.f03);
  const impuestoBrutoBase = pctOf(uaiCents, TARIFA_GENERAL_PCT);
  const saldoFinalBase = impuestoBrutoBase - f03Cents;

  return {
    uaiContable: serializeMoneyCop(uaiCents),
    rentaLiquidaGravableBase: serializeMoneyCop(uaiCents),
    tarifaPct: TARIFA_GENERAL_PCT,
    impuestoBrutoBase: serializeMoneyCop(impuestoBrutoBase),
    retencionesYAnticipos: serializeMoneyCop(f03Cents),
    saldoFinalBase: serializeMoneyCop(saldoFinalBase),
    disclaimer:
      'Esta conciliación es un BORRADOR generado a partir del balance preprocesado. Las adiciones, deducciones, rentas exentas y descuentos requieren revisión del contador público y/o revisor fiscal antes de su uso oficial. Las diferencias de criterio razonables están amparadas por el parágrafo del Art. 647 E.T.',
  };
}

// ---------------------------------------------------------------------------
// Recomputo determinista de la conciliación del LLM (auditoría 2026-09,
// tributario-modulos-04). El modelo propone las LÍNEAS (adiciones,
// deducciones, rentas exentas, INCRGNO, descuentos); las identidades se
// calculan aquí en BigInt y sobrescriben las cifras del modelo:
//   uaiContable            = F01 (Âncora)
//   rentaLiquidaGravable   = UAI + Σ|adiciones| − Σ|deducciones, rentas exentas, INCRGNO|
//   impuestoBruto          = max(renta, 0) × tarifa (sobretasa sólo si supera el umbral del Art. 240)
//   totalDescuentos        = 254 + 258-1 (sin tope conjunto) + min(255/256/257, 25% bruto)  (Art. 258)
//   impuestoNeto           = max(bruto − descuentos, 0)
//   retencionesYAnticipos  = F03 (Âncora)
//   saldoFinal             = impuestoNeto − F03   (sin anticipo Art. 807 — borrador)
// ---------------------------------------------------------------------------

export interface ConciliacionLineaInput {
  monto: string;
  norma: string;
  tipo: 'adicion' | 'deduccion' | 'renta_exenta' | 'incrgno' | 'descuento' | 'retencion' | 'anticipo';
}

export interface ConciliacionRecomputed {
  /** Tarifa aplicada tras verificar el umbral de la sobretasa (Art. 240). */
  tarifaPct: number;
  /** Motivo cuando la tarifa del modelo se reemplazó o no pudo verificarse. */
  avisoTarifa: string | null;
  uaiContable: string;
  rentaLiquidaGravable: string;
  impuestoBruto: string;
  totalDescuentos: string;
  impuestoNeto: string;
  retencionesYAnticipos: string;
  saldoFinal: string;
  /** Descuentos 255/256/257 que excedieron el tope conjunto del Art. 258. */
  excesoTope258: string;
}

// ---------------------------------------------------------------------------
// Sobretasas del Art. 240 E.T. con umbral de renta gravable
// (src/data/tax_docs/et_articulo_240_renta_juridica.md — tributario-modulos-21).
// El sector lo declara el modelo (el código no puede verificarlo); el umbral y
// la vigencia sí se verifican aquí. Debajo del umbral rige la tarifa general.
// ---------------------------------------------------------------------------

export const SOBRETASAS_ART_240 = [
  {
    tarifaPct: 40,
    umbralUvt: 120_000,
    desde: 2023,
    hasta: 2027,
    norma: 'Art. 240 par. 2 E.T. (sector financiero, asegurador y bursátil)',
  },
  {
    tarifaPct: 38,
    umbralUvt: 30_000,
    desde: 2023,
    hasta: 2026,
    norma: 'Art. 240 par. 4 E.T. (generación de energía hidroeléctrica)',
  },
] as const;

function fmtUvt(n: number): string {
  return new Intl.NumberFormat('es-CO').format(n);
}

/**
 * Verifica el umbral y la vigencia de una tarifa con sobretasa. Devuelve la
 * tarifa aplicable (la general del 35% si la renta gravable no alcanza el
 * umbral o el año está fuera de la vigencia) y el motivo del cambio. Sin año
 * gravable identificable o sin UVT registrada, el umbral no es verificable: se
 * conserva la tarifa declarada y se avisa.
 */
export function verificarSobretasaArt240(
  tarifaPct: number,
  rentaGravableCents: bigint,
  periodo: string,
): { tarifaPct: number; aviso: string | null } {
  const s = SOBRETASAS_ART_240.find((x) => x.tarifaPct === tarifaPct);
  if (!s) return { tarifaPct, aviso: null };
  const m = /(19|20)\d{2}/.exec(periodo ?? '');
  const year = m ? Number(m[0]) : null;
  if (year !== null && (year < s.desde || year > s.hasta)) {
    return {
      tarifaPct: TARIFA_GENERAL_PCT,
      aviso: `La sobretasa del ${s.norma} rige sólo para los años gravables ${s.desde}-${s.hasta}; para ${year} se aplica la tarifa general del ${TARIFA_GENERAL_PCT}%.`,
    };
  }
  let umbralCents: bigint | null = null;
  if (year !== null) {
    try {
      umbralCents = BigInt(uvtToCopByYear(s.umbralUvt, year)) * CIEN;
    } catch {
      umbralCents = null;
    }
  }
  if (year === null || umbralCents === null) {
    return {
      tarifaPct,
      aviso: `Tarifa ${tarifaPct}% (${s.norma}): umbral de ${fmtUvt(s.umbralUvt)} UVT no verificable sin el año gravable y su UVT; confirme la renta gravable antes de usarla.`,
    };
  }
  if (rentaGravableCents < umbralCents) {
    return {
      tarifaPct: TARIFA_GENERAL_PCT,
      aviso: `La sobretasa del ${s.norma} exige renta gravable ≥ ${fmtUvt(s.umbralUvt)} UVT del año ${year}; la renta recalculada no la alcanza y se aplica la tarifa general del ${TARIFA_GENERAL_PCT}% en lugar del ${tarifaPct}%.`,
    };
  }
  return { tarifaPct, aviso: null };
}

function absBig(v: bigint): bigint {
  return v < ZERO ? -v : v;
}

function parseMontoSeguro(m: string): bigint {
  return /^-?\d+$/.test(m) ? BigInt(m) : ZERO;
}

export function recomputeConciliacion(
  anchor: FiscalAnchorBlock,
  lineas: readonly ConciliacionLineaInput[],
  tarifaPct: number,
): ConciliacionRecomputed {
  const uai = parseMoneyCop(anchor.f01);
  const f03 = parseMoneyCop(anchor.f03);
  let adiciones = ZERO;
  let restas = ZERO;
  let descSinTope = ZERO; // 254 y 258-1
  let descConTope = ZERO; // 255, 256, 257 (Art. 258)
  for (const l of lineas) {
    const m = absBig(parseMontoSeguro(l.monto));
    if (l.tipo === 'adicion') adiciones += m;
    else if (l.tipo === 'deduccion' || l.tipo === 'renta_exenta' || l.tipo === 'incrgno') restas += m;
    else if (l.tipo === 'descuento') {
      if (/258-1|\b254\b/.test(l.norma)) descSinTope += m;
      else descConTope += m;
    }
  }
  const renta = uai + adiciones - restas;
  const tarifa = verificarSobretasaArt240(tarifaPct, renta, anchor.fuente?.periodo ?? '');
  const bruto = pctOf(renta > ZERO ? renta : ZERO, tarifa.tarifaPct);
  const tope258 = pctOf(bruto, 25);
  const descConTopeAplicado = descConTope > tope258 ? tope258 : descConTope;
  const descuentos = descSinTope + descConTopeAplicado;
  const neto = bruto - descuentos > ZERO ? bruto - descuentos : ZERO;
  return {
    tarifaPct: tarifa.tarifaPct,
    avisoTarifa: tarifa.aviso,
    uaiContable: serializeMoneyCop(uai),
    rentaLiquidaGravable: serializeMoneyCop(renta),
    impuestoBruto: serializeMoneyCop(bruto),
    totalDescuentos: serializeMoneyCop(descuentos),
    impuestoNeto: serializeMoneyCop(neto),
    retencionesYAnticipos: serializeMoneyCop(f03),
    saldoFinal: serializeMoneyCop(neto - f03),
    excesoTope258: serializeMoneyCop(descConTope - descConTopeAplicado),
  };
}

// Wrapper interno para que el centavo absoluto vea la luz cuando se requiera.
export function _internals_pctOf(cents: bigint, pct: number): bigint {
  return pctOf(cents, pct);
}

export const TARIFA_GENERAL_PCT_VAL = TARIFA_GENERAL_PCT;
export { CIEN as _CIEN_DEBUG };

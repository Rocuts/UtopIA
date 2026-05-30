// ---------------------------------------------------------------------------
// deriveAncoraView — derivador puro determinístico (TS, sin LLM, nunca lanza).
// ---------------------------------------------------------------------------
// Centavos (MoneyCop) → COP pesos. Honestidad (Elite Protocol): input faltante o
// ≤0 cuando dividiría ⇒ `null`, NUNCA 0 ni cifra inventada.
//
// Fórmulas defendibles (dictamen `escudo-tributario-co` + KB tributaria CO 2026):
//  - EV/EBIT operacional: múltiplo de mercado 6.0× (PYME servicios CO 2026, rango
//    sectorial 4–8×). Heurístico de mercado, NO norma. El Âncora expone EBIT (A09),
//    no EBITDA — se rotula EV/EBIT en la UI.
//  - DCF / Gordon: requieren WACC ⇒ null (faltaWacc:true) hasta que el DF lo capture.
//  - Liquidación ≈ patrimonio neto contable (A05).
//  - Altman Z: la variante original (1968) y Z'' (servicios) exigen el término
//    X2 = Utilidades Retenidas / Activo Total, no expuesto en el Âncora. Imputarlo
//    sería inventar ⇒ altmanZ = null con `altmanRazon`.
//  - capitalizacion36_3 = utilidadNeta × 0.40. Art. 36-3 E.T. (capitalización de
//    utilidades = INCRNGO). El 40% es heurístico estratégico (porción típicamente
//    capitalizable tras la reserva legal 10% Art. 452 C.Co.), NO porcentaje legal.
//  - scoreNiif: rúbrica determinística sobre `ancora.checks` (ecuación patrimonial
//    actual 40 + comparativa 20 + EFE concilia 20 + sin A5 10 + sin DEV 10 = 100).
// ---------------------------------------------------------------------------

import type { NiifAncora } from '@/lib/agents/financial/ancora/types';
import type { FiscalSnapshot } from '@/lib/agents/financial/types';
import { parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { AncoraView } from './ancora-view';

/** Múltiplo EV/EBIT operacional — PYME servicios CO 2026 (rango 4–8×). */
const EV_EBIT_MULTIPLE = 6.0;
/** Fracción de utilidad neta capitalizable — heurístico Art. 36-3 E.T. */
const CAPITALIZACION_36_3_FRACCION = 0.4;

/** MoneyCop centavos string → COP pesos. null si el string no es válido. */
function centsToPesos(cents: string | undefined | null): number | null {
  if (cents == null) return null;
  try {
    return Number(parseMoneyCop(cents)) / 100;
  } catch {
    return null;
  }
}

/** Porcentaje (number o "35.00") → number. null si no parseable. */
function pctToNumber(v: string | number | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyView(company?: { name?: string | null; nit?: string | null }): AncoraView {
  return {
    hasData: false,
    meta: {
      empresa: company?.name ?? null,
      nit: company?.nit ?? null,
      nitDigito: '0',
      periodoActual: '',
      periodoComparativo: null,
    },
    niif: {
      activos: null, activosPrev: null, pasivos: null, pasivosPrev: null,
      patrimonio: null, patrimonioPrev: null, ingresos: null, ingresosPrev: null,
      ebitOperacional: null, ebitOperacionalPrev: null, utilidadNeta: null,
      utilidadNetaPrev: null, efectivo: null, efectivoPrev: null,
      pasivoCorriente: null, inventarios: null, cartera: null, proveedores: null,
      variacionCaja: null, gananciaBruta: null, activoCorriente: null,
      activoNoCorriente: null,
    },
    fiscal: {
      f01: null, f02: null, f03: null, f04: null, f05: null, f06: null,
      f07: null, f08: null, f09: null, f10: null,
      scoreRiesgoDIAN: null, nivelRiesgo: null,
    },
    derived: {
      crecimientoIngresosPct: null, margenNetoPct: null, margenOperacionalPct: null,
      deRatio: null,
      valoracion: {
        evEbit: null, liquidacion: null, dcf: null, gordon: null,
        transacciones: null, ponderado: null, faltaWacc: true,
      },
      scoreNiif: null,
      altmanZ: null,
      altmanRazon: null,
      oportunidades: {
        capitalizacion36_3: null, liberacionCartera: null, expansionIngresos: null,
      },
    },
  };
}

/**
 * Convierte el `NiifAncora` (+ `FiscalSnapshot` opcional) en el view-model
 * `AncoraView` que consumen las 4 áreas. Determinístico, nunca lanza.
 * Devuelve `hasData:false` + nulls cuando no hay Âncora.
 */
export function deriveAncoraView(
  ancora: NiifAncora | null | undefined,
  fiscalSnapshot: FiscalSnapshot | null | undefined,
  company?: { name?: string | null; nit?: string | null },
): AncoraView {
  if (!ancora) return emptyView(company);

  const c = ancora.ccvNiif;
  const f = ancora.ccvFiscal;

  // ── NIIF (centavos → pesos) ────────────────────────────────────────────────
  const activos = centsToPesos(c.A01);
  const activosPrev = centsToPesos(c.A02);
  const pasivos = centsToPesos(c.A03);
  const pasivosPrev = centsToPesos(c.A04);
  const patrimonio = centsToPesos(c.A05);
  const patrimonioPrev = centsToPesos(c.A06);
  const ingresos = centsToPesos(c.A07);
  const ingresosPrev = centsToPesos(c.A08);
  const ebitOperacional = centsToPesos(c.A09);
  const ebitOperacionalPrev = centsToPesos(c.A10);
  const utilidadNeta = centsToPesos(c.A11);
  const utilidadNetaPrev = centsToPesos(c.A12);
  const efectivo = centsToPesos(c.A13);
  const efectivoPrev = centsToPesos(c.A14);
  const pasivoCorriente = centsToPesos(c.A15);
  const inventarios = centsToPesos(c.A16);
  const cartera = centsToPesos(c.A17);
  const proveedores = centsToPesos(c.A18);
  const variacionCaja = centsToPesos(c.A19);
  const gananciaBruta = centsToPesos(c.X01);
  const activoCorriente = centsToPesos(c.X03);
  const activoNoCorriente = centsToPesos(c.X04);

  // ── Fiscal: preferir snapshot.anchor (canónico Escudo); fallback ccvFiscal ──
  const fa = fiscalSnapshot?.anchor;
  const fiscal = {
    f01: fa ? centsToPesos(fa.f01) : centsToPesos(f.F01),
    f02: fa ? centsToPesos(fa.f02) : centsToPesos(f.F02),
    f03: fa ? centsToPesos(fa.f03) : centsToPesos(f.F03),
    f04: fa ? centsToPesos(fa.f04) : centsToPesos(f.F04),
    f05: fa ? centsToPesos(fa.f05) : centsToPesos(f.F05),
    f06: fa ? centsToPesos(fa.f06) : centsToPesos(f.F06),
    f07: fa ? centsToPesos(fa.f07) : centsToPesos(f.F07),
    f08: fa ? centsToPesos(fa.f08) : centsToPesos(f.F08),
    f09: fa ? pctToNumber(fa.f09) : pctToNumber(f.F09),
    f10: fa ? pctToNumber(fa.f10) : pctToNumber(f.F10),
    scoreRiesgoDIAN: fiscalSnapshot?.riskScore?.score ?? null,
    nivelRiesgo: fiscalSnapshot?.riskScore?.nivel ?? null,
  };

  // ── Derivados honestos ──────────────────────────────────────────────────────
  const crecimientoIngresosPct =
    ingresosPrev != null && ingresosPrev > 0 && ingresos != null
      ? round2(((ingresos - ingresosPrev) / ingresosPrev) * 100)
      : null;

  const margenNetoPct =
    ingresos != null && ingresos > 0 && utilidadNeta != null
      ? round2((utilidadNeta / ingresos) * 100)
      : null;

  const margenOperacionalPct =
    ingresos != null && ingresos > 0 && ebitOperacional != null
      ? round2((ebitOperacional / ingresos) * 100)
      : null;

  const deRatio =
    patrimonio != null && patrimonio > 0 && pasivos != null
      ? round2(pasivos / patrimonio)
      : null;

  // Valoración — EBIT < 0 ⇒ múltiplo no aplica ⇒ null.
  const evEbit =
    ebitOperacional != null && ebitOperacional > 0
      ? round2(ebitOperacional * EV_EBIT_MULTIPLE)
      : null;
  const liquidacion = patrimonio;
  const dcf = null;
  const gordon = null;
  const transacciones = null;
  const disponibles = [evEbit, liquidacion].filter(
    (v): v is number => v != null,
  );
  const ponderado =
    disponibles.length > 0
      ? round2(disponibles.reduce((a, b) => a + b, 0) / disponibles.length)
      : null;

  // scoreNiif — rúbrica determinística sobre checks reales.
  const ck = ancora.checks;
  let scoreNiif = 0;
  if (ck.patrimonioDelta2025 === '0') scoreNiif += 40;
  if (ck.patrimonioDelta2024 === '0') scoreNiif += 20;
  if (ck.efeReconcilia === 'ok') scoreNiif += 20;
  if (ck.alertaA5 === 'inactiva') scoreNiif += 10;
  if (ck.alertaDev === 'inactiva') scoreNiif += 10;

  // Altman Z — no defendible sin Utilidades Retenidas (X2 = RE / Activo Total).
  const altmanZ = null;
  const altmanRazon =
    "Altman Z (1968 / Z''-servicios) requiere Utilidades Retenidas " +
    '(X2 = RE / Activo Total) no expuestas en el Âncora; imputarlas sería ' +
    'inventar. Pendiente capturar utilidades retenidas para activarlo.';

  // Oportunidades.
  const capitalizacion36_3 =
    utilidadNeta != null && utilidadNeta > 0
      ? round2(utilidadNeta * CAPITALIZACION_36_3_FRACCION)
      : null;
  const liberacionCartera = cartera;
  const expansionIngresos =
    crecimientoIngresosPct != null && crecimientoIngresosPct > 0 && ingresos != null
      ? round2(ingresos * (1 + crecimientoIngresosPct / 100))
      : null;

  return {
    hasData: true,
    meta: {
      empresa: company?.name ?? null,
      nit: company?.nit ?? null,
      nitDigito: ancora.nitDigito,
      periodoActual: ancora.periodos.actual,
      periodoComparativo: ancora.periodos.comparativo,
    },
    niif: {
      activos, activosPrev, pasivos, pasivosPrev, patrimonio, patrimonioPrev,
      ingresos, ingresosPrev, ebitOperacional, ebitOperacionalPrev,
      utilidadNeta, utilidadNetaPrev, efectivo, efectivoPrev,
      pasivoCorriente, inventarios, cartera, proveedores,
      variacionCaja, gananciaBruta, activoCorriente, activoNoCorriente,
    },
    fiscal,
    derived: {
      crecimientoIngresosPct, margenNetoPct, margenOperacionalPct, deRatio,
      valoracion: {
        evEbit, liquidacion, dcf, gordon, transacciones, ponderado,
        faltaWacc: true,
      },
      scoreNiif,
      altmanZ,
      altmanRazon,
      oportunidades: { capitalizacion36_3, liberacionCartera, expansionIngresos },
    },
  };
}

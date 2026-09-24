// ---------------------------------------------------------------------------
// Conciliación fiscal — cálculos deterministas sobre la salida del LLM
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-18: la obligación de presentar el Formato 2516
//     (ingresos brutos fiscales ≥ 45.000 UVT del año gravable objeto de
//     conciliación — DUR 1625/2016 art. 1.7.2, sustituido por el Decreto 1998
//     de 2017) se calcula con la UVT de ese año, no con la UVT 2026.
//   - tributario-modulos-19: el impuesto diferido se calculaba al 35% para
//     toda diferencia. NIC 12 §47 y §51-51C exigen la tarifa acorde con la
//     forma de recuperación: la realización por venta de activos poseídos dos
//     años o más es ganancia ocasional al 15% (Art. 313 E.T., mod. Ley 2277 de
//     2022 art. 32; Art. 300 E.T.). DTA/DTL, totales por categoría y cuadre de
//     la cédula puente se recalculan aquí en BigInt.
// ---------------------------------------------------------------------------

import { uvtToCopByYear } from '@/lib/accounting/tax-engine/constants';
import type {
  DeferredTaxReportJson,
  TaxDifferenceItemJson,
  TaxDifferenceReportJson,
} from '../../contracts/tax-reconciliation';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

// ---------------------------------------------------------------------------
// Umbral Formato 2516
// ---------------------------------------------------------------------------

export const FORMATO_2516_UMBRAL_UVT = 45_000;

export interface Formato2516Threshold {
  year: number;
  uvtCop: number;
  thresholdCents: string;
}

/** Lanza si el periodo no trae año o si la UVT de ese año no está registrada. */
export function formato2516Threshold(fiscalPeriod: string | undefined | null): Formato2516Threshold {
  const m = /(19|20)\d{2}/.exec(fiscalPeriod ?? '');
  if (!m) {
    throw new Error(
      `Conciliación fiscal: el periodo "${fiscalPeriod ?? ''}" no identifica el año gravable; el umbral del Formato 2516 (45.000 UVT) se mide con la UVT de ese año.`,
    );
  }
  const year = Number(m[0]);
  const uvtCop = uvtToCopByYear(1, year);
  return {
    year,
    uvtCop,
    thresholdCents: (BigInt(uvtToCopByYear(FORMATO_2516_UMBRAL_UVT, year)) * CIEN).toString(),
  };
}

// ---------------------------------------------------------------------------
// Tarifa por forma de recuperación (NIC 12 §47, §51-51C)
// ---------------------------------------------------------------------------

export const TARIFA_RENTA_ORDINARIA_PCT = 35; // Art. 240 E.T.
export const TARIFA_GANANCIA_OCASIONAL_PCT = 15; // Art. 313 E.T. (Ley 2277/2022 art. 32)

export interface TarifaAplicada {
  ratePct: number | null;
  fuente: string;
}

export function tarifaPorFormaRecuperacion(item: TaxDifferenceItemJson): TarifaAplicada {
  switch (item.recoveryForm) {
    case 'venta_ganancia_ocasional':
      return { ratePct: TARIFA_GANANCIA_OCASIONAL_PCT, fuente: 'Art. 313 E.T. (ganancia ocasional, activo poseído ≥ 2 años — Art. 300)' };
    case 'regimen_especial_declarado':
      // Zona franca, sobretasas u otros regímenes: la tarifa depende de datos
      // que esta ruta no verifica. Se usa la del modelo sólo si la declaró.
      return {
        ratePct: item.applicableRatePct,
        fuente: 'Tarifa de régimen especial declarada por el modelo — verificar régimen del contribuyente',
      };
    case 'uso_o_realizacion_ordinaria':
    default:
      return { ratePct: TARIFA_RENTA_ORDINARIA_PCT, fuente: 'Art. 240 E.T. (renta ordinaria)' };
  }
}

function absBig(v: bigint): bigint {
  return v < ZERO ? -v : v;
}

/** cents × pct / 100 con redondeo half-away (pct con hasta 2 decimales). */
function pctOfCents(cents: bigint, pct: number): bigint {
  const pctBig = BigInt(Math.round(pct * 100));
  const num = cents * pctBig;
  const DIV = BigInt(10_000);
  const q = num / DIV;
  const r = num % DIV;
  return r * BigInt(2) >= DIV ? q + BigInt(1) : q;
}

export interface DifferenceCheck {
  /** false ⇒ la cédula puente no cuadra: se declara en el reporte. */
  bridgeBalances: boolean;
  bridgeGapCents: string;
  /** Diferencias temporarias sin tarifa determinable (régimen especial sin tarifa). */
  itemsWithoutRate: string[];
}

/**
 * Recalcula DTA/DTL por diferencia con la tarifa de su forma de recuperación,
 * los totales por categoría y el cuadre de la cédula puente. Devuelve el JSON
 * corregido y el resultado de los chequeos.
 */
export function enforceDifferenceReport(json: TaxDifferenceReportJson): {
  json: TaxDifferenceReportJson;
  check: DifferenceCheck;
} {
  const itemsWithoutRate: string[] = [];
  const differences = json.differences.map((d) => {
    if (d.classification === 'permanente') {
      return { ...d, applicableRatePct: null, deferredTaxAssetCents: '0', deferredTaxLiabilityCents: '0' };
    }
    const { ratePct } = tarifaPorFormaRecuperacion(d);
    const base = absBig(BigInt(d.differenceCents));
    if (ratePct === null) {
      itemsWithoutRate.push(d.id);
      return { ...d, applicableRatePct: null, deferredTaxAssetCents: '0', deferredTaxLiabilityCents: '0' };
    }
    const tax = pctOfCents(base, ratePct).toString();
    return {
      ...d,
      applicableRatePct: ratePct,
      deferredTaxAssetCents: d.classification === 'temporaria_deducible' ? tax : '0',
      deferredTaxLiabilityCents: d.classification === 'temporaria_imponible' ? tax : '0',
    };
  });

  const categories = Array.from(new Set([
    ...json.categorySummaries.map((c) => c.category),
    ...differences.map((d) => d.category),
  ]));
  const categorySummaries = categories.map((category) => {
    const items = differences.filter((d) => d.category === category);
    return {
      category,
      totalAbsoluteDifferenceCents: items.reduce((a, d) => a + absBig(BigInt(d.differenceCents)), ZERO).toString(),
      totalDtaCents: items.reduce((a, d) => a + BigInt(d.deferredTaxAssetCents), ZERO).toString(),
      totalDtlCents: items.reduce((a, d) => a + BigInt(d.deferredTaxLiabilityCents), ZERO).toString(),
      itemCount: items.length,
    };
  });

  const ajustes = json.bridgeSchedule
    .filter((r) => r.classification === 'ajuste_activo' || r.classification === 'ajuste_pasivo' || r.classification === 'ajuste_ori')
    .reduce((a, r) => a + BigInt(r.amountCents), ZERO);
  const gap = BigInt(json.patrimonioNiifCents) + ajustes - BigInt(json.patrimonioFiscalCents);

  const notes = [...json.preparerNotes];
  if (gap !== ZERO) {
    notes.push(
      `La cédula puente NO cuadra: patrimonio NIIF + ajustes − patrimonio fiscal = ${gap.toString()} centavos. Revisar antes de usar el reporte.`,
    );
  }
  if (itemsWithoutRate.length > 0) {
    notes.push(
      `Impuesto diferido N/D para ${itemsWithoutRate.join(', ')}: régimen especial sin tarifa verificable.`,
    );
  }

  return {
    json: { ...json, differences, categorySummaries, preparerNotes: notes },
    check: { bridgeBalances: gap === ZERO, bridgeGapCents: gap.toString(), itemsWithoutRate },
  };
}

/**
 * Recalcula la hoja del Agente 2 con las diferencias y tarifas del Agente 1
 * (por `differenceItemId`) y los totales DTA/DTL y saldos finales.
 */
export function enforceDeferredTaxReport(
  json: DeferredTaxReportJson,
  items: readonly TaxDifferenceItemJson[],
): DeferredTaxReportJson {
  const byId = new Map(items.map((i) => [i.id, i]));
  const notes = [...json.preparerNotes];
  const worksheet = json.worksheet.map((w) => {
    const item = byId.get(w.differenceItemId);
    if (!item || item.classification === 'permanente') {
      notes.push(`Fila ${w.differenceItemId} sin diferencia temporaria del Agente 1: cifras en cero.`);
      return { ...w, dtaCents: '0', dtlCents: '0', recognizedDtaCents: '0' };
    }
    const base = absBig(BigInt(item.differenceCents));
    const rate = item.applicableRatePct;
    const tax = rate === null ? ZERO : pctOfCents(base, rate);
    const type: 'deducible' | 'imponible' = item.classification === 'temporaria_deducible' ? 'deducible' : 'imponible';
    const dta = type === 'deducible' ? tax : ZERO;
    return {
      ...w,
      temporaryDifferenceCents: base.toString(),
      type,
      taxRatePct: rate ?? 0,
      dtaCents: dta.toString(),
      dtlCents: (type === 'imponible' ? tax : ZERO).toString(),
      recognizedDtaCents: (w.dtaRecognized ? dta : ZERO).toString(),
    };
  });
  const totalDta = worksheet.reduce((a, w) => a + BigInt(w.dtaCents), ZERO);
  const totalRecognized = worksheet.reduce((a, w) => a + BigInt(w.recognizedDtaCents), ZERO);
  const totalDtl = worksheet.reduce((a, w) => a + BigInt(w.dtlCents), ZERO);
  const net = totalRecognized - totalDtl;
  return {
    ...json,
    worksheet,
    dtaDtlSummary: {
      totalDtaCents: totalDta.toString(),
      totalRecognizedDtaCents: totalRecognized.toString(),
      totalDtlCents: totalDtl.toString(),
      netPositionCents: net.toString(),
    },
    movement: {
      ...json.movement,
      closingBalanceDtaCents: totalRecognized.toString(),
      closingBalanceDtlCents: totalDtl.toString(),
      netPositionCents: net.toString(),
    },
    preparerNotes: notes,
  };
}

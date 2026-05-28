// ---------------------------------------------------------------------------
// Capa 4 — Módulo 3 — Tool: Risk Score Calculator (0-100)
// ---------------------------------------------------------------------------
//
// Fórmula 5 factores → score 0-100 → nivel cualitativo.
// 100% determinístico: cero LLM, cero red.
//
// Factores (suma de puntos):
//   1. TET muy baja (F09):
//        F09 = 0%        → +30
//        F09 1-14%       → +20
//        F09 15-25%      → +5
//        F09 > 25%       → +0
//   2. Margen neto alto:
//        > 90%           → +25
//        70-90%          → +15
//        30-70%          → +5
//        < 30%           → +0
//   3. Costo de ventas bajo (Clases 6+7 / Ingresos):
//        < 1%            → +20
//        1-10%           → +10
//        > 10%           → +0
//   4. Crecimiento ingresos inusual (vs comparativo si existe):
//        > 100%          → +15
//        50-100%         → +8
//        < 50%           → +0
//   5. Saldo a favor sin solicitar:
//        > $50M y no se ha solicitado → +10
//        sino                          → +0
//
// Niveles:
//   0-20   → bajo
//   21-40  → medio
//   41-60  → alto
//   61-80  → muy_alto
//   81-100 → critico
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';
import type { RiskFactorBreakdown, RiskNivel } from '../types';

const ZERO = BigInt(0);

const SALDO_FAVOR_MATERIALIDAD_COP = 50_000_000;

export interface RiskScorePrecomputedData {
  score: number;
  nivel: RiskNivel;
  factores: RiskFactorBreakdown[];
}

interface RiskInput {
  anchor: FiscalAnchorBlock;
  preprocessed: PreprocessedBalance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctRatioCents(num: bigint, denom: bigint): number {
  if (denom <= ZERO) return 0;
  const scaled = (num * BigInt(10000)) / denom;
  return Number(scaled) / 100;
}

/**
 * Ingresos del periodo anterior (comparativo) en BigInt cents, si están
 * disponibles. Retorna `null` cuando no hay periodo comparativo materializado
 * en `controlTotals.cents` (single-period balance).
 */
function ingresosComparativoCents(
  pp: PreprocessedBalance,
): bigint | null {
  const comp = pp.comparative;
  if (!comp) return null;
  const cents = comp.controlTotals.cents;
  if (!cents) return null;
  return cents.ingresos;
}

// ---------------------------------------------------------------------------
// Factor 1 — TET baja (F09)
// ---------------------------------------------------------------------------

function factorTet(f09: number): RiskFactorBreakdown {
  let puntos: number;
  let detalle: string;
  if (f09 <= 0.01) {
    puntos = 30;
    detalle = 'F09 = 0% — tasa efectiva nula sobre utilidad. Activa Modo Supervivencia.';
  } else if (f09 < 15) {
    puntos = 20;
    detalle = `F09 = ${f09}% — debajo del umbral 15% de TTD (Art. 240 par. 6 E.T.).`;
  } else if (f09 <= 25) {
    puntos = 5;
    detalle = `F09 = ${f09}% — por encima del umbral pero todavía revisable.`;
  } else {
    puntos = 0;
    detalle = `F09 = ${f09}% — tasa efectiva consistente con tarifa general.`;
  }
  return {
    factor: 'tet_baja',
    descripcion: 'Tasa efectiva de tributación (F09)',
    puntos,
    detalle,
  };
}

// ---------------------------------------------------------------------------
// Factor 2 — Margen neto alto (utilidadNeta / ingresos)
// ---------------------------------------------------------------------------

function factorMargenNeto(pp: PreprocessedBalance): RiskFactorBreakdown {
  const cents = pp.primary.controlTotals.cents;
  if (!cents || cents.ingresos <= ZERO) {
    return {
      factor: 'margen_alto',
      descripcion: 'Margen neto sobre ingresos',
      puntos: 0,
      detalle: 'No hay ingresos materializados — factor no aplicable.',
    };
  }
  const margenPct = pctRatioCents(cents.utilidadNeta, cents.ingresos);
  let puntos: number;
  let detalle: string;
  if (margenPct > 90) {
    puntos = 25;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — atípicamente alto, perfil de actividad de bajo costo dudoso.`;
  } else if (margenPct >= 70) {
    puntos = 15;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — alto, susceptible de revisión por la DIAN.`;
  } else if (margenPct >= 30) {
    puntos = 5;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — dentro de banda razonable según sector.`;
  } else {
    puntos = 0;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — consistente con operación regular.`;
  }
  return { factor: 'margen_alto', descripcion: 'Margen neto sobre ingresos', puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 3 — Costo de ventas bajo
// ---------------------------------------------------------------------------

function factorCostoBajo(pp: PreprocessedBalance): RiskFactorBreakdown {
  // gastos incluye clases 5+6+7. Asumimos como proxy razonable de costos
  // operativos totales — el cálculo refinado por clase requiere acceso al
  // árbol de cuentas que no exponemos a este tool.
  const cents = pp.primary.controlTotals.cents;
  if (!cents || cents.ingresos <= ZERO) {
    return {
      factor: 'costo_bajo',
      descripcion: 'Relación costo-ingreso',
      puntos: 0,
      detalle: 'No hay ingresos materializados — factor no aplicable.',
    };
  }
  // gastos = clase 5+6+7 (incluye impuesto causado). Para costo "operativo",
  // restamos impuesto causado.
  const costoOperativo = cents.gastos - cents.impuestoCausado;
  const ratioPct = pctRatioCents(costoOperativo, cents.ingresos);
  let puntos: number;
  let detalle: string;
  if (ratioPct < 1) {
    puntos = 20;
    detalle = `Costos/Ingresos = ${ratioPct.toFixed(2)}% — patrón atípico, posible falta de soportes.`;
  } else if (ratioPct < 10) {
    puntos = 10;
    detalle = `Costos/Ingresos = ${ratioPct.toFixed(2)}% — bajo, revisar materialidad de soportes.`;
  } else {
    puntos = 0;
    detalle = `Costos/Ingresos = ${ratioPct.toFixed(2)}% — dentro de rango razonable.`;
  }
  return { factor: 'costo_bajo', descripcion: 'Relación costo-ingreso', puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 4 — Crecimiento inusual de ingresos
// ---------------------------------------------------------------------------

function factorCrecimiento(pp: PreprocessedBalance): RiskFactorBreakdown {
  const cents = pp.primary.controlTotals.cents;
  const prev = ingresosComparativoCents(pp);
  if (!cents || prev === null || prev <= ZERO) {
    return {
      factor: 'crecimiento_inusual',
      descripcion: 'Crecimiento de ingresos vs periodo anterior',
      puntos: 0,
      detalle: 'No hay periodo comparativo materializado — factor no aplicable.',
    };
  }
  const crecimientoPct = pctRatioCents(cents.ingresos - prev, prev);
  let puntos: number;
  let detalle: string;
  if (crecimientoPct > 100) {
    puntos = 15;
    detalle = `Crecimiento ${crecimientoPct.toFixed(1)}% — duplicación del top-line, atrae atención DIAN.`;
  } else if (crecimientoPct >= 50) {
    puntos = 8;
    detalle = `Crecimiento ${crecimientoPct.toFixed(1)}% — notable, revisar consistencia con sector.`;
  } else {
    puntos = 0;
    detalle = `Crecimiento ${crecimientoPct.toFixed(1)}% — variación regular.`;
  }
  return { factor: 'crecimiento_inusual', descripcion: 'Crecimiento de ingresos vs periodo anterior', puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 5 — Saldo a favor sin solicitar
// ---------------------------------------------------------------------------

function factorSaldoFavor(anchor: FiscalAnchorBlock): RiskFactorBreakdown {
  const f04Cents = BigInt(anchor.f04);
  // F04 < 0 → saldo a favor (F02 < F03).
  if (f04Cents >= ZERO) {
    return {
      factor: 'saldo_favor_sin_solicitar',
      descripcion: 'Saldo a favor sin solicitud activa',
      puntos: 0,
      detalle: 'No se identifica saldo a favor del periodo según F04.',
    };
  }
  const saldoFavorCop = Number((-f04Cents) / BigInt(100));
  if (saldoFavorCop > SALDO_FAVOR_MATERIALIDAD_COP) {
    return {
      factor: 'saldo_favor_sin_solicitar',
      descripcion: 'Saldo a favor sin solicitud activa',
      puntos: 10,
      detalle: `Saldo a favor estimado supera $50.000.000 (Art. 850 E.T.). Si no se solicita devolución / compensación, prescribe en 2 años (Art. 854 E.T.).`,
    };
  }
  return {
    factor: 'saldo_favor_sin_solicitar',
    descripcion: 'Saldo a favor sin solicitud activa',
    puntos: 0,
    detalle: `Saldo a favor identificado pero por debajo del umbral de materialidad ($50.000.000).`,
  };
}

// ---------------------------------------------------------------------------
// Calculadora principal
// ---------------------------------------------------------------------------

function classifyNivel(score: number): RiskNivel {
  if (score <= 20) return 'bajo';
  if (score <= 40) return 'medio';
  if (score <= 60) return 'alto';
  if (score <= 80) return 'muy_alto';
  return 'critico';
}

export function computeRiskScore(input: RiskInput): RiskScorePrecomputedData {
  const factores: RiskFactorBreakdown[] = [
    factorTet(input.anchor.f09),
    factorMargenNeto(input.preprocessed),
    factorCostoBajo(input.preprocessed),
    factorCrecimiento(input.preprocessed),
    factorSaldoFavor(input.anchor),
  ];
  const score = Math.min(100, factores.reduce((acc, f) => acc + f.puntos, 0));
  return { score, nivel: classifyNivel(score), factores };
}

/**
 * El saldo a favor en MoneyCop (para devoluciones / supervivencia).
 * Solo positivo si F04 < 0; cero en otro caso.
 */
export function saldoAFavorCents(anchor: FiscalAnchorBlock): string {
  const f04 = BigInt(anchor.f04);
  return f04 < ZERO ? serializeMoneyCop(-f04) : '0';
}

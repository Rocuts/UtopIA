// ---------------------------------------------------------------------------
// Pilar FUTURO — 4 Tarjetas Ejecutivas (vista del dueño / CFO)
// ---------------------------------------------------------------------------
// Tarjetas:
//   1. CAGR                    — azul    — Tasa crecimiento anual de ingresos
//   2. Punto de Quiebre        — naranja — Mes donde caja cruza 0 (escenario conservador)
//   3. Provisión Tributaria    — morada  — N/D sin base fiscal verificada (ratios-kpis-10)
//   4. Capacidad de Inversión  — verde   — shared-metrics.capacidadInversion (misma
//                                           función que el pilar; ratios-kpis-19)
//
// Fuente de la verdad:
//   - snapshot.controlTotals (efectivoCuenta11, ingresos, gastos, utilidadNeta).
//   - comparative snapshot opcional → deltas vs periodo anterior.
//
// TypeScript estricto — sin `any`.
// ---------------------------------------------------------------------------

import {
  FISCAL_ND_REASON_EN,
  FISCAL_ND_REASON_ES,
  capacidadInversion,
  ingresosNetosPeriodo,
  monthsCovered,
  periodsComparable,
} from './shared-metrics';
import type {
  ExecutiveCard,
  FuturoExecutiveCards,
  FuturoExecutiveCardsAudit,
  PillarStatus,
  PillarsAggregateInput,
} from './types';

// ---------------------------------------------------------------------------
// Constantes (replicadas de futuro.ts — patrón del repo: copy, no extract)
// ---------------------------------------------------------------------------

const HORIZON_MONTHS = 36;
const SCENARIO_CONSERVATIVE_FACTOR = 0.85;

// ---------------------------------------------------------------------------
// Helpers internos (puros)
// ---------------------------------------------------------------------------

interface RunwayProjection {
  monthsToZero: number; // HORIZON_MONTHS + 1 si nunca cae
  cashAtMonth36: number;
}

/** Replica exacta de projectRunway en futuro.ts — copiar es el patrón del repo. */
function projectRunway(
  cashStart: number,
  ingresoMes: number,
  egresoMes: number,
  factor: number,
): RunwayProjection {
  let cash = cashStart;
  let monthsToZero = HORIZON_MONTHS + 1;
  for (let m = 1; m <= HORIZON_MONTHS; m++) {
    cash = cash + ingresoMes * factor - egresoMes;
    if (cash <= 0 && monthsToZero > HORIZON_MONTHS) monthsToZero = m;
  }
  return { monthsToZero, cashAtMonth36: cash };
}

/**
 * Calcula CAGR (Compound Annual Growth Rate) entre dos períodos.
 * Null si no hay comparativo o el saldo previo es cero.
 *
 * Fórmula correcta: (V_final / V_inicial)^(1/n) − 1, donde n es el número
 * de períodos transcurridos. Para n=1 (caso típico year-over-year) coincide
 * con el rendimiento simple. Para n>1 es la tasa de crecimiento ANUALIZADA
 * compuesta (FIX audit B4).
 */
function computeCagr(
  currentIngresos: number,
  prevIngresos: number | null,
  periodosTranscurridos: number = 1,
): number | null {
  if (prevIngresos === null || prevIngresos === 0) return null;
  const n = Math.max(1, periodosTranscurridos);
  // Para soportar pérdidas (ratio < 0), usamos sign-aware power.
  const ratio = currentIngresos / prevIngresos;
  if (ratio <= 0) return -1; // colapso total
  return Math.pow(ratio, 1 / n) - 1;
}

/** Delta null-seguro entre valor actual y anterior. */
function safeDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  return curr - prev;
}

// ---------------------------------------------------------------------------
// Audit builder
// ---------------------------------------------------------------------------

function buildFuturoAudit(
  snapshot: PillarsAggregateInput['snapshot'],
  comparative: PillarsAggregateInput['snapshot'] | null | undefined,
): FuturoExecutiveCardsAudit {
  const ct = snapshot.controlTotals;

  const meses = monthsCovered(snapshot);
  const ingresoMes = ingresosNetosPeriodo(ct) / meses;
  const egresoMes = ct.gastos / meses;

  // CAGR — n = 1 (current vs comparative). Sólo entre periodos de IGUAL
  // duración (año vs año, o mismo mes acumulado): comparar un acumulado a
  // agosto con un año completo no es un crecimiento (ratios-kpis-03).
  const comparable = comparative ? periodsComparable(snapshot, comparative) : false;
  const ingresosAnteriores =
    comparative && comparable ? ingresosNetosPeriodo(comparative.controlTotals) : null;
  const cagrIngresos = computeCagr(ingresosNetosPeriodo(ct), ingresosAnteriores, 1);
  const periodosCagr = comparative && comparable ? 2 : null;

  // Punto de quiebre — escenario conservador
  const conservadorProj = projectRunway(
    ct.efectivoCuenta11,
    ingresoMes,
    egresoMes,
    SCENARIO_CONSERVATIVE_FACTOR,
  );
  const mesesAlQuiebreConservador =
    conservadorProj.monthsToZero <= HORIZON_MONTHS
      ? conservadorProj.monthsToZero
      : null;

  // Escenario base (factor 1.0)
  const baseProj = projectRunway(ct.efectivoCuenta11, ingresoMes, egresoMes, 1.0);
  const mesesAlQuiebreBase =
    baseProj.monthsToZero <= HORIZON_MONTHS ? baseProj.monthsToZero : null;

  // La provisión tributaria y la capacidad de inversión son N/D
  // (ratios-kpis-10/19); la utilidad neta se expone tal cual para
  // single-source-validator (sin reconstruirla desde UN × (1 + CAGR)).
  const provisionTributariaFutura: number | null = null;
  const reserva60Dias = (ct.gastos / ((meses * 365) / 12)) * 60;
  const capacidad = capacidadInversion(snapshot).value;

  return {
    cagrIngresos,
    periodosCagr,
    // Misma base que el CAGR (ingresos netos, no la Σ de la clase 4).
    ingresosActuales: ingresosNetosPeriodo(ct),
    ingresosAnteriores,
    mesesAlQuiebreConservador,
    mesesAlQuiebreBase,
    utilidadNeta: ct.utilidadNeta,
    provisionTributariaFutura,
    capacidadInversion: capacidad,
    reserva60Dias,
    cajaProyectada36mBase: baseProj.cashAtMonth36,
  };
}

// ---------------------------------------------------------------------------
// Status thresholds
// ---------------------------------------------------------------------------

/** CAGR — higher-better. */
function cagrStatus(cagr: number | null): PillarStatus {
  if (cagr === null) return 'watch'; // Sin histórico — informativo, no crítico
  if (cagr >= 0.1) return 'healthy';
  if (cagr >= 0.05) return 'watch';
  if (cagr >= 0) return 'warning';
  return 'critical';
}

/** Punto de Quiebre (meses) — lower-is-WORSE. */
function puntoQuiebreStatus(meses: number | null): PillarStatus {
  if (meses === null) return 'healthy'; // Sin riesgo en 36 meses
  if (meses <= 6) return 'critical';
  if (meses <= 12) return 'warning';
  if (meses <= 24) return 'watch';
  return 'healthy';
}

/** Capacidad de Inversión — compara con caja actual. */
function capacidadInversionStatus(capex: number | null, caja: number): PillarStatus {
  if (capex === null) return 'watch';
  if (capex < 0) return 'critical';
  if (capex < caja * 0.1) return 'warning';
  if (capex < caja * 0.3) return 'watch';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Cómputo principal
// ---------------------------------------------------------------------------

export function computeFuturoExecutiveCards(
  input: PillarsAggregateInput,
): FuturoExecutiveCards {
  const { snapshot, comparative } = input;
  const ct = snapshot.controlTotals;

  // ── Audit del snapshot actual ─────────────────────────────────────────────
  const audit = buildFuturoAudit(snapshot, comparative);

  // ── Audit del comparativo (para deltas) ──────────────────────────────────
  let prevAudit: FuturoExecutiveCardsAudit | null = null;
  if (comparative) {
    prevAudit = buildFuturoAudit(comparative, null);
  }

  // ─── 1. CAGR ─────────────────────────────────────────────────────────────
  const cagr: ExecutiveCard = {
    key: 'cagr',
    labelEs: 'Crecimiento de Ingresos (CAGR)',
    labelEn: 'Revenue Growth (CAGR)',
    value: audit.cagrIngresos,
    unit: 'pct',
    color: 'blue',
    status: cagrStatus(audit.cagrIngresos),
    // CAGR ya usa el comparativo — delta no aplica (sería circular)
    deltaVsComparative: null,
    descriptionEs:
      audit.cagrIngresos === null
        ? 'N/D — requiere un periodo comparativo de igual duración (año contra año o el mismo mes acumulado).'
        : 'Crecimiento de ingresos netos frente al periodo comparativo de igual duración.',
    descriptionEn:
      audit.cagrIngresos === null
        ? 'N/A — requires a comparative period of equal length (year vs year or the same year-to-date month).'
        : 'Net revenue growth versus the comparative period of equal length.',
    formulaEs: '(Ingresos netos T / Ingresos netos T-1) − 1',
    formulaEn: '(Net revenue T / Net revenue T-1) − 1',
  };

  // ─── 2. Punto de Quiebre ─────────────────────────────────────────────────
  const prevMesesQuiebre = prevAudit?.mesesAlQuiebreConservador ?? null;
  const punto_quiebre: ExecutiveCard = {
    key: 'punto_quiebre',
    labelEs: 'Punto de Quiebre de Caja',
    labelEn: 'Cash Break-Even Point',
    value: audit.mesesAlQuiebreConservador,
    unit: 'months',
    color: 'orange',
    status: puntoQuiebreStatus(audit.mesesAlQuiebreConservador),
    deltaVsComparative: safeDelta(audit.mesesAlQuiebreConservador, prevMesesQuiebre),
    descriptionEs:
      'Mes proyectado donde el efectivo (PUC 11) cruza 0 bajo escenario conservador (−15% ingresos). Si <6 meses → reaccionar urgente.',
    descriptionEn:
      'Projected month where cash (PUC 11) crosses 0 under conservative scenario (−15% revenue). If <6 months → urgent action needed.',
    formulaEs: 'Caja proyectada 36 meses con factor 0.85 sobre ingresos mensuales',
    formulaEn: '36-month projected cash with 0.85 factor on monthly revenue',
  };

  // ─── 3. Provisión Tributaria Futura ──────────────────────────────────────
  const prevProvision = prevAudit?.provisionTributariaFutura ?? null;
  const provision_tributaria: ExecutiveCard = {
    key: 'provision_tributaria',
    labelEs: 'Provisión Tributaria Futura',
    labelEn: 'Future Tax Provision',
    value: audit.provisionTributariaFutura,
    unit: 'cop',
    color: 'purple',
    status: 'watch',
    deltaVsComparative: safeDelta(audit.provisionTributariaFutura, prevProvision),
    descriptionEs: FISCAL_ND_REASON_ES,
    descriptionEn: FISCAL_ND_REASON_EN,
    formulaEs: 'Impuesto sobre renta líquida proyectada con tarifa y régimen verificados (sin base: N/D)',
    formulaEn: 'Tax on projected taxable income with verified rate and regime (no base: N/A)',
  };

  // ─── 4. Capacidad de Inversión ────────────────────────────────────────────
  const prevCapacidad = prevAudit?.capacidadInversion ?? null;
  const capacidad_inversion: ExecutiveCard = {
    key: 'capacidad_inversion',
    labelEs: 'Capacidad de Inversión',
    labelEn: 'Investment Capacity',
    value: audit.capacidadInversion,
    unit: 'cop',
    color: 'green',
    status: capacidadInversionStatus(audit.capacidadInversion, ct.efectivoCuenta11),
    deltaVsComparative: safeDelta(audit.capacidadInversion, prevCapacidad),
    descriptionEs:
      audit.capacidadInversion === null
        ? FISCAL_ND_REASON_ES
        : 'Caja libre disponible para inversión tras impuesto de renta pendiente y reserva operacional de 60 días.',
    descriptionEn:
      audit.capacidadInversion === null
        ? FISCAL_ND_REASON_EN
        : 'Free cash available for investment after pending income tax and a 60-day operational reserve.',
    formulaEs: 'Caja PUC 11 − Impuesto de renta pendiente verificado − Reserva 60 días de egresos',
    formulaEn: 'Cash PUC 11 − Verified pending income tax − 60-day outflow reserve',
  };

  return {
    cagr,
    punto_quiebre,
    provision_tributaria,
    capacidad_inversion,
    audit,
    generatedAt: new Date().toISOString(),
  };
}

export type { ExecutiveCard };

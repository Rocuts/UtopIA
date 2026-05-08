// ---------------------------------------------------------------------------
// Pilar FUTURO — 4 Tarjetas Ejecutivas (vista del dueño / CFO)
// ---------------------------------------------------------------------------
// Tarjetas:
//   1. CAGR                    — azul    — Tasa crecimiento anual de ingresos
//   2. Punto de Quiebre        — naranja — Mes donde caja cruza 0 (escenario conservador)
//   3. Provisión Tributaria    — morada  — Impuesto renta proyectado próximo año
//   4. Capacidad de Inversión  — verde   — Caja libre tras provisionar renta + reserva 60d
//
// Fuente de la verdad:
//   - snapshot.controlTotals (efectivoCuenta11, ingresos, gastos, utilidadNeta).
//   - comparative snapshot opcional → deltas vs periodo anterior.
//
// TypeScript estricto — sin `any`.
// ---------------------------------------------------------------------------

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
const TAX_RATE = 0.35;

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

/** Calcula CAGR simple entre dos períodos. Null si no hay comparativo. */
function computeCagr(
  currentIngresos: number,
  prevIngresos: number | null,
): number | null {
  if (prevIngresos === null || prevIngresos === 0) return null;
  return currentIngresos / prevIngresos - 1;
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

  const ingresoMes = ct.ingresos / 12;
  const egresoMes = ct.gastos / 12;

  // CAGR
  const ingresosAnteriores = comparative?.controlTotals.ingresos ?? null;
  const cagrIngresos = computeCagr(ct.ingresos, ingresosAnteriores);
  const periodosCagr = comparative ? 2 : null;

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

  // Provisión tributaria futura
  const cagrParaProyeccion = cagrIngresos ?? 0.05;
  const utilidadProyectadaAnual = Math.max(0, ct.utilidadNeta) * (1 + cagrParaProyeccion);
  const provisionTributariaFutura = utilidadProyectadaAnual * TAX_RATE;

  // Capacidad de inversión
  const provisionRenta = Math.max(0, ct.utilidadNeta) * TAX_RATE;
  const reserva60Dias = (ct.gastos / 365) * 60;
  const capacidadInversion = ct.efectivoCuenta11 - provisionRenta - reserva60Dias;

  return {
    cagrIngresos,
    periodosCagr,
    ingresosActuales: ct.ingresos,
    ingresosAnteriores,
    mesesAlQuiebreConservador,
    mesesAlQuiebreBase,
    utilidadProyectadaAnual,
    provisionTributariaFutura,
    capacidadInversion,
    reserva60Dias,
    cajaProyectada36mBase: baseProj.cashAtMonth36,
    tasaRenta: TAX_RATE,
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

/** Provisión Tributaria — compara con caja actual. */
function provisionStatus(provision: number, caja: number): PillarStatus {
  if (caja <= 0) return provision > 0 ? 'critical' : 'watch';
  if (provision > caja) return 'critical';
  if (provision > caja * 0.5) return 'warning';
  return 'healthy';
}

/** Capacidad de Inversión — compara con caja actual. */
function capacidadInversionStatus(capex: number, caja: number): PillarStatus {
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
      'Tasa de crecimiento anual de ingresos. Calculada con últimos 2 cierres (Excel) o 24 meses (ERP).',
    descriptionEn:
      'Annual revenue growth rate. Calculated from the last 2 closing periods (Excel) or 24 months (ERP).',
    formulaEs: '(Ingresos T / Ingresos T-1) − 1',
    formulaEn: '(Revenue T / Revenue T-1) − 1',
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
    status: provisionStatus(audit.provisionTributariaFutura, ct.efectivoCuenta11),
    deltaVsComparative: safeDelta(audit.provisionTributariaFutura, prevProvision),
    descriptionEs:
      'Estimado de impuesto de renta a pagar el próximo año, basado en utilidad proyectada al 35% (Art. 240 E.T.).',
    descriptionEn:
      'Estimated income tax payable next year, based on projected net income at 35% (Art. 240 Colombian Tax Code).',
    formulaEs: 'Utilidad Neta × (1 + CAGR) × 35%',
    formulaEn: 'Net Income × (1 + CAGR) × 35%',
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
      'Caja libre disponible para inversión tras provisionar renta del año y reserva operacional de 60 días.',
    descriptionEn:
      'Free cash available for investment after provisioning annual income tax and a 60-day operational reserve.',
    formulaEs: 'Caja PUC 11 − Provisión Renta (35%) − Reserva 60 días gastos',
    formulaEn: 'Cash PUC 11 − Income Tax Provision (35%) − 60-day expense reserve',
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

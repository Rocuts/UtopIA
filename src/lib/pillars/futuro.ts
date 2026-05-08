// ---------------------------------------------------------------------------
// Pilar FUTURO — Proyección y Crecimiento
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Runway de Caja (3 escenarios, proyección 36 meses)
//   2. Capacidad de Inversión (CapEx)
//   3. Punto de Inflexión (mes índice donde escenario conservador < 0)
//
// Score Futuro = weighted (Runway 40%, CapEx 30%, distancia PI 30%).
// HARD CAP: si Punto Inflexión < 12 meses → score ≤ 30 (critical).
// ---------------------------------------------------------------------------

import { clampScore, kpiToScore, scoreToStatus, statusToSeverity, weightedScore } from './health-score';
import type {
  PillarAlert,
  PillarKpi,
  PillarMetrics,
  PillarsAggregateInput,
} from './types';

const HORIZON_MONTHS = 36;
const SCENARIO_BASE_FACTOR = 1.0;
const SCENARIO_CONSERVATIVE_FACTOR = 0.85;
const SCENARIO_AGGRESSIVE_FACTOR = 1.10;
const TAX_RATE = 0.35;

interface RunwayProjection {
  monthsToZero: number; // 36+ si nunca cae
  cashAtMonth36: number;
}

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

export function computeFuturoPillar(input: PillarsAggregateInput): PillarMetrics {
  const { snapshot } = input;
  const ct = snapshot.controlTotals;

  const ingresoMes = ct.ingresos / 12;
  const egresoMes = ct.gastos / 12;

  // ─── Proyección por escenarios ──────────────────────────────────────────
  const baseProj = projectRunway(ct.efectivoCuenta11, ingresoMes, egresoMes, SCENARIO_BASE_FACTOR);
  const conservadorProj = projectRunway(
    ct.efectivoCuenta11,
    ingresoMes,
    egresoMes,
    SCENARIO_CONSERVATIVE_FACTOR,
  );

  // ─── KPI 1 — Runway base ────────────────────────────────────────────────
  // Si nunca cae bajo 0 → "más de 36 meses" (representamos con 36).
  const runway = Math.min(baseProj.monthsToZero, HORIZON_MONTHS);
  const runwayScore = kpiToScore(
    runway,
    { healthy: 24, watch: 12, warning: 6 },
    'higher-better',
  );
  const runwayKpi: PillarKpi = {
    key: 'runway_caja',
    labelEs: 'Runway de Caja (escenario base)',
    labelEn: 'Cash Runway (base scenario)',
    value: runway,
    unit: 'months',
    target: 24,
    score: runwayScore,
    status: scoreToStatus(runwayScore),
    severity: statusToSeverity(scoreToStatus(runwayScore)),
    descriptionEs: `Meses hasta que la caja llegue a 0 al ritmo actual (horizonte ${HORIZON_MONTHS} meses).`,
    descriptionEn: `Months until cash hits zero at current pace (${HORIZON_MONTHS}-month horizon).`,
  };

  // ─── KPI 2 — Capacidad de Inversión (CapEx) ────────────────────────────
  // CapEx disponible = caja − provisión renta esperada − reserva 60d gastos.
  const provisionRenta = Math.max(0, ct.utilidadNeta) * TAX_RATE;
  const reserva60d = (ct.gastos / 365) * 60;
  const capex = ct.efectivoCuenta11 - provisionRenta - reserva60d;
  // Score: capex sobre caja actual. ≥30% saludable.
  const capexPct = ct.efectivoCuenta11 > 0 ? capex / ct.efectivoCuenta11 : 0;
  const capexScore = kpiToScore(
    capexPct,
    { healthy: 0.30, watch: 0.10, warning: 0.0 },
    'higher-better',
  );
  const capexKpi: PillarKpi = {
    key: 'capex_capacity',
    labelEs: 'Capacidad de Inversión',
    labelEn: 'Investment Capacity',
    value: capex,
    unit: 'cop',
    target: 0,
    score: capexScore,
    status: scoreToStatus(capexScore),
    severity: statusToSeverity(scoreToStatus(capexScore)),
    descriptionEs: 'Caja libre tras provisionar renta y reserva de 60 días de gasto.',
    descriptionEn: 'Free cash after provisioning income tax and a 60-day expense buffer.',
  };

  // ─── KPI 3 — Punto de Inflexión (escenario conservador) ────────────────
  const puntoInflexion =
    conservadorProj.monthsToZero <= HORIZON_MONTHS ? conservadorProj.monthsToZero : null;
  // Score: distancia. null (>36 meses) → 95. Cerca → bajo.
  let piScore: number;
  if (puntoInflexion === null) {
    piScore = 95;
  } else {
    piScore = kpiToScore(
      puntoInflexion,
      { healthy: 24, watch: 12, warning: 6 },
      'higher-better',
    );
  }
  const piKpi: PillarKpi = {
    key: 'punto_inflexion',
    labelEs: 'Punto de Inflexión (conservador −15%)',
    labelEn: 'Inflection Point (conservative −15%)',
    value: puntoInflexion,
    unit: 'months',
    target: HORIZON_MONTHS,
    score: piScore,
    status: scoreToStatus(piScore),
    severity: statusToSeverity(scoreToStatus(piScore)),
    descriptionEs:
      puntoInflexion === null
        ? `Sin punto de inflexión en los próximos ${HORIZON_MONTHS} meses bajo escenario conservador.`
        : `Bajo escenario conservador (−15%), la caja entraría en negativo en el mes ${puntoInflexion}.`,
    descriptionEn:
      puntoInflexion === null
        ? `No inflection point in the next ${HORIZON_MONTHS} months under conservative scenario.`
        : `Under conservative scenario (−15%), cash goes negative at month ${puntoInflexion}.`,
  };

  // ─── Alertas ───────────────────────────────────────────────────────────
  const alerts: PillarAlert[] = [];
  if (puntoInflexion !== null && puntoInflexion < 12) {
    alerts.push({
      code: 'FUTURE-INFLECTION-NEAR',
      severity: 'danger',
      titleEs: 'Punto de inflexión < 12 meses',
      titleEn: 'Inflection point < 12 months',
      messageEs: `Bajo escenario conservador la caja agota en el mes ${puntoInflexion}.`,
      messageEn: `Under conservative scenario, cash runs out at month ${puntoInflexion}.`,
    });
  }
  if (capex < 0) {
    alerts.push({
      code: 'FUTURE-CAPEX-NEG',
      severity: 'warning',
      titleEs: 'Capacidad de inversión negativa',
      titleEn: 'Negative investment capacity',
      messageEs: 'No hay caja libre tras cubrir renta proyectada y buffer operacional.',
      messageEn: 'No free cash after projected income tax and operational buffer.',
    });
  }

  let healthScore = weightedScore([
    { score: runwayScore, weight: 0.4 },
    { score: capexScore, weight: 0.3 },
    { score: piScore, weight: 0.3 },
  ]);
  // HARD CAP: PI < 12 meses → critical. Cappeamos a 25 (banda critical es <30).
  if (puntoInflexion !== null && puntoInflexion < 12) {
    healthScore = Math.min(healthScore, 25);
  }
  healthScore = clampScore(healthScore);
  const status = scoreToStatus(healthScore);

  return {
    pillarId: 'futuro',
    healthScore,
    status,
    kpis: [runwayKpi, capexKpi, piKpi],
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

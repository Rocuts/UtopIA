// ---------------------------------------------------------------------------
// Pilar FUTURO — Proyección y Crecimiento
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Runway de Caja (3 escenarios, proyección 36 meses)
//   2. Capacidad de Inversión — shared-metrics.capacidadInversion (misma
//      función que la tarjeta; N/D sin base fiscal verificada)
//   3. Punto de Inflexión (mes índice donde escenario conservador < 0)
//
// Flujos mensuales = ingresos netos (4175) y egresos del periodo divididos por
// los MESES CUBIERTOS por el snapshot (shared-metrics.mesesCubiertos, la misma
// regla del preprocesador: 'AAAA-MM', 'AAAA-Qn', rangos), no por 12 fijo
// (ratios-kpis-03, NM-01). Sin duración derivable, runway y punto de
// inflexión son N/D con motivo (sin score).
//
// Score Futuro = weighted (Runway 40%, CapEx 30%, distancia PI 30%) sobre los
// KPIs con dato. HARD CAP: si Punto Inflexión < 12 meses → score ≤ 30.
// ---------------------------------------------------------------------------

import {
  clampScore,
  kpiCoverage,
  kpiSeverity,
  kpiStatus,
  kpiToScore,
  scoreToStatus,
  weightedScore,
} from './health-score';
import {
  capacidadInversion,
  ingresosNetosPeriodo,
  mesesCubiertos,
  motivoSinMeses,
} from './shared-metrics';
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

  const meses = mesesCubiertos(snapshot);
  const sinMeses = meses === null ? motivoSinMeses(snapshot) : null;

  // ─── Proyección por escenarios ──────────────────────────────────────────
  // Sin meses derivables no hay flujo mensual: ninguna proyección.
  const proyectar = (factor: number): RunwayProjection | null =>
    meses === null
      ? null
      : projectRunway(
          ct.efectivoCuenta11,
          ingresosNetosPeriodo(ct) / meses,
          ct.gastos / meses,
          factor,
        );
  const baseProj = proyectar(SCENARIO_BASE_FACTOR);
  const conservadorProj = proyectar(SCENARIO_CONSERVATIVE_FACTOR);

  // ─── KPI 1 — Runway base ────────────────────────────────────────────────
  // Si nunca cae bajo 0 → "más de 36 meses" (representamos con 36).
  const runway = baseProj === null ? null : Math.min(baseProj.monthsToZero, HORIZON_MONTHS);
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
    status: kpiStatus(runwayScore),
    severity: kpiSeverity(runwayScore),
    descriptionEs:
      sinMeses?.es ??
      `Meses hasta que la caja llegue a 0 al ritmo actual (horizonte ${HORIZON_MONTHS} meses).`,
    descriptionEn:
      sinMeses?.en ??
      `Months until cash hits zero at current pace (${HORIZON_MONTHS}-month horizon).`,
  };

  // ─── KPI 2 — Capacidad de Inversión (CapEx) ────────────────────────────
  // Una sola función con la tarjeta (ratios-kpis-19). Exige impuesto de renta
  // pendiente verificado: hoy N/D (ratios-kpis-10).
  const cap = capacidadInversion(snapshot);
  const capex = cap.value;
  const capexPct =
    capex !== null && ct.efectivoCuenta11 > 0 ? capex / ct.efectivoCuenta11 : null;
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
    status: kpiStatus(capexScore),
    severity: kpiSeverity(capexScore),
    descriptionEs: capex === null ? cap.reasonEs : 'Caja libre tras impuesto de renta pendiente y reserva de 60 días de gasto.',
    descriptionEn: capex === null ? cap.reasonEn : 'Free cash after pending income tax and a 60-day expense buffer.',
  };

  // ─── KPI 3 — Punto de Inflexión (escenario conservador) ────────────────
  const puntoInflexion =
    conservadorProj !== null && conservadorProj.monthsToZero <= HORIZON_MONTHS
      ? conservadorProj.monthsToZero
      : null;
  // Score: distancia. null (>36 meses) → 95. Cerca → bajo. Sin proyección
  // (meses no derivables) no hay score: N/D no suma puntos.
  let piScore: number | null;
  if (conservadorProj === null) {
    piScore = null;
  } else if (puntoInflexion === null) {
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
    status: kpiStatus(piScore),
    severity: kpiSeverity(piScore),
    descriptionEs:
      sinMeses?.es ??
      (puntoInflexion === null
        ? `Sin punto de inflexión en los próximos ${HORIZON_MONTHS} meses bajo escenario conservador.`
        : `Bajo escenario conservador (−15%), la caja entraría en negativo en el mes ${puntoInflexion}.`),
    descriptionEn:
      sinMeses?.en ??
      (puntoInflexion === null
        ? `No inflection point in the next ${HORIZON_MONTHS} months under conservative scenario.`
        : `Under conservative scenario (−15%), cash goes negative at month ${puntoInflexion}.`),
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
  if (capex !== null && capex < 0) {
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

  const kpis = [runwayKpi, capexKpi, piKpi];
  return {
    pillarId: 'futuro',
    healthScore,
    status,
    kpis,
    alerts,
    kpiCoverage: kpiCoverage(kpis),
    generatedAt: new Date().toISOString(),
  };
}

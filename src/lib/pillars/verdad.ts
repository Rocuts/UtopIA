// ---------------------------------------------------------------------------
// Pilar VERDAD — Integridad y Transparencia
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Score de Integridad  = forensicScore (0-100); sin análisis forense ⇒ N/D
//      (ratios-kpis-25: antes 100 − 20 × hallazgos críticos del Curator,
//      presentado como "Benford, gaps, montos repetidos")
//   2. Brecha de Cuadratura = |equationDiff| / totalActivo (decimal)
//   3. Índice de Conciliación = facturasCruzadas / totalFacturas
//
// Score Verdad = weighted (Brecha 50%, Integridad 30%, Conciliación 20%) sobre
// los KPIs con dato (los N/D se excluyen y se renormaliza).
// HARD CAP: si Brecha > 1% del activo → score se cap a 30 (critical).
// ---------------------------------------------------------------------------

import {
  kpiCoverage,
  kpiSeverity,
  kpiStatus,
  kpiToScore,
  scoreToStatus,
  weightedScore,
} from './health-score';
import type {
  PillarAlert,
  PillarKpi,
  PillarMetrics,
  PillarsAggregateInput,
} from './types';

export function computeVerdadPillar(input: PillarsAggregateInput): PillarMetrics {
  const { snapshot, forensic, conciliation } = input;
  const ct = snapshot.controlTotals;

  // ─── KPI 1 — Score de Integridad ────────────────────────────────────────
  // Sólo el motor forense lo mide; sin él ⇒ N/D (no se deriva de hallazgos).
  const integridad: number | null =
    forensic && Number.isFinite(forensic.score) ? forensic.score : null;
  const integridadScore = kpiToScore(
    integridad,
    { healthy: 90, watch: 70, warning: 50 },
    'higher-better',
  );
  const integridadKpi: PillarKpi = {
    key: 'score_integridad',
    labelEs: 'Score de Integridad',
    labelEn: 'Integrity Score',
    value: integridad,
    unit: 'score',
    target: 90,
    score: integridadScore,
    status: kpiStatus(integridadScore),
    severity: kpiSeverity(integridadScore),
    descriptionEs:
      integridad === null
        ? 'N/D — requiere un análisis forense de los asientos (Benford, gaps, montos repetidos).'
        : 'Limpieza forense de los asientos contables (Benford, gaps, montos repetidos, etc.).',
    descriptionEn:
      integridad === null
        ? 'N/A — requires a forensic scan of journal entries (Benford, gaps, repeated amounts).'
        : 'Forensic cleanliness of journal entries (Benford, gaps, repeated amounts, etc.).',
  };

  // ─── KPI 2 — Brecha de Cuadratura ──────────────────────────────────────
  const equationDiff = ct.activo - (ct.pasivo + ct.patrimonio);
  let brechaPct: number | null = null;
  if (ct.activo > 0) {
    brechaPct = Math.abs(equationDiff) / ct.activo;
  } else if (Math.abs(equationDiff) > 0) {
    brechaPct = 1; // sin activo pero con descuadre → 100%
  } else {
    brechaPct = 0;
  }
  const brechaScore = kpiToScore(
    brechaPct,
    { healthy: 0.0001, watch: 0.001, warning: 0.01 },
    'lower-better',
  );
  const brechaKpi: PillarKpi = {
    key: 'brecha_cuadratura',
    labelEs: 'Brecha de Cuadratura',
    labelEn: 'Equation Gap',
    value: brechaPct,
    unit: 'pct',
    target: 0.0001,
    score: brechaScore,
    status: kpiStatus(brechaScore),
    severity: kpiSeverity(brechaScore),
    descriptionEs: 'Activo − (Pasivo + Patrimonio) sobre Activo. ≤0.01% saludable.',
    descriptionEn: 'Assets − (Liabilities + Equity) over Assets. ≤0.01% is healthy.',
  };

  // ─── KPI 3 — Índice de Conciliación ────────────────────────────────────
  let concIdx: number | null = null;
  if (conciliation && conciliation.totalEntries > 0) {
    concIdx = conciliation.reconciledEntries / conciliation.totalEntries;
  }
  const concScore = kpiToScore(
    concIdx,
    { healthy: 0.85, watch: 0.65, warning: 0.40 },
    'higher-better',
  );
  const concKpi: PillarKpi = {
    key: 'indice_conciliacion',
    labelEs: 'Índice de Conciliación',
    labelEn: 'Reconciliation Index',
    value: concIdx,
    unit: 'pct',
    target: 0.85,
    score: concScore,
    status: kpiStatus(concScore),
    severity: kpiSeverity(concScore),
    descriptionEs:
      concIdx === null
        ? 'Sin datos de conciliación bancaria. Habilita WS3 para activar.'
        : 'Asientos cruzados con extractos bancarios sobre el total.',
    descriptionEn:
      concIdx === null
        ? 'No bank reconciliation data. Enable WS3 to activate.'
        : 'Entries cross-checked against bank statements over total.',
  };

  // ─── Alertas ───────────────────────────────────────────────────────────
  const alerts: PillarAlert[] = [];
  if (brechaPct !== null && brechaPct > 0.01) {
    alerts.push({
      code: 'TRUTH-EQ-GAP',
      severity: 'danger',
      titleEs: 'Brecha de cuadratura > 1% del activo',
      titleEn: 'Equation gap > 1% of assets',
      messageEs: 'Estados financieros oficiales no son emitibles hasta resolver el descuadre.',
      messageEn: 'Official financial statements cannot be issued until the gap is resolved.',
    });
  }
  if (integridad !== null && integridad < 50) {
    alerts.push({
      code: 'TRUTH-INTEGRITY-LOW',
      severity: 'warning',
      titleEs: 'Score de integridad bajo',
      titleEn: 'Low integrity score',
      messageEs: 'El motor forense detectó múltiples anomalías. Revisar asientos.',
      messageEn: 'The forensic engine detected multiple anomalies. Review entries.',
    });
  }

  // ─── Score consolidado con HARD CAPS ──────────────────────────────────
  let healthScore = weightedScore([
    { score: brechaScore, weight: 0.5 },
    { score: integridadScore, weight: 0.3 },
    { score: concScore, weight: 0.2 },
  ]);
  // HARD CAP 1: brecha > 1% → critical. Cappeamos a 25 (banda critical es <30).
  if (brechaPct !== null && brechaPct > 0.01) {
    healthScore = Math.min(healthScore, 25);
  }
  // HARD CAP 2: integridad < 50 → no puede ser healthy (score ≤ 55).
  if (integridad !== null && integridad < 50) {
    healthScore = Math.min(healthScore, 55);
  }
  const status = scoreToStatus(healthScore);

  const kpis = [integridadKpi, brechaKpi, concKpi];
  return {
    pillarId: 'verdad',
    healthScore,
    status,
    kpis,
    alerts,
    kpiCoverage: kpiCoverage(kpis),
    generatedAt: new Date().toISOString(),
  };
}

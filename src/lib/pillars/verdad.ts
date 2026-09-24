// ---------------------------------------------------------------------------
// Pilar VERDAD — Integridad y Transparencia
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Score de Integridad  = forensicScore (0-100); sin análisis forense, se
//      deriva de los hallazgos críticos del Curator ROTULADO como tal; sin
//      ninguna fuente ⇒ N/D (ratios-kpis-25: antes se presentaba como
//      "Benford, gaps, montos repetidos" sin serlo). Un escaneo forense con
//      cobertura PARCIAL no es score de integridad (auditoria-calidad-19).
//   2. Brecha de Cuadratura = |equationDiff| / totalActivo (decimal)
//   3. Índice de Conciliación = facturasCruzadas / totalFacturas
//
// Score Verdad = weighted (Brecha 50%, Integridad 30%, Conciliación 20%) sobre
// los KPIs con dato (los N/D se excluyen y se renormaliza).
// HARD CAP: si Brecha > 1% del activo → score se cap a 30 (critical).
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
import { forensicIntegrityScore } from './shared-metrics';
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
  // Fuente preferente: el motor forense. Sin él, si el Curator corrió, se
  // deriva de sus hallazgos críticos y se ROTULA así (antes se presentaba como
  // "Benford, gaps, montos repetidos" sin serlo — ratios-kpis-25). Sin ninguna
  // de las dos fuentes ⇒ N/D.
  const curatorRes = input.curator ?? snapshot.curator ?? null;
  let integridad: number | null = null;
  let integridadOrigen: 'forense' | 'curator' | null = null;
  const forensicScore = forensicIntegrityScore(forensic);
  const forensicParcial = forensic?.coverage === 'parcial';
  if (forensicScore !== null) {
    integridad = forensicScore;
    integridadOrigen = 'forense';
  } else if (curatorRes) {
    const criticos = curatorRes.findings.filter((f) => f.severity === 'critico').length;
    integridad = clampScore(100 - criticos * 20);
    integridadOrigen = 'curator';
  }
  const integridadScore = kpiToScore(
    integridad,
    { healthy: 90, watch: 70, warning: 50 },
    'higher-better',
  );
  const integridadKpi: PillarKpi = {
    key: 'score_integridad',
    labelEs: integridadOrigen === 'curator' ? 'Integridad (hallazgos del Curator)' : 'Score de Integridad',
    labelEn: integridadOrigen === 'curator' ? 'Integrity (Curator findings)' : 'Integrity Score',
    value: integridad,
    unit: 'score',
    target: 90,
    score: integridadScore,
    status: kpiStatus(integridadScore),
    severity: kpiSeverity(integridadScore),
    descriptionEs:
      integridadOrigen === 'forense'
        ? 'Limpieza forense de los asientos contables (Benford, gaps, montos repetidos, etc.).'
        : integridadOrigen === 'curator'
          ? forensicParcial
            ? 'Derivado de los hallazgos críticos del Curator (100 − 20 por hallazgo crítico). El escaneo forense tuvo cobertura parcial y no se usa como score.'
            : 'Derivado de los hallazgos críticos del Curator (100 − 20 por hallazgo crítico). No hay análisis forense de asientos.'
          : forensicParcial
            ? 'N/D — el escaneo forense tuvo cobertura parcial (reglas sin evaluar) y no hay resultado del Curator.'
            : 'N/D — requiere un análisis forense de los asientos o el resultado del Curator.',
    descriptionEn:
      integridadOrigen === 'forense'
        ? 'Forensic cleanliness of journal entries (Benford, gaps, repeated amounts, etc.).'
        : integridadOrigen === 'curator'
          ? forensicParcial
            ? 'Derived from Curator critical findings (100 − 20 per critical finding). The forensic scan had partial coverage and is not used as a score.'
            : 'Derived from Curator critical findings (100 − 20 per critical finding). No forensic scan of entries.'
          : forensicParcial
            ? 'N/A — the forensic scan had partial coverage (rules not evaluated) and there is no Curator result.'
            : 'N/A — requires a forensic scan of entries or the Curator result.',
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

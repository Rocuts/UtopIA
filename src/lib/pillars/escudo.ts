// ---------------------------------------------------------------------------
// Pilar ESCUDO — Resiliencia y Protección
// ---------------------------------------------------------------------------
// KPIs maestros (definiciones únicas en ./shared-metrics.ts):
//   1. Días de Autonomía  = efectivo PUC 11 / egresos diarios del periodo
//   2. Razón Corriente    = activo corriente / pasivo corriente (null sin PC)
//   3. Cobertura Fiscal   = N/D sin base fiscal verificada (ratios-kpis-10:
//      antes era saldo del grupo 24 / (utilidad neta × 35 %), con IVA/ICA en el
//      numerador y "1 healthy" inventado cuando había pérdida).
//
// Score Escudo = weighted (Días 40%, Razón 35%, Cobertura 25%) sobre los KPIs
// con dato; los N/D se excluyen y se renormaliza (ratios-kpis-25).
// ---------------------------------------------------------------------------

import { kpiCoverage, kpiSeverity, kpiStatus, kpiToScore, scoreToStatus, weightedScore } from './health-score';
import {
  FISCAL_ND_REASON_EN,
  FISCAL_ND_REASON_ES,
  diasAutonomia as computeDiasAutonomia,
  razonCorriente,
} from './shared-metrics';
import type {
  PillarAlert,
  PillarKpi,
  PillarMetrics,
  PillarsAggregateInput,
} from './types';

export function computeEscudoPillar(input: PillarsAggregateInput): PillarMetrics {
  const { snapshot } = input;
  const ct = snapshot.controlTotals;

  // ─── KPI 1 — Días de Autonomía ──────────────────────────────────────────
  const dias = computeDiasAutonomia(snapshot);
  const diasAutonomia = dias.value;
  const diasScore = kpiToScore(
    diasAutonomia,
    { healthy: 90, watch: 45, warning: 30 },
    'higher-better',
  );
  const diasKpi: PillarKpi = {
    key: 'dias_autonomia',
    labelEs: 'Días de Autonomía',
    labelEn: 'Days of Runway',
    value: diasAutonomia,
    unit: 'days',
    target: 90,
    score: diasScore,
    status: kpiStatus(diasScore),
    severity: kpiSeverity(diasScore),
    descriptionEs:
      dias.reasonEs ??
      'Efectivo (PUC 11) sobre los egresos diarios del periodo (clases 5, 6 y 7; base 365 días).',
    descriptionEn:
      dias.reasonEn ??
      'Cash (PUC 11) over the period daily outflows (classes 5, 6 and 7; 365-day basis).',
  };

  // ─── KPI 2 — Razón Corriente ────────────────────────────────────────────
  // Sin pasivo corriente ⇒ null (antes el centinela 999 se pintaba "999.00").
  const solvencia = razonCorriente(ct);
  const solvenciaScore = kpiToScore(
    solvencia,
    { healthy: 1.5, watch: 1.2, warning: 1.0 },
    'higher-better',
  );
  const solvenciaKpi: PillarKpi = {
    key: 'solvencia_real',
    labelEs: 'Razón Corriente',
    labelEn: 'Current Ratio',
    value: solvencia,
    unit: 'ratio',
    target: 1.5,
    score: solvenciaScore,
    status: kpiStatus(solvenciaScore),
    severity: kpiSeverity(solvenciaScore),
    descriptionEs:
      solvencia === null
        ? 'N/D — sin pasivo corriente registrado.'
        : 'Activo corriente sobre pasivo corriente. ≥1,5 indica capacidad sólida de pagar deuda de corto plazo.',
    descriptionEn:
      solvencia === null
        ? 'N/A — no current liabilities recorded.'
        : 'Current assets over current liabilities. ≥1.5 indicates solid short-term debt coverage.',
  };

  // ─── KPI 3 — Cobertura de Riesgo Fiscal: N/D ───────────────────────────
  const coberturaKpi: PillarKpi = {
    key: 'cobertura_fiscal',
    labelEs: 'Cobertura de Riesgo Fiscal',
    labelEn: 'Tax Risk Coverage',
    value: null,
    unit: 'ratio',
    target: 1.0,
    score: null,
    status: kpiStatus(null),
    severity: kpiSeverity(null),
    descriptionEs: FISCAL_ND_REASON_ES,
    descriptionEn: FISCAL_ND_REASON_EN,
  };

  // ─── Alertas derivadas ──────────────────────────────────────────────────
  const alerts: PillarAlert[] = [];
  if (diasAutonomia !== null && diasAutonomia < 30) {
    alerts.push({
      code: 'SHIELD-LIQ-LOW',
      severity: 'danger',
      titleEs: 'Reserva crítica de caja',
      titleEn: 'Critical cash reserve',
      messageEs: `La caja cubre apenas ${Math.round(diasAutonomia)} días de operación.`,
      messageEn: `Cash covers only ${Math.round(diasAutonomia)} days of operations.`,
    });
  }

  // ─── Score consolidado ──────────────────────────────────────────────────
  const kpis = [diasKpi, solvenciaKpi, coberturaKpi];
  const healthScore = weightedScore([
    { score: diasScore, weight: 0.4 },
    { score: solvenciaScore, weight: 0.35 },
    { score: null, weight: 0.25 },
  ]);
  const status = scoreToStatus(healthScore);

  return {
    pillarId: 'escudo',
    healthScore,
    status,
    kpis,
    alerts,
    kpiCoverage: kpiCoverage(kpis),
    generatedAt: new Date().toISOString(),
  };
}

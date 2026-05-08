// ---------------------------------------------------------------------------
// Pilar ESCUDO — Resiliencia y Protección
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Días de Autonomía  = caja / (gastos_anuales / 365)
//   2. Solvencia Real     = activoCorriente / pasivoCorriente
//   3. Cobertura Fiscal   = impuestosCuenta24 / (utilidadNeta * 35%)
//
// Score Escudo = weighted (Días 40%, Solvencia 35%, Cobertura 25%).
// ---------------------------------------------------------------------------

import { kpiToScore, scoreToStatus, statusToSeverity, weightedScore } from './health-score';
import type {
  PillarAlert,
  PillarKpi,
  PillarMetrics,
  PillarsAggregateInput,
} from './types';

const SAFETY_RATE = 0.35; // Art. 240 E.T.

export function computeEscudoPillar(input: PillarsAggregateInput): PillarMetrics {
  const { snapshot } = input;
  const ct = snapshot.controlTotals;

  // ─── KPI 1 — Días de Autonomía ──────────────────────────────────────────
  // Usa gastos anuales (gastos = Clase 5 + 6 + 7 ya consolidado) y los
  // distribuye en /365 — no en /30 — porque el snapshot es típicamente anual.
  // Si gastos == 0 → null (label "Sin gastos del periodo").
  const gastosAnuales = ct.gastos;
  const efectivo = ct.efectivoCuenta11;
  let diasAutonomia: number | null = null;
  if (gastosAnuales > 0) {
    const gastoDiario = gastosAnuales / 365;
    if (gastoDiario > 0) diasAutonomia = efectivo / gastoDiario;
  } else if (efectivo > 0) {
    // Sin gastos pero con caja: autonomía "infinita" — capeada visualmente a 365.
    diasAutonomia = 365;
  }

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
    status: scoreToStatus(diasScore),
    severity: statusToSeverity(scoreToStatus(diasScore)),
    descriptionEs: 'Cuánto tiempo vive la empresa sin vender un solo peso, según los gastos del periodo.',
    descriptionEn: 'How long the company can survive without revenue, based on period expenses.',
  };

  // ─── KPI 2 — Solvencia Real ─────────────────────────────────────────────
  let solvencia: number | null = null;
  if (ct.pasivoCorriente > 0) {
    solvencia = ct.activoCorriente / ct.pasivoCorriente;
  } else if (ct.activoCorriente > 0) {
    solvencia = 999; // sin pasivos corrientes → solvencia muy alta
  }
  const solvenciaScore = kpiToScore(
    solvencia,
    { healthy: 1.5, watch: 1.2, warning: 1.0 },
    'higher-better',
  );
  const solvenciaKpi: PillarKpi = {
    key: 'solvencia_real',
    labelEs: 'Solvencia Real',
    labelEn: 'Real Solvency',
    value: solvencia,
    unit: 'ratio',
    target: 1.5,
    score: solvenciaScore,
    status: scoreToStatus(solvenciaScore),
    severity: statusToSeverity(scoreToStatus(solvenciaScore)),
    descriptionEs: 'Activo Corriente sobre Pasivo Corriente. ≥1.5 indica capacidad sólida de pagar deuda CP.',
    descriptionEn: 'Current Assets over Current Liabilities. ≥1.5 indicates solid short-term debt coverage.',
  };

  // ─── KPI 3 — Cobertura de Riesgo Fiscal ────────────────────────────────
  let cobertura: number | null = null;
  if (ct.utilidadNeta > 0) {
    const expected = ct.utilidadNeta * SAFETY_RATE;
    cobertura = expected > 0 ? ct.impuestosCuenta24 / expected : 1;
  } else {
    cobertura = 1; // sin utilidad → sin riesgo de provisión insuficiente
  }
  const coberturaScore = kpiToScore(
    cobertura,
    { healthy: 0.8, watch: 0.5, warning: 0.3 },
    'higher-better',
  );
  const coberturaKpi: PillarKpi = {
    key: 'cobertura_fiscal',
    labelEs: 'Cobertura de Riesgo Fiscal',
    labelEn: 'Tax Risk Coverage',
    value: cobertura,
    unit: 'ratio',
    target: 1.0,
    score: coberturaScore,
    status: scoreToStatus(coberturaScore),
    severity: statusToSeverity(scoreToStatus(coberturaScore)),
    descriptionEs: 'Provisión registrada vs renta teórica al 35% (Art. 240 E.T.).',
    descriptionEn: 'Recorded provision vs theoretical 35% income tax (Art. 240 E.T.).',
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
  if (cobertura !== null && cobertura < 0.3 && ct.utilidadNeta > 0) {
    alerts.push({
      code: 'SHIELD-TAX-GAP',
      severity: 'danger',
      titleEs: 'Riesgo de pasivo fiscal oculto',
      titleEn: 'Hidden tax liability risk',
      messageEs: 'La provisión actual no cubre la renta teórica del periodo.',
      messageEn: 'Current provision does not cover the period’s theoretical income tax.',
    });
  }

  // ─── Score consolidado ──────────────────────────────────────────────────
  const healthScore = weightedScore([
    { score: diasScore, weight: 0.4 },
    { score: solvenciaScore, weight: 0.35 },
    { score: coberturaScore, weight: 0.25 },
  ]);
  const status = scoreToStatus(healthScore);

  return {
    pillarId: 'escudo',
    healthScore,
    status,
    kpis: [diasKpi, solvenciaKpi, coberturaKpi],
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

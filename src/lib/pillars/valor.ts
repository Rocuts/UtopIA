// ---------------------------------------------------------------------------
// Pilar VALOR — Rentabilidad y Riqueza
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Margen Neto Real  = (utilidadNeta - sumaReclassR1) / ingresos
//   2. ROE Dinámico      = utilidadNeta / promedio(patrimonio_T, T-1)
//   3. EVA               = utilidadOperacional - capitalEmpleado * costoOportunidad
//
// Score Valor = weighted (Margen 35%, ROE 35%, EVA 30%).
// ---------------------------------------------------------------------------

import { kpiToScore, scoreToStatus, statusToSeverity, weightedScore } from './health-score';
import type {
  PillarAlert,
  PillarKpi,
  PillarMetrics,
  PillarsAggregateInput,
} from './types';

const DEFAULT_COSTO_OPORTUNIDAD = 0.12;

export function computeValorPillar(input: PillarsAggregateInput): PillarMetrics {
  const { snapshot, comparative } = input;
  const ct = snapshot.controlTotals;
  const curatorRes = input.curator ?? snapshot.curator ?? null;

  // ─── KPI 1 — Margen Neto Real ──────────────────────────────────────────
  // Ajustamos la utilidad neta restando el monto absoluto de reclasificaciones
  // R1 (saldos negativos en activos) — esos artefactos suelen estar inflando
  // ingresos o ocultando gastos. Si no hay R1 reclassifications, el ajuste = 0.
  const reclassImpact = (curatorRes?.reclassifications ?? []).reduce(
    (sum, r) => sum + Math.abs(r.amountCop),
    0,
  );
  let margenNeto: number | null = null;
  if (ct.ingresos > 0) {
    margenNeto = (ct.utilidadNeta - reclassImpact) / ct.ingresos;
  }
  const margenScore = kpiToScore(
    margenNeto,
    { healthy: 0.10, watch: 0.05, warning: 0.0 },
    'higher-better',
  );
  const margenKpi: PillarKpi = {
    key: 'margen_neto_real',
    labelEs: 'Margen Neto Real',
    labelEn: 'Real Net Margin',
    value: margenNeto,
    unit: 'pct',
    target: 0.10,
    score: margenScore,
    status: scoreToStatus(margenScore),
    severity: statusToSeverity(scoreToStatus(margenScore)),
    descriptionEs: 'Utilidad neta ajustada por reclasificaciones del Curator, sobre ingresos.',
    descriptionEn: 'Net income adjusted for Curator reclassifications, over revenue.',
  };

  // ─── KPI 2 — ROE Dinámico ──────────────────────────────────────────────
  let roe: number | null = null;
  const patrimonioPromedio =
    comparative
      ? (ct.patrimonio + comparative.controlTotals.patrimonio) / 2
      : ct.patrimonio;
  if (patrimonioPromedio > 0) {
    roe = ct.utilidadNeta / patrimonioPromedio;
  }
  const roeScore = kpiToScore(
    roe,
    { healthy: 0.15, watch: 0.10, warning: 0.05 },
    'higher-better',
  );
  const roeKpi: PillarKpi = {
    key: 'roe_dinamico',
    labelEs: 'ROE Dinámico',
    labelEn: 'Dynamic ROE',
    value: roe,
    unit: 'pct',
    target: 0.15,
    score: roeScore,
    status: scoreToStatus(roeScore),
    severity: statusToSeverity(scoreToStatus(roeScore)),
    descriptionEs: 'Rentabilidad sobre patrimonio promedio (T y T-1).',
    descriptionEn: 'Return on average equity (T and T-1).',
  };

  // ─── KPI 3 — EVA ────────────────────────────────────────────────────────
  // EVA = utilidad operacional − capital empleado × costo oportunidad.
  // Aproximamos utilidad operacional = utilidadNeta + impuestosCuenta24 (re-add).
  // Capital empleado = activo − pasivoCorriente.
  const utilidadOperacional = ct.utilidadNeta + ct.impuestosCuenta24;
  const capitalEmpleado = ct.activo - ct.pasivoCorriente;
  const costoOp = input.costoOportunidad ?? DEFAULT_COSTO_OPORTUNIDAD;
  const eva = utilidadOperacional - capitalEmpleado * costoOp;
  // Score: relativo al capital empleado (EVA / capital). EVA positivo es saludable.
  const evaPct = capitalEmpleado > 0 ? eva / capitalEmpleado : 0;
  const evaScore = kpiToScore(
    evaPct,
    { healthy: 0.05, watch: 0.0, warning: -0.05 },
    'higher-better',
  );
  const evaKpi: PillarKpi = {
    key: 'eva',
    labelEs: 'EVA (Valor Económico Añadido)',
    labelEn: 'EVA (Economic Value Added)',
    value: eva,
    unit: 'cop',
    target: 0,
    score: evaScore,
    status: scoreToStatus(evaScore),
    severity: statusToSeverity(scoreToStatus(evaScore)),
    descriptionEs: `Utilidad operacional menos capital empleado × ${(costoOp * 100).toFixed(0)}%. EVA > 0 = crea valor.`,
    descriptionEn: `Operating profit minus employed capital × ${(costoOp * 100).toFixed(0)}%. EVA > 0 = value-creating.`,
  };

  // ─── Alertas ───────────────────────────────────────────────────────────
  const alerts: PillarAlert[] = [];
  if (margenNeto !== null && margenNeto < 0) {
    alerts.push({
      code: 'VALUE-MARGIN-NEG',
      severity: 'danger',
      titleEs: 'Margen neto negativo',
      titleEn: 'Negative net margin',
      messageEs: 'La empresa pierde dinero después de costos, gastos e impuestos.',
      messageEn: 'The company is losing money after costs, expenses, and taxes.',
    });
  }
  if (eva < 0) {
    alerts.push({
      code: 'VALUE-EVA-NEG',
      severity: 'warning',
      titleEs: 'EVA negativo: el capital no rinde sobre su costo',
      titleEn: 'Negative EVA: capital not yielding above its cost',
      messageEs: 'El retorno operativo no supera el costo de oportunidad del capital empleado.',
      messageEn: 'Operating return does not exceed the opportunity cost of employed capital.',
    });
  }

  const healthScore = weightedScore([
    { score: margenScore, weight: 0.35 },
    { score: roeScore, weight: 0.35 },
    { score: evaScore, weight: 0.30 },
  ]);
  const status = scoreToStatus(healthScore);

  return {
    pillarId: 'valor',
    healthScore,
    status,
    kpis: [margenKpi, roeKpi, evaKpi],
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

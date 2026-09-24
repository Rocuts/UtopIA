// ---------------------------------------------------------------------------
// Pilar VALOR — Rentabilidad y Riqueza
// ---------------------------------------------------------------------------
// KPIs maestros:
//   1. Margen Neto Real  = (utilidadNeta - sumaReclassR1) / ingresos
//   2. ROE Dinámico      = utilidadNeta / promedio(patrimonio_T, T-1)
//   3. EVA               = NOPAT − capital empleado × costo de capital DECLARADO
//      NOPAT = EBIT operacional (./ebitda.ts) × (1 − tasa efectiva contable:
//      impuesto causado grupo 54 / UAI). Sin costo de capital declarado, sin
//      UAI > 0 o con capital empleado ≤ 0 ⇒ N/D (ratios-kpis-25: antes usaba
//      utilidad neta + saldo del pasivo 24 y un 12 % fijo, y con capital ≤ 0
//      fijaba 'watch').
//
// Score Valor = weighted (Margen 35%, ROE 35%, EVA 30%) sobre KPIs con dato.
// ---------------------------------------------------------------------------

import { computeEbitda } from './ebitda';
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
    status: kpiStatus(margenScore),
    severity: kpiSeverity(margenScore),
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
    status: kpiStatus(roeScore),
    severity: kpiSeverity(roeScore),
    descriptionEs: 'Rentabilidad sobre patrimonio promedio (T y T-1).',
    descriptionEn: 'Return on average equity (T and T-1).',
  };

  // ─── KPI 3 — EVA ────────────────────────────────────────────────────────
  const costoCapital =
    typeof input.costoOportunidad === 'number' && Number.isFinite(input.costoOportunidad)
      ? input.costoOportunidad
      : null;
  const ebit = computeEbitda(snapshot).utilidadOperacional;
  const capitalEmpleado = ct.activo - ct.pasivoCorriente;
  const uaiC = ct.cents?.utilidadAntesImpuestos;
  const impC = ct.cents?.impuestoCausado;
  const tasaEfectiva =
    uaiC !== undefined && impC !== undefined && uaiC > BigInt(0)
      ? Number(impC) / Number(uaiC)
      : null;
  let eva: number | null = null;
  let evaReasonEs: string | null = null;
  let evaReasonEn: string | null = null;
  if (costoCapital === null) {
    evaReasonEs = 'N/D — requiere costo de capital (WACC) declarado.';
    evaReasonEn = 'N/A — requires a declared cost of capital (WACC).';
  } else if (ebit === null) {
    evaReasonEs = 'N/D — sin utilidad operacional identificable (grupo 41).';
    evaReasonEn = 'N/A — no identifiable operating profit (group 41).';
  } else if (tasaEfectiva === null) {
    evaReasonEs = 'N/D — requiere utilidad antes de impuestos positiva para la tasa efectiva.';
    evaReasonEn = 'N/A — requires positive earnings before taxes for the effective rate.';
  } else if (!(capitalEmpleado > 0)) {
    evaReasonEs = 'N/D — capital empleado (activo − pasivo corriente) ≤ 0.';
    evaReasonEn = 'N/A — capital employed (assets − current liabilities) ≤ 0.';
  } else {
    eva = ebit * (1 - tasaEfectiva) - capitalEmpleado * costoCapital;
  }
  const evaPct = eva !== null && capitalEmpleado > 0 ? eva / capitalEmpleado : null;
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
    status: kpiStatus(evaScore),
    severity: kpiSeverity(evaScore),
    descriptionEs:
      evaReasonEs ??
      `NOPAT (EBIT × (1 − tasa efectiva contable)) menos capital empleado × ${((costoCapital ?? 0) * 100).toFixed(1)}% declarado. EVA > 0 = crea valor.`,
    descriptionEn:
      evaReasonEn ??
      `NOPAT (EBIT × (1 − book effective tax rate)) minus capital employed × declared ${((costoCapital ?? 0) * 100).toFixed(1)}%. EVA > 0 = value-creating.`,
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
  if (eva !== null && eva < 0) {
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

  // ─── R7 — Advertencia de costo presunto (callout en Pilar Valor) ─────────
  const presumedCostWarning =
    curatorRes?.presumedCostWarning ?? snapshot.presumedCostWarning ?? undefined;

  const kpis = [margenKpi, roeKpi, evaKpi];
  return {
    pillarId: 'valor',
    healthScore,
    status,
    kpis,
    alerts,
    kpiCoverage: kpiCoverage(kpis),
    generatedAt: new Date().toISOString(),
    ...(presumedCostWarning ? { presumedCostWarning } : {}),
  };
}

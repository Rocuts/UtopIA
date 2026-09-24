// ---------------------------------------------------------------------------
// Pilar VALOR — Rentabilidad y Riqueza
// ---------------------------------------------------------------------------
// KPIs maestros (una sola fórmula con el preprocesador, auditoría 2026-09-24):
//   1. Margen Neto       = controlTotals.margenNeto (utilidad neta / ingresos
//      netos, clase 4 − 4175; nunca la Σ bruta de la clase 4 — ratios-kpis-04).
//      Una reclasificación R1 de balance (sobregiro → pasivo) no toca el P&G:
//      ya no se resta de la utilidad (NM-03: el PDF imprimía dos márgenes).
//   2. ROE Dinámico      = controlTotals.roe (utilidad neta anualizada × 12 /
//      meses del periodo / patrimonio promedio T y T-1), con su N/D y motivo
//      (NM-02: el pilar no anualizaba un corte parcial).
//   3. EVA               = NOPAT − capital empleado × costo de capital DECLARADO
//      NOPAT = EBIT operacional (./ebitda.ts) anualizado con los meses del
//      periodo × (1 − tasa efectiva contable: impuesto causado grupo 54 /
//      UAI). Sin costo de capital declarado, sin UAI > 0, sin meses
//      derivables o con capital empleado ≤ 0 ⇒ N/D (ratios-kpis-25: antes
//      usaba utilidad neta + saldo del pasivo 24 y un 12 % fijo, y con
//      capital ≤ 0 fijaba 'watch').
//   Sin las anclas del preprocesador (snapshots construidos a mano) se aplica
//   la misma fórmula con `shared-metrics.mesesCubiertos`.
//
// Score Valor = weighted (Margen 35%, ROE 35%, EVA 30%) sobre KPIs con dato.
// ---------------------------------------------------------------------------

import { computeEbitda } from './ebitda';
import { ingresosNetosPeriodo, mesesCubiertos, motivoSinMeses } from './shared-metrics';
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
  const meses = mesesCubiertos(snapshot);

  // ─── KPI 1 — Margen Neto ───────────────────────────────────────────────
  // El KPI del preprocesador (post-curator). Las reclasificaciones R1 mueven
  // saldos entre activo y pasivo: no cambian ingresos ni gastos, así que no
  // ajustan la utilidad (NM-03).
  let margenNeto: number | null = null;
  if (ct.margenNeto !== undefined) {
    margenNeto =
      typeof ct.margenNeto === 'number' && Number.isFinite(ct.margenNeto)
        ? ct.margenNeto / 100
        : null;
  } else {
    const ingresosNetos = ingresosNetosPeriodo(ct);
    if (ingresosNetos > 0) margenNeto = ct.utilidadNeta / ingresosNetos;
  }
  const margenScore = kpiToScore(
    margenNeto,
    { healthy: 0.10, watch: 0.05, warning: 0.0 },
    'higher-better',
  );
  const margenKpi: PillarKpi = {
    key: 'margen_neto_real',
    labelEs: 'Margen Neto',
    labelEn: 'Net Margin',
    value: margenNeto,
    unit: 'pct',
    target: 0.10,
    score: margenScore,
    status: kpiStatus(margenScore),
    severity: kpiSeverity(margenScore),
    descriptionEs:
      margenNeto === null
        ? 'N/D — sin ingresos netos del periodo sobre los cuales medir el margen.'
        : 'Utilidad neta sobre ingresos netos de devoluciones (clase 4 − 4175): el mismo margen neto del preprocesador y del informe.',
    descriptionEn:
      margenNeto === null
        ? 'N/A — no net revenue for the period to measure the margin.'
        : 'Net income over revenue net of returns (class 4 − 4175): the same net margin as the preprocessor and the report.',
  };

  // ─── KPI 2 — ROE Dinámico ──────────────────────────────────────────────
  // KPI del preprocesador: anualizado × 12/meses y N/D con motivo cuando la
  // duración del periodo no es derivable o el patrimonio promedio ≤ 0 (NM-02).
  let roe: number | null = null;
  let roeMotivoEs: string | null = null;
  let roeMotivoEn: string | null = null;
  if (ct.roe !== undefined) {
    if (typeof ct.roe === 'number' && Number.isFinite(ct.roe)) {
      roe = ct.roe / 100;
    } else {
      roeMotivoEs = ct.kpiNdMotivos?.roe ?? 'N/D — el preprocesador no publica ROE para este periodo.';
      roeMotivoEn = 'N/A — the preprocessor publishes no ROE for this period.';
    }
  } else {
    const patrimonioPromedio =
      comparative
        ? (ct.patrimonio + comparative.controlTotals.patrimonio) / 2
        : ct.patrimonio;
    if (meses === null) {
      const motivo = motivoSinMeses(snapshot);
      roeMotivoEs = motivo.es;
      roeMotivoEn = motivo.en;
    } else if (patrimonioPromedio > 0) {
      roe = (ct.utilidadNeta * (12 / meses)) / patrimonioPromedio;
    } else {
      roeMotivoEs =
        'N/D — patrimonio promedio ≤ 0 (patrimonio negativo o nulo): el ROE no es interpretable';
      roeMotivoEn = 'N/A — average equity ≤ 0: ROE is not interpretable';
    }
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
    descriptionEs:
      roeMotivoEs ??
      'Rentabilidad anualizada (× 12 / meses del periodo) sobre patrimonio promedio (T y T-1).',
    descriptionEn:
      roeMotivoEn ??
      'Annualized return (× 12 / period months) on average equity (T and T-1).',
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
  } else if (meses === null) {
    // El costo de capital es una tasa anual: el NOPAT del periodo se anualiza
    // con los meses del periodo; sin ellos no hay base comparable.
    const motivo = motivoSinMeses(snapshot);
    evaReasonEs = motivo.es;
    evaReasonEn = motivo.en;
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
    eva = ebit * (12 / meses) * (1 - tasaEfectiva) - capitalEmpleado * costoCapital;
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
      `NOPAT anual (EBIT × 12 / meses × (1 − tasa efectiva contable)) menos capital empleado × ${((costoCapital ?? 0) * 100).toFixed(1)}% declarado. EVA > 0 = crea valor.`,
    descriptionEn:
      evaReasonEn ??
      `Annual NOPAT (EBIT × 12 / months × (1 − book effective tax rate)) minus capital employed × declared ${((costoCapital ?? 0) * 100).toFixed(1)}%. EVA > 0 = value-creating.`,
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

// ---------------------------------------------------------------------------
// Sync Validator — Detector de desincronización Dashboard ↔ Realidad contable
// ---------------------------------------------------------------------------
// Compara los valores que las tarjetas ejecutivas (EBITDA/WAOO/Ratio/FCF) y
// los KPIs maestros del Pilar VALOR PRESENTAN en pantalla, contra el cálculo
// canónico re-derivado del PeriodSnapshot post-Curator. Si hay divergencia
// material entre el dashboard y la "verdad contable", emite un finding y la
// UI puede mostrar una bandera para forzar re-cálculo.
//
// Principios de diseño:
//   - DETERMINÍSTICO: misma entrada → mismo output (no LLM).
//   - NO DESTRUCTIVO: sólo lectura. NO muta `metrics` ni `snapshot`.
//   - TOLERANCIA CALIBRADA: $1.000 COP absolutos para cifras grandes de las
//     tarjetas; 0,1 puntos porcentuales para ratios. La ecuación patrimonial y
//     el patrimonio se comparan en centavos con tolerancia 0, igual que el
//     gate de emisión (auditoria-calidad-29).
//   - `info` es informativo: no rompe `inSync`.
//   - RAÍZ ÚNICA DE VERDAD: el PeriodSnapshot post-Curator (R8 garantiza
//     `controlTotals.utilidadNeta` sincronizada con P&L de clases 4-7).
//   - MISMAS FUNCIONES QUE LAS TARJETAS (ratios-kpis-05/10/15): el valor
//     esperado se recalcula con `computeEbitda` y `shared-metrics`, nunca con
//     fórmulas paralelas (UN + saldo del pasivo 24, UN × 35 %, (11+12)/mes ×
//     30). Las métricas fiscales heurísticas son N/D y no se "verifican".
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';

import { computeEbitda, computeEbitdaMargin } from './ebitda';
import {
  capacidadInversion,
  diasAutonomia,
  ingresosNetosPeriodo,
  pruebaAcida,
} from './shared-metrics';
import type { PillarMetrics, PillarsResult } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SyncSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface SyncFinding {
  /** Identificador estable. Ej: 'EBITDA_DRIFT', 'MARGEN_DRIFT'. */
  code: string;
  severity: SyncSeverity;
  /** Etiqueta del campo afectado (p.ej. "EBITDA", "Margen Neto Real"). */
  field: string;
  /** Valor mostrado en el dashboard. */
  displayed: number | null;
  /** Valor recalculado desde la fuente de verdad. */
  expected: number | null;
  /** displayed − expected. Null si alguno es null. */
  drift: number | null;
  /** Descripción humana legible. */
  messageEs: string;
  messageEn: string;
}

export interface SyncReport {
  /**
   * True si ningún chequeo produjo un hallazgo `warning` o `critical`. Los
   * hallazgos `info` se listan pero no desincronizan el tablero.
   */
  inSync: boolean;
  /** Severidad agregada (peor de los hallazgos). */
  severity: SyncSeverity;
  /** Hallazgos por campo (sólo `info` si inSync=true). */
  findings: SyncFinding[];
  /** Acción sugerida cuando NO está en sync. */
  recommendedActionEs: string;
  recommendedActionEn: string;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Tolerancias (calibradas a CFO colombiano 2026)
// ---------------------------------------------------------------------------

/** Tolerancia absoluta para cifras COP grandes ($1.000 = redondeo aceptable). */
const COP_TOLERANCE = 1_000;

/** Tolerancia para ratios y porcentajes (0,1 puntos porcentuales). */
const RATIO_TOLERANCE = 0.001;

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

export function validateDashboardIntegrity(
  metrics: PillarsResult,
  snapshot: PeriodSnapshot,
): SyncReport {
  const findings: SyncFinding[] = [];

  // ── 1. Tarjetas ejecutivas (EBITDA / WAOO / Ratio / FCF) ────────────────
  const cards = metrics.valor.valorCards;
  if (cards) {
    findings.push(...checkExecutiveCards(cards, snapshot));
  }

  // ── 1b. Tarjetas ejecutivas Escudo (Autonomía / Cobertura / Reserva / Brecha) ──
  const escudoCards = metrics.escudo.escudoCards;
  if (escudoCards) {
    findings.push(...checkEscudoCards(escudoCards, snapshot));
  }

  // ── 1c. Tarjetas ejecutivas Verdad (Ecuación / Consistencia / Anomalías / Salud) ──
  const verdadCards = metrics.verdad.verdadCards;
  if (verdadCards) {
    findings.push(...checkVerdadCards(verdadCards, snapshot));
  }

  // ── 1d. Tarjetas ejecutivas Futuro (CAGR / Punto Quiebre / Prov.Trib / CapEx) ──
  const futuroCards = metrics.futuro.futuroCards;
  if (futuroCards) {
    findings.push(...checkFuturoCards(futuroCards, snapshot));
  }

  // ── 2. KPIs maestros NIIF del Pilar VALOR ────────────────────────────────
  findings.push(...checkValorKpis(metrics.valor, snapshot));

  // ── 3. Ecuación contable global (sanity check post-R8) ──────────────────
  findings.push(...checkAccountingEquation(snapshot));

  // ── 4. Patrimonio sincronizado (controlTotals vs summary) ───────────────
  findings.push(...checkEquityCoherence(snapshot));

  const severity = aggregateSeverity(findings);
  const inSync = severity === 'ok' || severity === 'info';

  return {
    inSync,
    severity,
    findings: findings.filter((f) => f.severity !== 'ok'),
    recommendedActionEs: inSync
      ? 'Dashboard sincronizado con la realidad contable post-Curator.'
      : 'Forzar re-cálculo: vuelve a procesar el balance (botón "Re-procesar") o limpia el caché del workspace.',
    recommendedActionEn: inSync
      ? 'Dashboard in sync with post-Curator accounting reality.'
      : 'Force recompute: re-process the trial balance ("Re-process" button) or clear the workspace cache.',
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Checks individuales
// ---------------------------------------------------------------------------

function checkExecutiveCards(
  cards: NonNullable<PillarMetrics['valorCards']>,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];
  const ct = snapshot.controlTotals;
  const claseGastos = snapshot.classes.find((c) => c.code === 5);
  const claseCostos = snapshot.classes.find((c) => c.code === 6);

  // ── EBITDA (definición única — ./ebitda.ts) ────────────────────────────
  // Sin grupo 41 el EBITDA es N/D: no hay valor esperado contra el cual medir.
  const ebitdaRes = computeEbitda(snapshot);
  const expectedEbitda = ebitdaRes.ebitda;
  const driftEbitda = safeDelta(cards.ebitda.value, expectedEbitda);

  if (driftEbitda !== null && Math.abs(driftEbitda) > COP_TOLERANCE) {
    findings.push({
      code: 'EBITDA_DRIFT',
      severity: 'warning',
      field: 'EBITDA',
      displayed: cards.ebitda.value,
      expected: expectedEbitda,
      drift: driftEbitda,
      messageEs:
        `EBITDA mostrado ($${formatCop(cards.ebitda.value)}) difiere de la utilidad ` +
        `operativa + D&A recalculada ($${formatCop(expectedEbitda)}) por $${formatCop(Math.abs(driftEbitda))}.`,
      messageEn:
        `Displayed EBITDA ($${formatCop(cards.ebitda.value)}) differs from recomputed ` +
        `operating + D&A ($${formatCop(expectedEbitda)}) by $${formatCop(Math.abs(driftEbitda))}.`,
    });
  }

  // ── WAOO / Margen EBITDA (sobre ingresos operacionales netos) ──────────
  const expectedWaoo = computeEbitdaMargin(ebitdaRes);
  const driftWaoo = safeDelta(cards.waoo.value, expectedWaoo);
  if (driftWaoo !== null && Math.abs(driftWaoo) > RATIO_TOLERANCE) {
    findings.push({
      code: 'WAOO_DRIFT',
      severity: 'warning',
      field: 'Margen EBITDA',
      displayed: cards.waoo.value,
      expected: expectedWaoo,
      drift: driftWaoo,
      messageEs:
        `Margen EBITDA mostrado (${formatPct(cards.waoo.value)}) difiere del recalculado ` +
        `(${formatPct(expectedWaoo)}) por ${formatPct(Math.abs(driftWaoo))} pp.`,
      messageEn:
        `Displayed EBITDA Margin (${formatPct(cards.waoo.value)}) differs from recomputed ` +
        `(${formatPct(expectedWaoo)}) by ${formatPct(Math.abs(driftWaoo))} pp.`,
    });
  }

  // ── Ratio Operativo ────────────────────────────────────────────────────
  const totalGastos = claseGastos?.auxiliaryTotal ?? 0;
  const totalCostos = claseCostos?.auxiliaryTotal ?? 0;
  const ingresosNetos = ingresosNetosPeriodo(ct);
  const expectedRatio = ingresosNetos > 0 ? (totalGastos + totalCostos) / ingresosNetos : null;
  const driftRatio = safeDelta(cards.ratio.value, expectedRatio);
  if (driftRatio !== null && Math.abs(driftRatio) > RATIO_TOLERANCE) {
    findings.push({
      code: 'RATIO_DRIFT',
      severity: 'warning',
      field: 'Ratio Operativo',
      displayed: cards.ratio.value,
      expected: expectedRatio,
      drift: driftRatio,
      messageEs:
        `Ratio operativo mostrado (${cards.ratio.value?.toFixed(3)}) difiere del recalculado ` +
        `(${expectedRatio?.toFixed(3) ?? '—'}).`,
      messageEn:
        `Displayed operating ratio (${cards.ratio.value?.toFixed(3)}) differs from recomputed ` +
        `(${expectedRatio?.toFixed(3) ?? '—'}).`,
    });
  }

  // ── Free Cash Flow ─────────────────────────────────────────────────────
  const efe = snapshot.cashFlowIndirecto;
  const expectedFcf =
    efe?.operating.total !== undefined && efe?.investing.varPPE !== undefined
      ? efe.operating.total - Math.abs(efe.investing.varPPE)
      : null;
  const driftFcf = safeDelta(cards.fcf.value, expectedFcf);
  if (driftFcf !== null && Math.abs(driftFcf) > COP_TOLERANCE) {
    findings.push({
      code: 'FCF_DRIFT',
      severity: 'warning',
      field: 'Free Cash Flow',
      displayed: cards.fcf.value,
      expected: expectedFcf,
      drift: driftFcf,
      messageEs:
        `FCF mostrado ($${formatCop(cards.fcf.value)}) difiere del recalculado ` +
        `($${formatCop(expectedFcf)}) por $${formatCop(Math.abs(driftFcf))}.`,
      messageEn:
        `Displayed FCF ($${formatCop(cards.fcf.value)}) differs from recomputed ` +
        `($${formatCop(expectedFcf)}) by $${formatCop(Math.abs(driftFcf))}.`,
    });
  }

  return findings;
}

function checkEscudoCards(
  cards: NonNullable<PillarMetrics['escudoCards']>,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];
  const ct = snapshot.controlTotals;

  // ── Cobertura de Pasivos (prueba ácida — shared-metrics) ───────────────
  // La tarjeta es la prueba ácida sobre controlTotals: (AC − inventarios 14) /
  // PC. Antes se comparaba contra AC / PC (razón corriente) y toda empresa con
  // inventario salía "desincronizada".
  const expectedCobertura = pruebaAcida(ct);
  const driftCobertura = safeDelta(cards.cobertura_pasivos.value, expectedCobertura);
  if (driftCobertura !== null && Math.abs(driftCobertura) > RATIO_TOLERANCE) {
    findings.push({
      code: 'COBERTURA_DRIFT',
      severity: 'warning',
      field: 'Cobertura de Pasivos',
      displayed: cards.cobertura_pasivos.value,
      expected: expectedCobertura,
      drift: driftCobertura,
      messageEs:
        `Cobertura de Pasivos mostrada (${cards.cobertura_pasivos.value?.toFixed(3)}) difiere del recalculado ` +
        `(${expectedCobertura?.toFixed(3) ?? '—'}).`,
      messageEn:
        `Displayed Liability Coverage (${cards.cobertura_pasivos.value?.toFixed(3)}) differs from recomputed ` +
        `(${expectedCobertura?.toFixed(3) ?? '—'}).`,
    });
  }

  // ── Reserva Fiscal ─────────────────────────────────────────────────────
  // Sin check: la tarjeta es N/D por política (ratios-kpis-10). No existe una
  // base fiscal verificada contra la cual recalcularla (antes: UN × 35 %).

  // ── Brecha Escudo ──────────────────────────────────────────────────────
  // = caja(11) − proveedores(2205). Validamos contra el audit.
  const expectedBrecha =
    cards.audit.efectivoCuenta11 - cards.audit.proveedoresCuenta2205;
  const driftBrecha = safeDelta(cards.brecha_escudo.value, expectedBrecha);
  if (driftBrecha !== null && Math.abs(driftBrecha) > COP_TOLERANCE) {
    findings.push({
      code: 'BRECHA_ESCUDO_DRIFT',
      severity: 'warning',
      field: 'Brecha Escudo',
      displayed: cards.brecha_escudo.value,
      expected: expectedBrecha,
      drift: driftBrecha,
      messageEs:
        `Brecha Escudo mostrada ($${formatCop(cards.brecha_escudo.value)}) difiere de la recalculada ` +
        `($${formatCop(expectedBrecha)}) por $${formatCop(Math.abs(driftBrecha))}.`,
      messageEn:
        `Displayed Shield Gap ($${formatCop(cards.brecha_escudo.value)}) differs from recomputed ` +
        `($${formatCop(expectedBrecha)}) by $${formatCop(Math.abs(driftBrecha))}.`,
    });
  }

  // ── Autonomía Financiera (días) — shared-metrics.diasAutonomia ─────────
  // Efectivo PUC 11 (menos CapEx ≤ 6 meses) / egresos diarios del periodo,
  // base 365. Tolerancia de 1 día.
  const expectedAutonomia = diasAutonomia(snapshot, cards.audit.proyectosFuturoCop ?? 0).value;
  if (expectedAutonomia !== null) {
    const driftAutonomia = safeDelta(cards.autonomia.value, expectedAutonomia);
    if (driftAutonomia !== null && Math.abs(driftAutonomia) > 1) {
      findings.push({
        code: 'AUTONOMIA_DRIFT',
        severity: 'info',
        field: 'Autonomía Financiera',
        displayed: cards.autonomia.value,
        expected: expectedAutonomia,
        drift: driftAutonomia,
        messageEs:
          `Días de Autonomía mostrados (${cards.autonomia.value?.toFixed(1)}) difieren del recalculado ` +
          `(${expectedAutonomia.toFixed(1)}).`,
        messageEn:
          `Displayed Days of Runway (${cards.autonomia.value?.toFixed(1)}) differ from recomputed ` +
          `(${expectedAutonomia.toFixed(1)}).`,
      });
    }
  }

  return findings;
}

function checkVerdadCards(
  cards: NonNullable<PillarMetrics['verdadCards']>,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];
  const ct = snapshot.controlTotals;

  // ── Ecuación Maestra ───────────────────────────────────────────────────
  const expectedGap = ct.activo - ct.pasivo - ct.patrimonio;
  const driftEcuacion = safeDelta(cards.ecuacion_maestra.value, expectedGap);
  if (driftEcuacion !== null && Math.abs(driftEcuacion) > COP_TOLERANCE) {
    findings.push({
      code: 'ECUACION_MAESTRA_DRIFT',
      severity: 'critical',
      field: 'Ecuación Maestra',
      displayed: cards.ecuacion_maestra.value,
      expected: expectedGap,
      drift: driftEcuacion,
      messageEs:
        `Ecuación Maestra mostrada ($${formatCop(cards.ecuacion_maestra.value)}) difiere del recalculado ` +
        `($${formatCop(expectedGap)}) por $${formatCop(Math.abs(driftEcuacion))}.`,
      messageEn:
        `Displayed Master Equation ($${formatCop(cards.ecuacion_maestra.value)}) differs from recomputed ` +
        `($${formatCop(expectedGap)}) by $${formatCop(Math.abs(driftEcuacion))}.`,
    });
  }

  // ── Salud Contable (count) ─────────────────────────────────────────────
  // = findingsCriticos*3 + findingsAltos + discrepancias + reclasificaciones.
  const expectedSalud =
    cards.audit.findingsCriticos * 3 +
    cards.audit.findingsAltos +
    cards.audit.discrepanciasPreprocessing +
    cards.audit.reclasificacionesR1;
  const driftSalud = safeDelta(cards.salud_contable.value, expectedSalud);
  if (driftSalud !== null && Math.abs(driftSalud) > 0) {
    findings.push({
      code: 'SALUD_CONTABLE_DRIFT',
      severity: 'warning',
      field: 'Salud Contable',
      displayed: cards.salud_contable.value,
      expected: expectedSalud,
      drift: driftSalud,
      messageEs:
        `Salud Contable mostrada (${cards.salud_contable.value}) difiere del recalculado (${expectedSalud}).`,
      messageEn:
        `Displayed Accounting Health (${cards.salud_contable.value}) differs from recomputed (${expectedSalud}).`,
    });
  }

  // ── Consistencia (score 0-100) — sólo verificamos rango razonable ──────
  if (
    cards.consistencia.value !== null &&
    (cards.consistencia.value < 0 || cards.consistencia.value > 100)
  ) {
    findings.push({
      code: 'CONSISTENCIA_OUT_OF_RANGE',
      severity: 'critical',
      field: 'Consistencia',
      displayed: cards.consistencia.value,
      expected: null,
      drift: null,
      messageEs: `Consistencia fuera de rango [0-100]: ${cards.consistencia.value}.`,
      messageEn: `Consistency out of range [0-100]: ${cards.consistencia.value}.`,
    });
  }

  // ── Anomalías (count) — sanity check vs audit ──────────────────────────
  const expectedAnomalias =
    cards.audit.anomaliasVariacion + (cards.audit.posibleOmisionCostos ? 1 : 0);
  const driftAnomalias = safeDelta(cards.anomalias.value, expectedAnomalias);
  if (driftAnomalias !== null && Math.abs(driftAnomalias) > 0) {
    findings.push({
      code: 'ANOMALIAS_DRIFT',
      severity: 'info',
      field: 'Anomalías de Clasificación',
      displayed: cards.anomalias.value,
      expected: expectedAnomalias,
      drift: driftAnomalias,
      messageEs:
        `Anomalías mostradas (${cards.anomalias.value}) difieren del recalculado (${expectedAnomalias}).`,
      messageEn:
        `Displayed Classification Anomalies (${cards.anomalias.value}) differ from recomputed (${expectedAnomalias}).`,
    });
  }

  // No usamos `snapshot` en estos checks (todo está en `cards.audit`), pero el
  // parámetro queda para simetría con los otros checkers y por si añadimos
  // verificaciones contra el snapshot directamente en el futuro.
  void snapshot;
  return findings;
}

function checkFuturoCards(
  cards: NonNullable<PillarMetrics['futuroCards']>,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];

  // ── Capacidad de Inversión (shared-metrics.capacidadInversion) ─────────
  // Misma función que pilar y tarjeta (ratios-kpis-19). Hoy es N/D sin base
  // fiscal verificada ⇒ no hay valor esperado (antes: caja − UN × 35 % − 60 d).
  const expectedCapInv = capacidadInversion(snapshot).value;
  const driftCapInv = safeDelta(cards.capacidad_inversion.value, expectedCapInv);
  if (driftCapInv !== null && Math.abs(driftCapInv) > COP_TOLERANCE) {
    findings.push({
      code: 'CAPACIDAD_INVERSION_DRIFT',
      severity: 'warning',
      field: 'Capacidad de Inversión',
      displayed: cards.capacidad_inversion.value,
      expected: expectedCapInv,
      drift: driftCapInv,
      messageEs:
        `Capacidad de Inversión mostrada ($${formatCop(cards.capacidad_inversion.value)}) difiere del recalculado ` +
        `($${formatCop(expectedCapInv)}) por $${formatCop(Math.abs(driftCapInv))}.`,
      messageEn:
        `Displayed Investment Capacity ($${formatCop(cards.capacidad_inversion.value)}) differs from recomputed ` +
        `($${formatCop(expectedCapInv)}) by $${formatCop(Math.abs(driftCapInv))}.`,
    });
  }

  // ── Provisión Tributaria Futura ────────────────────────────────────────
  // Sin check: N/D por política (ratios-kpis-10); antes se "verificaba" contra
  // UN proyectada × 35 %.

  // ── CAGR sanity check (rango razonable) ────────────────────────────────
  // CAGR puede ser cualquier valor (incluso negativo), pero >5x o <-1 son sospechosos.
  if (
    cards.cagr.value !== null &&
    (cards.cagr.value > 5 || cards.cagr.value < -0.99)
  ) {
    findings.push({
      code: 'CAGR_OUT_OF_PLAUSIBLE_RANGE',
      severity: 'info',
      field: 'CAGR de Ingresos',
      displayed: cards.cagr.value,
      expected: null,
      drift: null,
      messageEs:
        `CAGR ${formatPct(cards.cagr.value)} fuera de rango plausible. Verificar consistencia de los ingresos comparativos.`,
      messageEn:
        `CAGR ${formatPct(cards.cagr.value)} outside plausible range. Verify consistency of comparative revenue.`,
    });
  }

  // ── Punto de Quiebre vs audit ──────────────────────────────────────────
  // Si audit dice null pero card.value no es null (o viceversa), drift.
  const auditPunto = cards.audit.mesesAlQuiebreConservador;
  const cardPunto = cards.punto_quiebre.value;
  const bothNull = auditPunto === null && cardPunto === null;
  const valuesDiffer =
    !bothNull &&
    (auditPunto === null || cardPunto === null || auditPunto !== cardPunto);
  if (valuesDiffer) {
    findings.push({
      code: 'PUNTO_QUIEBRE_DRIFT',
      severity: 'warning',
      field: 'Punto de Quiebre',
      displayed: cardPunto,
      expected: auditPunto,
      drift: null,
      messageEs:
        `Punto de Quiebre mostrado (${cardPunto ?? 'sin riesgo'}) difiere del audit (${auditPunto ?? 'sin riesgo'}).`,
      messageEn:
        `Displayed Break-even Month (${cardPunto ?? 'no risk'}) differs from audit (${auditPunto ?? 'no risk'}).`,
    });
  }

  return findings;
}

function checkValorKpis(
  valor: PillarMetrics,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];
  const ct = snapshot.controlTotals;

  // Margen Neto (KPI 1) — el mismo KPI del preprocesador (controlTotals.
  // margenNeto = UN / ingresos netos). Desde NM-03 el pilar no ajusta por
  // reclasificaciones R1 (no tocan el P&G): cualquier diferencia es desync.
  const margenKpi = valor.kpis.find((k) => k.key === 'margen_neto_real');
  const ingresosNetos = ingresosNetosPeriodo(ct);
  const expectedMargen =
    typeof ct.margenNeto === 'number' && Number.isFinite(ct.margenNeto)
      ? ct.margenNeto / 100
      : ct.margenNeto === undefined && ingresosNetos > 0
        ? ct.utilidadNeta / ingresosNetos
        : null;
  if (margenKpi && expectedMargen !== null) {
    const drift = safeDelta(margenKpi.value, expectedMargen);
    if (drift !== null && Math.abs(drift) > 1e-9) {
      findings.push({
        code: 'MARGEN_NIIF_DRIFT',
        severity: 'info',
        field: 'Margen Neto (NIIF)',
        displayed: margenKpi.value,
        expected: expectedMargen,
        drift,
        messageEs:
          `Margen Neto mostrado (${formatPct(margenKpi.value)}) difiere del margen neto del ` +
          `preprocesador (${formatPct(expectedMargen)}).`,
        messageEn:
          `Displayed Net Margin (${formatPct(margenKpi.value)}) differs from the preprocessor ` +
          `net margin (${formatPct(expectedMargen)}).`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Ecuación patrimonial y patrimonio — misma regla que el gate de emisión
// ---------------------------------------------------------------------------
// auditoria-calidad-29: estos dos chequeos toleraban max(0,01 % del activo;
// $1.000) y $1.000, mientras V1/V4 de `auditReportEmittable` exigen 0
// centavos. Un descuadre de $999.999 salía "inSync" en el tablero y bloqueado
// en la emisión. Ahora comparan en centavos BigInt con tolerancia 0, con las
// mismas fuentes que V1 (`controlTotals.cents`) y V4 (summary.totalEquity
// redondeado al centavo).

const ZERO_CENTS = BigInt(0);

function pesosToCents(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

function checkAccountingEquation(snapshot: PeriodSnapshot): SyncFinding[] {
  const ct = snapshot.controlTotals;
  const cents = ct.cents;
  const gapCents = cents
    ? cents.activo - cents.pasivo - cents.patrimonio
    : pesosToCents(ct.activo) - pesosToCents(ct.pasivo) - pesosToCents(ct.patrimonio);
  if (gapCents === ZERO_CENTS) return [];
  const gap = Number(gapCents) / 100;

  return [
    {
      code: 'EQUATION_DRIFT',
      severity: 'critical',
      field: 'Ecuación contable',
      displayed: ct.activo - ct.pasivo,
      expected: ct.patrimonio,
      drift: gap,
      messageEs:
        `Ecuación contable descuadrada post-Curator: Activo ($${formatCop(ct.activo)}) ≠ Pasivo + Patrimonio ` +
        `($${formatCop(ct.pasivo + ct.patrimonio)}). Diferencia: ${formatCopFromCents(gapCents)}. R8 Cierre Virtual debió cuadrar al centavo.`,
      messageEn:
        `Accounting equation off post-Curator: Assets ($${formatCop(ct.activo)}) ≠ Liabilities + Equity ` +
        `($${formatCop(ct.pasivo + ct.patrimonio)}). Difference: ${formatCopFromCents(gapCents)}.`,
    },
  ];
}

function checkEquityCoherence(snapshot: PeriodSnapshot): SyncFinding[] {
  const ct = snapshot.controlTotals;
  const patrimonioCents = ct.cents ? ct.cents.patrimonio : pesosToCents(ct.patrimonio);
  const driftCents = patrimonioCents - pesosToCents(snapshot.summary.totalEquity);
  if (driftCents === ZERO_CENTS) return [];
  const drift = Number(driftCents) / 100;

  return [
    {
      code: 'EQUITY_COHERENCE_DRIFT',
      severity: 'warning',
      field: 'Patrimonio (controlTotals vs summary)',
      displayed: snapshot.summary.totalEquity,
      expected: snapshot.controlTotals.patrimonio,
      drift,
      messageEs:
        `controlTotals.patrimonio ($${formatCop(snapshot.controlTotals.patrimonio)}) difiere de ` +
        `summary.totalEquity ($${formatCop(snapshot.summary.totalEquity)}). Posible R8 incompleto.`,
      messageEn:
        `controlTotals.patrimonio ($${formatCop(snapshot.controlTotals.patrimonio)}) differs from ` +
        `summary.totalEquity ($${formatCop(snapshot.summary.totalEquity)}).`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  return curr - prev;
}

function aggregateSeverity(findings: SyncFinding[]): SyncSeverity {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  if (findings.some((f) => f.severity === 'info')) return 'info';
  return 'ok';
}

function formatCop(amount: number | null): string {
  if (amount === null) return '—';
  return Math.abs(amount).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

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
//   - TOLERANCIA CALIBRADA: $1.000 COP absolutos para cifras grandes;
//     0,1 puntos porcentuales para ratios. Por debajo, asumimos redondeo.
//   - RAÍZ ÚNICA DE VERDAD: el PeriodSnapshot post-Curator (R8 garantiza
//     `controlTotals.utilidadNeta` sincronizada con P&L de clases 4-7).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

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
  /** True si TODOS los chequeos pasaron dentro de tolerancia. */
  inSync: boolean;
  /** Severidad agregada (peor de los hallazgos). */
  severity: SyncSeverity;
  /** Hallazgos por campo (vacío si inSync=true). */
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
  const cards = metrics.valor.executiveCards;
  if (cards) {
    findings.push(...checkExecutiveCards(cards, snapshot));
  }

  // ── 1b. Tarjetas ejecutivas Escudo (Autonomía / Cobertura / Reserva / Brecha) ──
  const escudoCards = metrics.escudo.escudoCards;
  if (escudoCards) {
    findings.push(...checkEscudoCards(escudoCards, snapshot));
  }

  // ── 2. KPIs maestros NIIF del Pilar VALOR ────────────────────────────────
  findings.push(...checkValorKpis(metrics.valor, snapshot));

  // ── 3. Ecuación contable global (sanity check post-R8) ──────────────────
  findings.push(...checkAccountingEquation(snapshot));

  // ── 4. Patrimonio sincronizado (controlTotals vs summary) ───────────────
  findings.push(...checkEquityCoherence(snapshot));

  const severity = aggregateSeverity(findings);
  const inSync = severity === 'ok';

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
  cards: NonNullable<PillarMetrics['executiveCards']>,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];
  const ct = snapshot.controlTotals;
  const claseGastos = snapshot.classes.find((c) => c.code === 5);
  const claseCostos = snapshot.classes.find((c) => c.code === 6);

  // ── EBITDA ────────────────────────────────────────────────────────────
  const utilOp = ct.utilidadNeta + ct.impuestosCuenta24;
  const dep = sumByPrefix(claseGastos?.accounts, '5160');
  const amort = sumByPrefix(claseGastos?.accounts, '5165');
  const expectedEbitda = utilOp + dep + amort;
  const driftEbitda = (cards.ebitda.value ?? 0) - expectedEbitda;

  if (Math.abs(driftEbitda) > COP_TOLERANCE) {
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

  // ── WAOO / Margen EBITDA ───────────────────────────────────────────────
  const expectedWaoo = ct.ingresos > 0 ? expectedEbitda / ct.ingresos : null;
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
  const expectedRatio = ct.ingresos > 0 ? (totalGastos + totalCostos) / ct.ingresos : null;
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

  // ── Cobertura de Pasivos ───────────────────────────────────────────────
  // El motor recalcula desde classes con prefijos estrictos 11+12+13 / 21-24,
  // que puede diferir del controlTotals.activoCorriente/pasivoCorriente
  // (que usa grupos más amplios). Aquí validamos contra el audit, que es la
  // fuente exacta del cómputo.
  const expectedCobertura =
    cards.audit.pasivoCorriente > 0
      ? cards.audit.activoCorriente / cards.audit.pasivoCorriente
      : null;
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
  // = provisión24 − utilidadNeta × 35%. Validamos contra impuestosCuenta24
  // y utilidadNeta del snapshot directamente.
  const rentaTeorica = Math.max(0, ct.utilidadNeta * 0.35);
  const expectedReserva = ct.impuestosCuenta24 - rentaTeorica;
  const driftReserva = safeDelta(cards.reserva_fiscal.value, expectedReserva);
  if (driftReserva !== null && Math.abs(driftReserva) > COP_TOLERANCE) {
    findings.push({
      code: 'RESERVA_FISCAL_DRIFT',
      severity: 'warning',
      field: 'Reserva Fiscal',
      displayed: cards.reserva_fiscal.value,
      expected: expectedReserva,
      drift: driftReserva,
      messageEs:
        `Reserva Fiscal mostrada ($${formatCop(cards.reserva_fiscal.value)}) difiere de la recalculada ` +
        `($${formatCop(expectedReserva)}) por $${formatCop(Math.abs(driftReserva))}.`,
      messageEn:
        `Displayed Tax Reserve ($${formatCop(cards.reserva_fiscal.value)}) differs from recomputed ` +
        `($${formatCop(expectedReserva)}) by $${formatCop(Math.abs(driftReserva))}.`,
    });
  }

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

  // ── Autonomía Financiera (días) ─────────────────────────────────────────
  // value = (caja + inversiones12) / promedioEgresosMensuales × 30.
  // Tolerancia más laxa (1 día) porque el cálculo tiene redondeos por mes/30.
  if (cards.audit.promedioEgresosMensuales > 0) {
    const expectedAutonomia =
      ((cards.audit.efectivoCuenta11 + cards.audit.inversionesTemporales12) /
        cards.audit.promedioEgresosMensuales) *
      30;
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

function checkValorKpis(
  valor: PillarMetrics,
  snapshot: PeriodSnapshot,
): SyncFinding[] {
  const findings: SyncFinding[] = [];
  const ct = snapshot.controlTotals;

  // Margen Neto Real (KPI 1) — recalculo simple. Reclass impact se ignora aquí
  // por simplicidad: si difiere de forma material, es desync; si difiere por
  // R1 reclassifications, lo tolera (el dashboard respeta el Curator).
  const margenKpi = valor.kpis.find((k) => k.key === 'margen_neto_real');
  if (margenKpi && ct.ingresos > 0) {
    const expectedMargen = ct.utilidadNeta / ct.ingresos;
    const drift = safeDelta(margenKpi.value, expectedMargen);
    // Tolerancia más laxa (1pp) para acomodar reclass impact de R1.
    if (drift !== null && Math.abs(drift) > 0.01) {
      findings.push({
        code: 'MARGEN_NIIF_DRIFT',
        severity: 'info',
        field: 'Margen Neto Real (NIIF)',
        displayed: margenKpi.value,
        expected: expectedMargen,
        drift,
        messageEs:
          `Margen Neto NIIF mostrado (${formatPct(margenKpi.value)}) difiere del crudo ` +
          `(${formatPct(expectedMargen)}). Probable ajuste por reclasificaciones del Curator (R1).`,
        messageEn:
          `Displayed NIIF Net Margin (${formatPct(margenKpi.value)}) differs from raw ` +
          `(${formatPct(expectedMargen)}). Likely Curator R1 reclassification adjustment.`,
      });
    }
  }

  return findings;
}

function checkAccountingEquation(snapshot: PeriodSnapshot): SyncFinding[] {
  const ct = snapshot.controlTotals;
  const gap = ct.activo - ct.pasivo - ct.patrimonio;
  const tolerance = Math.max(Math.abs(ct.activo) * 0.0001, COP_TOLERANCE);
  if (Math.abs(gap) <= tolerance) return [];

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
        `($${formatCop(ct.pasivo + ct.patrimonio)}). Diferencia: $${formatCop(gap)}. R8 Cierre Virtual debió cuadrar al centavo.`,
      messageEn:
        `Accounting equation off post-Curator: Assets ($${formatCop(ct.activo)}) ≠ Liabilities + Equity ` +
        `($${formatCop(ct.pasivo + ct.patrimonio)}). Difference: $${formatCop(gap)}.`,
    },
  ];
}

function checkEquityCoherence(snapshot: PeriodSnapshot): SyncFinding[] {
  const drift = snapshot.controlTotals.patrimonio - snapshot.summary.totalEquity;
  if (Math.abs(drift) <= COP_TOLERANCE) return [];

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

function sumByPrefix(
  accounts: { code: string; balance: number }[] | undefined,
  prefix: string,
): number {
  if (!accounts) return 0;
  return accounts
    .filter((a) => a.code.startsWith(prefix))
    .reduce((s, a) => s + a.balance, 0);
}

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

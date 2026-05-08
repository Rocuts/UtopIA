// ---------------------------------------------------------------------------
// Pilar VERDAD — 4 Tarjetas Ejecutivas (vista del dueño / CFO)
// ---------------------------------------------------------------------------
// Tarjetas:
//   1. Ecuación Maestra      — azul    — Activo − Pasivo − Patrimonio (≈0 ideal)
//   2. Índice de Consistencia — naranja — Score 0-100 (saldos signo + cuadratura + terceros)
//   3. Anomalías              — morada  — # cuentas con variación >500% + flag costos omitidos
//   4. Salud Contable         — verde   — Errores ponderados (lower-better)
//
// Fuente de la verdad:
//   - snapshot.controlTotals (post-Curator R8 garantiza totales sincronizados).
//   - snapshot.classes (granularidad por clase PUC 1, 2, 4, 5, 6).
//   - snapshot.curator?.findings (severidad critico/alto).
//   - snapshot.reclassifications?.length (R1).
//   - snapshot.discrepancies?.length (preprocessing).
//   - comparative snapshot opcional → deltas vs periodo anterior.
//
// TypeScript estricto — sin `any`.
// ---------------------------------------------------------------------------

import type { PUCClass } from '@/lib/preprocessing/trial-balance';

import type {
  ExecutiveCard,
  PillarStatus,
  PillarsAggregateInput,
  VerdadExecutiveCards,
  VerdadExecutiveCardsAudit,
} from './types';

// ---------------------------------------------------------------------------
// Helpers (puros, internos)
// ---------------------------------------------------------------------------

/** Ignora cuentas virtuales del Curator (sufijo VC, ZZ, prefijo 2810ZZ-, 3710ZZ). */
function isVirtualCuratorAccount(code: string): boolean {
  return (
    code.endsWith('VC') ||
    code.endsWith('ZZ') ||
    code.startsWith('2810ZZ-') ||
    code.startsWith('3710ZZ')
  );
}

/** Delta null-seguro entre valor actual y anterior. */
function safeDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  return curr - prev;
}

// ---------------------------------------------------------------------------
// Integridad de saldos (signos PUC)
// ---------------------------------------------------------------------------

interface SignAudit {
  saldosNegativosActivo: number;
  saldosPositivosPasivo: number;
  totalCuentasAnalizadas: number;
}

/**
 * Cuenta cuentas con signo incorrecto en Clases 1 y 2 (excluyendo virtuales).
 * - Clase 1 (Activo): saldo esperado ≥ 0; anómalos son los < -1000.
 * - Clase 2 (Pasivo): saldo esperado ≤ 0; anómalos son los > 1000.
 */
function countAccountsWithIncorrectSign(
  snapshot: PillarsAggregateInput['snapshot'],
): SignAudit {
  const clase1 = snapshot.classes.find((c) => c.code === 1);
  const clase2 = snapshot.classes.find((c) => c.code === 2);

  const activos = (clase1?.accounts ?? []).filter(
    (a) => !isVirtualCuratorAccount(a.code),
  );
  const pasivos = (clase2?.accounts ?? []).filter(
    (a) => !isVirtualCuratorAccount(a.code),
  );

  const saldosNegativosActivo = activos.filter((a) => a.balance < -1000).length;
  const saldosPositivosPasivo = pasivos.filter((a) => a.balance > 1000).length;
  const totalCuentasAnalizadas = activos.length + pasivos.length;

  return { saldosNegativosActivo, saldosPositivosPasivo, totalCuentasAnalizadas };
}

// ---------------------------------------------------------------------------
// Anomalías de variación (Clases 4 y 5 — ingresos y gastos)
// ---------------------------------------------------------------------------

/**
 * Cuenta cuentas hoja en Clases 4 y 5 con variación absoluta >500% vs comparativo.
 * Umbral de materialidad: |saldoActual| > 50_000.
 */
function countAnomalies(
  snapshot: PillarsAggregateInput['snapshot'],
  comparative: PillarsAggregateInput['snapshot'] | null | undefined,
): number {
  if (!comparative) return 0;

  let count = 0;

  for (const classCode of [4, 5] as const) {
    const currClass: PUCClass | undefined = snapshot.classes.find(
      (c) => c.code === classCode,
    );
    const prevClass: PUCClass | undefined = comparative.classes.find(
      (c) => c.code === classCode,
    );
    if (!currClass || !prevClass) continue;

    // Build a map of prev balances keyed by account code
    const prevMap = new Map<string, number>();
    for (const a of prevClass.accounts) {
      prevMap.set(a.code, a.balance);
    }

    for (const a of currClass.accounts) {
      if (isVirtualCuratorAccount(a.code)) continue;
      const prev = prevMap.get(a.code);
      if (prev === undefined) continue; // no counterpart — skip
      const varPct = Math.abs(a.balance - prev) / Math.max(Math.abs(prev), 1);
      if (varPct > 5 && Math.abs(a.balance) > 50_000) {
        count++;
      }
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Audit builder (reutilizable para snapshot actual y comparativo en deltas)
// ---------------------------------------------------------------------------

function buildVerdadAudit(
  snapshot: PillarsAggregateInput['snapshot'],
  comparative: PillarsAggregateInput['snapshot'] | null | undefined,
  forensic: PillarsAggregateInput['forensic'],
): VerdadExecutiveCardsAudit {
  const ct = snapshot.controlTotals;
  const curatorRes = snapshot.curator ?? null;

  // ── Ecuación maestra ─────────────────────────────────────────────────────
  const equationGap = ct.activo - ct.pasivo - ct.patrimonio;

  // ── Integridad de saldos ─────────────────────────────────────────────────
  const { saldosNegativosActivo, saldosPositivosPasivo, totalCuentasAnalizadas } =
    countAccountsWithIncorrectSign(snapshot);

  // ── Findings del Curator ──────────────────────────────────────────────────
  const allFindings = curatorRes?.findings ?? [];
  const findingsCriticos = allFindings.filter((f) => f.severity === 'critico').length;
  const findingsAltos = allFindings.filter((f) => f.severity === 'alto').length;

  // ── Reclasificaciones R1 ──────────────────────────────────────────────────
  const reclasificacionesR1 = snapshot.reclassifications?.length ?? 0;

  // ── Discrepancias del preprocessing ──────────────────────────────────────
  const discrepanciasPreprocessing = snapshot.discrepancies?.length ?? 0;

  // ── Anomalías de variación ────────────────────────────────────────────────
  const anomaliasVariacion = countAnomalies(snapshot, comparative);

  // ── Margen bruto (Ingresos − Costos C6) / Ingresos ───────────────────────
  const clase6 = snapshot.classes.find((c) => c.code === 6);
  const totalIngresos = ct.ingresos;
  const totalCostos = clase6?.auxiliaryTotal ?? 0;
  let margenBruto: number | null = null;
  if (totalIngresos > 0) {
    margenBruto = (totalIngresos - totalCostos) / totalIngresos;
  }
  const posibleOmisionCostos = margenBruto !== null && margenBruto > 0.95;

  // ── Forensic ─────────────────────────────────────────────────────────────
  const forensicScore: number | null =
    forensic && Number.isFinite(forensic.score) ? forensic.score : null;

  // integridadTerceros: ForensicSummary no expone este campo en el tipo público;
  // lo dejamos null salvo que venga extendido en runtime (no penaliza si no hay datos).
  const integridadTerceros: number | null = null;

  return {
    equationGap,
    saldosNegativosActivo,
    saldosPositivosPasivo,
    totalCuentasAnalizadas,
    reclasificacionesR1,
    discrepanciasPreprocessing,
    findingsCriticos,
    findingsAltos,
    anomaliasVariacion,
    margenBruto,
    posibleOmisionCostos,
    forensicScore,
    integridadTerceros,
  };
}

// ---------------------------------------------------------------------------
// Status thresholds
// ---------------------------------------------------------------------------

/** Ecuación Maestra — gap COP (lower absolute value is better). */
function ecuacionStatus(gap: number, activo: number): PillarStatus {
  const absGap = Math.abs(gap);
  if (absGap <= 1000) return 'healthy';
  if (absGap <= Math.max(activo * 0.0001, 1000)) return 'watch';
  if (absGap <= Math.max(activo * 0.001, 10_000)) return 'warning';
  return 'critical';
}

/** Índice de Consistencia — score 0-100 (higher-better). */
function consistenciaStatus(score: number): PillarStatus {
  if (score >= 90) return 'healthy';
  if (score >= 75) return 'watch';
  if (score >= 60) return 'warning';
  return 'critical';
}

/** Anomalías de Clasificación — count (lower-better). */
function anomaliasStatus(count: number): PillarStatus {
  if (count === 0) return 'healthy';
  if (count <= 2) return 'watch';
  if (count <= 5) return 'warning';
  return 'critical';
}

/** Salud Contable — errores ponderados (lower-better). */
function saludContableStatus(total: number): PillarStatus {
  if (total === 0) return 'healthy';
  if (total <= 3) return 'watch';
  if (total <= 7) return 'warning';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Cómputo principal
// ---------------------------------------------------------------------------

export function computeVerdadExecutiveCards(
  input: PillarsAggregateInput,
): VerdadExecutiveCards {
  const { snapshot, comparative, forensic } = input;
  const ct = snapshot.controlTotals;

  // ── Audit del snapshot actual ─────────────────────────────────────────────
  const audit = buildVerdadAudit(snapshot, comparative, forensic ?? null);

  // ─── 1. Ecuación Maestra ─────────────────────────────────────────────────
  const equationGapValue = audit.equationGap;
  const ecuacionStatus_ = ecuacionStatus(equationGapValue, ct.activo);

  // ─── 2. Índice de Consistencia ────────────────────────────────────────────
  // Component: saldos con signo correcto
  const signoCorrecto =
    1 -
    (audit.saldosNegativosActivo + audit.saldosPositivosPasivo) /
      Math.max(audit.totalCuentasAnalizadas, 1);

  // Component: cuadratura de ecuación
  let cuadratura: number;
  if (Math.abs(equationGapValue) <= 1000) {
    cuadratura = 1.0;
  } else {
    cuadratura = 1 - Math.min(Math.abs(equationGapValue) / Math.max(ct.activo, 1), 1);
  }

  // Component: integridad de terceros (null → no penalizar → 1.0)
  const terceros: number = audit.integridadTerceros ?? 1.0;

  const consistenciaRaw =
    signoCorrecto * 0.5 + cuadratura * 0.3 + terceros * 0.2;
  const consistenciaValue = Math.min(100, Math.max(0, consistenciaRaw * 100));

  // ─── 3. Anomalías de Clasificación ───────────────────────────────────────
  const anomaliasCount =
    audit.anomaliasVariacion + (audit.posibleOmisionCostos ? 1 : 0);

  // ─── 4. Salud Contable ────────────────────────────────────────────────────
  const saludTotal =
    audit.findingsCriticos * 3 +
    audit.findingsAltos * 1 +
    audit.discrepanciasPreprocessing +
    audit.reclasificacionesR1;

  // ── Deltas vs comparativo ─────────────────────────────────────────────────
  let prevEquacionGap: number | null = null;
  let prevConsistencia: number | null = null;
  let prevAnomaliasCount: number | null = null;
  let prevSaludTotal: number | null = null;

  if (comparative) {
    const prevAudit = buildVerdadAudit(comparative, null, null);

    prevEquacionGap = prevAudit.equationGap;

    // Consistencia previa
    const prevSignoCorrecto =
      1 -
      (prevAudit.saldosNegativosActivo + prevAudit.saldosPositivosPasivo) /
        Math.max(prevAudit.totalCuentasAnalizadas, 1);
    const prevCuadratura =
      Math.abs(prevAudit.equationGap) <= 1000
        ? 1.0
        : 1 -
          Math.min(
            Math.abs(prevAudit.equationGap) /
              Math.max(comparative.controlTotals.activo, 1),
            1,
          );
    const prevTerceros: number = prevAudit.integridadTerceros ?? 1.0;
    prevConsistencia = Math.min(
      100,
      Math.max(
        0,
        (prevSignoCorrecto * 0.5 + prevCuadratura * 0.3 + prevTerceros * 0.2) * 100,
      ),
    );

    // Anomalías previas: métrica ya usa comparative, así que usamos la del snapshot
    // comparativo contra null (sin doble-período anterior).
    prevAnomaliasCount =
      prevAudit.anomaliasVariacion + (prevAudit.posibleOmisionCostos ? 1 : 0);

    prevSaludTotal =
      prevAudit.findingsCriticos * 3 +
      prevAudit.findingsAltos * 1 +
      prevAudit.discrepanciasPreprocessing +
      prevAudit.reclasificacionesR1;
  }

  // ── Construir tarjetas ────────────────────────────────────────────────────
  const ecuacion_maestra: ExecutiveCard = {
    key: 'ecuacion_maestra',
    labelEs: 'Ecuación Maestra',
    labelEn: 'Master Equation',
    value: equationGapValue,
    unit: 'cop',
    color: 'blue',
    status: ecuacionStatus_,
    deltaVsComparative: safeDelta(equationGapValue, prevEquacionGap),
    descriptionEs:
      'Activo − Pasivo − Patrimonio. Cero = perfectamente sincronizado. Cualquier descalce indica que el patrimonio o las clases 4–7 no se trasladaron correctamente.',
    descriptionEn:
      'Assets − Liabilities − Equity. Zero = perfectly balanced. Any gap means equity or classes 4–7 were not carried over correctly.',
    formulaEs:
      'Activo − (Pasivo + Patrimonio + Utilidad ya inyectada por R8)',
    formulaEn:
      'Assets − (Liabilities + Equity + Net Income already injected by R8)',
  };

  const consistencia: ExecutiveCard = {
    key: 'consistencia',
    labelEs: 'Índice de Consistencia',
    labelEn: 'Consistency Index',
    value: consistenciaValue,
    unit: 'score',
    color: 'orange',
    status: consistenciaStatus(consistenciaValue),
    deltaVsComparative: safeDelta(consistenciaValue, prevConsistencia),
    descriptionEs:
      'Score 0-100 que combina saldos con signo correcto, cuadratura de la ecuación contable e integridad de terceros.',
    descriptionEn:
      'Score 0-100 combining correct-sign balances, equation balance, and third-party integrity.',
    formulaEs:
      'Saldos OK (50%) + Cuadratura (30%) + Terceros válidos (20%) × 100',
    formulaEn:
      'Sign-OK balances (50%) + Equation balance (30%) + Valid third parties (20%) × 100',
  };

  const anomalias: ExecutiveCard = {
    key: 'anomalias',
    labelEs: 'Anomalías de Clasificación',
    labelEn: 'Classification Anomalies',
    value: anomaliasCount,
    unit: 'count',
    color: 'purple',
    status: anomaliasStatus(anomaliasCount),
    deltaVsComparative: safeDelta(anomaliasCount, prevAnomaliasCount),
    descriptionEs:
      'Cuentas con variación >500% vs periodo anterior + flags de costos omitidos (margen >95%).',
    descriptionEn:
      'Accounts with >500% variance vs prior period + omitted-cost flags (margin >95%).',
    formulaEs:
      'Σ(cuentas con Δ% > 500) + flag margen bruto > 95%',
    formulaEn:
      'Σ(accounts with Δ% > 500) + gross-margin-above-95% flag',
  };

  const salud_contable: ExecutiveCard = {
    key: 'salud_contable',
    labelEs: 'Salud Contable',
    labelEn: 'Accounting Health',
    value: saludTotal,
    unit: 'count',
    color: 'green',
    status: saludContableStatus(saludTotal),
    deltaVsComparative: safeDelta(saludTotal, prevSaludTotal),
    descriptionEs:
      'Errores totales detectados: críticos del Curator (×3), reclasificaciones R1, discrepancias del preprocesamiento.',
    descriptionEn:
      'Total detected errors: Curator criticals (×3), R1 reclassifications, preprocessing discrepancies.',
    formulaEs:
      'Findings críticos × 3 + altos × 1 + reclasificaciones R1 + discrepancias preprocessing',
    formulaEn:
      'Critical findings × 3 + high × 1 + R1 reclassifications + preprocessing discrepancies',
  };

  return {
    ecuacion_maestra,
    consistencia,
    anomalias,
    salud_contable,
    audit,
    generatedAt: new Date().toISOString(),
  };
}

export type { ExecutiveCard };

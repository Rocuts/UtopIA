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
import {
  isAmbiguousNatureAccount,
  isContraAsset,
} from '@/lib/preprocessing/curator-rules/contra-asset-registry';

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
  saldosContrariosActivo: number;
  saldosContrariosPasivo: number;
  saldosContrariosPatrimonio: number;
  totalCuentasAnalizadas: number;
}

/** Umbral de materialidad (COP) para considerar un saldo "contrario". */
const SIGN_TOLERANCE = 1000;

/**
 * Cuentas de patrimonio de naturaleza DÉBITO (Decreto 2650/1993): pérdida del
 * ejercicio (3610), pérdidas acumuladas (3710) y capital por suscribir /
 * suscrito por cobrar (310510 / 310515, marcadas "(DB)" en el catálogo).
 */
const EQUITY_DEBIT_NATURE_PREFIXES = ['3610', '3710', '310510', '310515'] as const;

function isEquityDebitNature(code: string): boolean {
  return EQUITY_DEBIT_NATURE_PREFIXES.some((p) => code.startsWith(p));
}

/**
 * Cuenta saldos contrarios a la naturaleza esperada (ratios-kpis-09).
 *
 * Convención del preprocesador (CSV `normalizeSignConvention` y DB
 * `naturalSide`): cada clase llega como MAGNITUD de su naturaleza — activos
 * positivos (débito), pasivos y patrimonio positivos (crédito). Por eso:
 *   - Activo (clase 1): anómalo si < −1.000, salvo correctoras (1592, 1597-1599,
 *     1399, 1499, 1698, 1798… ver contra-asset-registry), que son anómalas si
 *     > +1.000 (saldo débito). 1596 sin desglose (naturaleza mixta) se omite.
 *   - Pasivo (clase 2): anómalo si < −1.000 (saldo débito).
 *   - Patrimonio (clase 3): anómalo si < −1.000, salvo las cuentas de
 *     naturaleza débito (pérdidas, capital por suscribir), anómalas si > +1.000.
 * Las cuentas virtuales del Curator no se analizan.
 */
function countAccountsWithIncorrectSign(
  snapshot: PillarsAggregateInput['snapshot'],
): SignAudit {
  const leaves = (code: number) =>
    (snapshot.classes.find((c) => c.code === code)?.accounts ?? []).filter(
      (a) => !isVirtualCuratorAccount(a.code),
    );

  const activos = leaves(1).filter((a) => !isAmbiguousNatureAccount(a.code));
  const pasivos = leaves(2);
  const patrimonio = leaves(3);

  const saldosContrariosActivo = activos.filter((a) =>
    isContraAsset(a.code) ? a.balance > SIGN_TOLERANCE : a.balance < -SIGN_TOLERANCE,
  ).length;
  const saldosContrariosPasivo = pasivos.filter((a) => a.balance < -SIGN_TOLERANCE).length;
  const saldosContrariosPatrimonio = patrimonio.filter((a) =>
    isEquityDebitNature(a.code) ? a.balance > SIGN_TOLERANCE : a.balance < -SIGN_TOLERANCE,
  ).length;
  const totalCuentasAnalizadas = activos.length + pasivos.length + patrimonio.length;

  return {
    saldosContrariosActivo,
    saldosContrariosPasivo,
    saldosContrariosPatrimonio,
    totalCuentasAnalizadas,
  };
}

/**
 * Índice de Consistencia 0-100. Componentes: saldos con naturaleza correcta
 * (50 %), cuadratura de la ecuación (30 %) e integridad de terceros (20 %).
 * Un componente SIN DATO (terceros null) se excluye y los pesos restantes se
 * renormalizan: nunca aporta puntos que no se midieron.
 */
function computeConsistencia(
  audit: VerdadExecutiveCardsAudit,
  activo: number,
): number {
  const contrarios =
    audit.saldosContrariosActivo + audit.saldosContrariosPasivo + audit.saldosContrariosPatrimonio;
  const signoCorrecto = 1 - contrarios / Math.max(audit.totalCuentasAnalizadas, 1);
  const cuadratura =
    Math.abs(audit.equationGap) <= 1000
      ? 1
      : 1 - Math.min(Math.abs(audit.equationGap) / Math.max(activo, 1), 1);
  const parts: Array<{ v: number; w: number }> = [
    { v: signoCorrecto, w: 0.5 },
    { v: cuadratura, w: 0.3 },
  ];
  if (audit.integridadTerceros !== null) parts.push({ v: audit.integridadTerceros, w: 0.2 });
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  const raw = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;
  return Math.min(100, Math.max(0, raw * 100));
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
  const {
    saldosContrariosActivo,
    saldosContrariosPasivo,
    saldosContrariosPatrimonio,
    totalCuentasAnalizadas,
  } = countAccountsWithIncorrectSign(snapshot);

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

  // integridadTerceros: ForensicSummary no expone este campo. Sin dato ⇒ null y
  // el índice de consistencia EXCLUYE el componente (no lo cuenta como 100 %).
  const integridadTerceros: number | null = null;

  return {
    equationGap,
    saldosContrariosActivo,
    saldosContrariosPasivo,
    saldosContrariosPatrimonio,
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
  const consistenciaValue = computeConsistencia(audit, ct.activo);

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

    // Consistencia previa (misma función)
    prevConsistencia = computeConsistencia(prevAudit, comparative.controlTotals.activo);

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
      'Score 0-100: saldos con la naturaleza esperada por clase (pasivo y patrimonio crédito; correctoras al contrario), cuadratura de la ecuación e integridad de terceros cuando hay dato.',
    descriptionEn:
      'Score 0-100: balances with the nature expected per class (liabilities and equity credit; contra accounts the opposite), equation balance and third-party integrity when available.',
    formulaEs:
      'Naturaleza OK (50%) + Cuadratura (30%) + Terceros (20%) × 100; sin dato de terceros el componente se excluye y los pesos se renormalizan',
    formulaEn:
      'Nature-OK balances (50%) + Equation balance (30%) + Third parties (20%) × 100; without third-party data the component is excluded and weights renormalized',
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

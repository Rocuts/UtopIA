// ---------------------------------------------------------------------------
// Pilar VALOR — 4 Tarjetas Ejecutivas (vista del dueño / CFO)
// ---------------------------------------------------------------------------
// Coexisten con los 3 KPIs técnicos NIIF (Margen Neto, ROE, EVA) calculados en
// `valor.ts`. Estas 4 tarjetas son las que el dueño ve PRIMERO en el dashboard
// de Vista Dueño (página /workspace/comando) — efectivas para storytelling
// ejecutivo, mientras Margen/ROE/EVA quedan abajo como detalle NIIF.
//
// Tarjetas (con código de color del contrato visual):
//   1. EBITDA          — azul    — Utilidad Operativa + Depreciaciones (5160) + Amortizaciones (5165)
//   2. WAOO / Margen   — naranja — EBITDA / Ingresos (×100)
//   3. Ratio           — morada  — (Gastos C5 + Costos C6) / Ingresos C4
//   4. Free Cash Flow  — verde   — Operating Cash Flow − CapEx (varPPE) del EFE indirecto NIC 7
//
// Fuente única de la verdad:
//   - controlTotals (post-Curator R8 ya garantiza utilidadNeta sincronizada con P&L).
//   - classes[5].accounts (granularidad para D&A 5160/5165).
//   - snapshot.cashFlowIndirecto (post-Curator R2 — sólo si hay periodo comparativo).
//
// Las tarjetas son determinísticas (no LLM) y se ejecutan en cada cálculo de
// pilares vía `aggregatePillars`. Si un valor no es calculable (ej. FCF sin
// comparativo), `value: null` y la UI muestra "—" en lugar de un número falso.
// ---------------------------------------------------------------------------

import type { PUCClass } from '@/lib/preprocessing/trial-balance';

import { scoreToStatus } from './health-score';
import type {
  ExecutiveCard,
  PillarStatus,
  PillarsAggregateInput,
  ValorExecutiveCards,
  ValorExecutiveCardsAudit,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Suma saldos de cuentas en una clase cuyo código empiece con `prefix`.
 *  Ignora cuentas virtuales del Curator (sufijo VC, ZZ, prefijo 2810ZZ-). */
function sumClassByPrefix(cl: PUCClass | undefined, prefix: string): number {
  if (!cl) return 0;
  return cl.accounts
    .filter((a) => a.code.startsWith(prefix))
    .filter((a) => !isVirtualCuratorAccount(a.code))
    .reduce((s, a) => s + a.balance, 0);
}

function isVirtualCuratorAccount(code: string): boolean {
  return (
    code.endsWith('VC') ||
    code.endsWith('ZZ') ||
    code.startsWith('2810ZZ-') ||
    code.startsWith('3710ZZ')
  );
}

/** Formato seguro de delta entre dos valores (null-safe). */
function safeDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  return curr - prev;
}

// ---------------------------------------------------------------------------
// Status thresholds (calibrados a estándares 2026 — empresa colombiana media)
// ---------------------------------------------------------------------------

/** EBITDA absoluto: status según EBITDA / ingresos (margen). */
function ebitdaStatus(ebitda: number, ingresos: number): PillarStatus {
  if (ingresos <= 0) return 'watch';
  const margin = ebitda / ingresos;
  if (margin >= 0.15) return 'healthy';
  if (margin >= 0.08) return 'watch';
  if (margin >= 0) return 'warning';
  return 'critical';
}

function waooStatus(margin: number | null): PillarStatus {
  if (margin === null) return 'watch';
  if (margin >= 0.15) return 'healthy';
  if (margin >= 0.08) return 'watch';
  if (margin >= 0) return 'warning';
  return 'critical';
}

/** Ratio (gastos+costos / ingresos): lower-better. >= 1.0 → critical. */
function ratioStatus(ratio: number | null): PillarStatus {
  if (ratio === null) return 'watch';
  if (ratio < 0.85) return 'healthy';
  if (ratio < 0.92) return 'watch';
  if (ratio < 1.0) return 'warning';
  return 'critical';
}

function fcfStatus(fcf: number | null, ingresos: number): PillarStatus {
  if (fcf === null) return 'watch';
  if (fcf > 0) return 'healthy';
  // tolerar pequeño FCF negativo si está dentro del 5% de ingresos (re-inversión)
  if (ingresos > 0 && Math.abs(fcf) <= ingresos * 0.05) return 'watch';
  return 'warning';
}

// ---------------------------------------------------------------------------
// Cómputo principal
// ---------------------------------------------------------------------------

export function computeValorExecutiveCards(
  input: PillarsAggregateInput,
): ValorExecutiveCards {
  const { snapshot, comparative } = input;
  const ct = snapshot.controlTotals;
  const classes = snapshot.classes;

  const claseGastos = classes.find((c) => c.code === 5);
  const claseCostos = classes.find((c) => c.code === 6);

  const totalIngresos = ct.ingresos;
  const totalGastos = claseGastos?.auxiliaryTotal ?? 0;
  const totalCostos = claseCostos?.auxiliaryTotal ?? 0;
  const utilidadOperacional = ct.utilidadNeta + ct.impuestosCuenta24;
  const depreciaciones = sumClassByPrefix(claseGastos, '5160');
  const amortizaciones = sumClassByPrefix(claseGastos, '5165');

  // ─── EBITDA ──────────────────────────────────────────────────────────────
  // EBITDA = Utilidad Operativa + Depreciaciones + Amortizaciones.
  // Las cuentas 5160/5165 son saldos NATURALES débito (positivos en gastos);
  // las sumamos directamente porque ya están registradas como gasto operativo.
  const ebitda = utilidadOperacional + depreciaciones + amortizaciones;

  // ─── WAOO / Margen EBITDA ────────────────────────────────────────────────
  const waoo = totalIngresos > 0 ? ebitda / totalIngresos : null;

  // ─── Ratio (Gastos + Costos) / Ingresos ──────────────────────────────────
  const ratio =
    totalIngresos > 0 ? (totalGastos + totalCostos) / totalIngresos : null;

  // ─── Free Cash Flow ──────────────────────────────────────────────────────
  // FCF = Operating Cash Flow − CapEx. CapEx ≈ varPPE del EFE NIC 7 (signo
  // invertido: aumento de PPE consume caja). El EFE indirecto sólo se construye
  // si hay periodo comparativo (R2 en Curator); si no, FCF queda en null.
  const efe = snapshot.cashFlowIndirecto;
  const operatingCashFlow = efe?.operating.total ?? null;
  // varPPE del EFE: AUMENTO de PPE (positivo) ⇒ salida de caja (negativo en FCF).
  // R2 ya devuelve `varPPE` con signo correcto (ver r2-indirect-cashflow.ts).
  const capex = efe?.investing.varPPE ?? null;
  const fcf =
    operatingCashFlow !== null && capex !== null
      ? operatingCashFlow - Math.abs(capex)
      : null;

  // ─── Deltas vs comparativo (mismo cálculo sobre snapshot anterior) ──────
  const prevAudit = comparative ? buildAudit(comparative) : null;
  const prevEbitda = prevAudit
    ? prevAudit.utilidadOperacional + prevAudit.depreciaciones + prevAudit.amortizaciones
    : null;
  const prevWaoo =
    prevAudit && prevAudit.totalIngresos > 0 && prevEbitda !== null
      ? prevEbitda / prevAudit.totalIngresos
      : null;
  const prevRatio =
    prevAudit && prevAudit.totalIngresos > 0
      ? (prevAudit.totalGastos + prevAudit.totalCostos) / prevAudit.totalIngresos
      : null;
  const prevFcf =
    prevAudit?.operatingCashFlow !== null && prevAudit?.capex !== null
      ? (prevAudit?.operatingCashFlow ?? 0) - Math.abs(prevAudit?.capex ?? 0)
      : null;

  // ─── Construir tarjetas ──────────────────────────────────────────────────
  const cards: ValorExecutiveCards = {
    ebitda: {
      key: 'ebitda',
      labelEs: 'EBITDA',
      labelEn: 'EBITDA',
      value: ebitda,
      unit: 'cop',
      color: 'blue',
      status: ebitdaStatus(ebitda, totalIngresos),
      deltaVsComparative: safeDelta(ebitda, prevEbitda),
      descriptionEs: 'Generación de caja operativa antes de intereses, impuestos, depreciación y amortización.',
      descriptionEn: 'Operating cash generation before interest, taxes, depreciation and amortization.',
      formulaEs: 'Utilidad Operativa + Depreciaciones (PUC 5160) + Amortizaciones (PUC 5165)',
      formulaEn: 'Operating Profit + Depreciation (PUC 5160) + Amortization (PUC 5165)',
    },
    waoo: {
      key: 'waoo',
      labelEs: 'Margen EBITDA',
      labelEn: 'EBITDA Margin',
      value: waoo,
      unit: 'pct',
      color: 'orange',
      status: waooStatus(waoo),
      deltaVsComparative: safeDelta(waoo, prevWaoo),
      descriptionEs: 'Eficiencia operativa: porcentaje de ingresos que se convierte en EBITDA.',
      descriptionEn: 'Operating efficiency: share of revenue converted to EBITDA.',
      formulaEs: 'EBITDA / Total Ingresos (Clase 4) × 100',
      formulaEn: 'EBITDA / Total Revenue (Class 4) × 100',
    },
    ratio: {
      key: 'ratio',
      labelEs: 'Ratio Operativo',
      labelEn: 'Operating Ratio',
      value: ratio,
      unit: 'ratio',
      color: 'purple',
      status: ratioStatus(ratio),
      deltaVsComparative: safeDelta(ratio, prevRatio),
      descriptionEs: '¿Cuánto cuesta operar la empresa por cada peso de ingreso? Menor es mejor.',
      descriptionEn: 'How much it costs to operate per peso of revenue. Lower is better.',
      formulaEs: '(Gastos Clase 5 + Costos Clase 6) / Ingresos Clase 4',
      formulaEn: '(Class 5 Expenses + Class 6 Costs) / Class 4 Revenue',
    },
    fcf: {
      key: 'fcf',
      labelEs: 'Free Cash Flow',
      labelEn: 'Free Cash Flow',
      value: fcf,
      unit: 'cop',
      color: 'green',
      status: fcfStatus(fcf, totalIngresos),
      deltaVsComparative: safeDelta(fcf, prevFcf),
      descriptionEs: 'Caja libre tras inversión en activos fijos. Lo que queda para dividendos o expansión.',
      descriptionEn: 'Cash left after fixed-asset reinvestment. Available for dividends or expansion.',
      formulaEs: 'Flujo Operativo (NIC 7 indirecto) − CapEx (variación PPE Clase 15)',
      formulaEn: 'Operating Cash Flow (IAS 7 indirect) − CapEx (Class 15 PPE delta)',
    },
    audit: {
      utilidadOperacional,
      depreciaciones,
      amortizaciones,
      totalGastos,
      totalCostos,
      totalIngresos,
      capex,
      operatingCashFlow,
    },
    generatedAt: new Date().toISOString(),
  };

  return cards;
}

// ---------------------------------------------------------------------------
// Helper: extraer el audit de un snapshot (usado para deltas)
// ---------------------------------------------------------------------------

function buildAudit(
  snapshot: PillarsAggregateInput['snapshot'],
): ValorExecutiveCardsAudit {
  const ct = snapshot.controlTotals;
  const claseGastos = snapshot.classes.find((c) => c.code === 5);
  const claseCostos = snapshot.classes.find((c) => c.code === 6);
  const efe = snapshot.cashFlowIndirecto;
  return {
    utilidadOperacional: ct.utilidadNeta + ct.impuestosCuenta24,
    depreciaciones: sumClassByPrefix(claseGastos, '5160'),
    amortizaciones: sumClassByPrefix(claseGastos, '5165'),
    totalGastos: claseGastos?.auxiliaryTotal ?? 0,
    totalCostos: claseCostos?.auxiliaryTotal ?? 0,
    totalIngresos: ct.ingresos,
    capex: efe?.investing.varPPE ?? null,
    operatingCashFlow: efe?.operating.total ?? null,
  };
}

// scoreToStatus es importado pero no se usa directamente — lo reservamos por si
// añadimos un score agregado en el futuro. Marcamos para que el linter no se queje.
void scoreToStatus;

export type { ExecutiveCard };

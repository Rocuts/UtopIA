// ---------------------------------------------------------------------------
// ELITE Pulido Diamante — verificación E2E del Curator (R1+R5+R6+R7).
// ---------------------------------------------------------------------------
// Lee el fixture sintético del CFO (`elite-pulido-diamante.csv`), corre
// `preprocessTrialBalance` (que internamente ejecuta `runCurator`), y verifica
// las 5 cuadraturas que el contrato Pulido Diamante exige al centavo:
//
//   1. R1 — al menos una reclasificación aplicada (saldo negativo material
//      en activo movido a cuenta virtual `2810ZZ-<originalCode>` en Pasivo).
//   2. R5 — anclaje patrimonial Balance↔ECP, gap absorbido en
//      Resultados Acumulados.
//   3. R6 — cierre EFE↔caja PUC 11 al centavo.
//   4. R7 — advertencia de costo presunto cuando margen > 85% y
//      inventario > 50% × ingresos.
//   5. Ecuación post-Curator: Activo = Pasivo + Patrimonio (al centavo).
//
// El fixture se diseñó con descuadres deliberados para activar las 4 reglas
// (R1, R5, R6, R7) en un solo balance de prueba multiperiodo (2024 → 2025).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '../trial-balance';

const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  '__fixtures__',
  'elite-pulido-diamante.csv',
);

function loadSnapshot() {
  const csv = readFileSync(FIXTURE_PATH, 'utf-8');
  const rows = parseTrialBalanceCSV(csv);
  if (rows.length === 0) {
    throw new Error(
      `Fixture parser devolvió 0 filas — revisar headers del CSV (${FIXTURE_PATH}).`,
    );
  }
  const result = preprocessTrialBalance(rows);
  if (!result.primary) {
    throw new Error('preprocessTrialBalance no produjo snapshot primario.');
  }
  if (result.primary.period !== '2025') {
    throw new Error(
      `Periodo primario esperado "2025", recibido "${result.primary.period}".`,
    );
  }
  if (!result.primary.curator) {
    throw new Error(
      'Curator no fue inyectado en el snapshot — revisar `preprocessTrialBalance`.',
    );
  }
  return result;
}

describe('ELITE Pulido Diamante — Curator E2E sobre fixture sintético', () => {
  // -------------------------------------------------------------------------
  // ASERCIÓN 1 — R1: reclasificación de saldos negativos en activos.
  // -------------------------------------------------------------------------
  it('Cuadratura 1 — R1 reclasifica 120505 (-$50M) a 2810ZZ-120505 con applied:true', () => {
    const result = loadSnapshot();
    const snap = result.primary;
    const reclas = snap.curator!.reclassifications;

    expect(reclas.length).toBeGreaterThanOrEqual(1);

    const r120505 = reclas.find((r) => r.accountCode === '120505');
    expect(
      r120505,
      `Esperaba reclasificación para 120505. Recibido: ${reclas
        .map((r) => r.accountCode)
        .join(', ')}`,
    ).toBeDefined();
    expect(r120505!.applied).toBe(true);
    expect(r120505!.effectiveTransferCop).toBe(50_000_000);
    expect(r120505!.reclassifiedToCode).toBe('2810ZZ-120505');

    // La cuenta virtual debe estar en Clase 2 con balance = $50M.
    const class2 = snap.classes.find((c) => c.code === 2);
    expect(class2, 'Clase 2 (Pasivo) ausente del snapshot').toBeDefined();
    const virtual = class2!.accounts.find((a) => a.code === '2810ZZ-120505');
    expect(
      virtual,
      `Esperaba cuenta virtual 2810ZZ-120505 en Clase 2. Recibidas: ${class2!.accounts
        .map((a) => a.code)
        .join(', ')}`,
    ).toBeDefined();
    expect(virtual!.balance).toBe(50_000_000);

    // La cuenta original debe haber quedado en 0 (mutación de R1).
    const class1 = snap.classes.find((c) => c.code === 1);
    const original = class1!.accounts.find((a) => a.code === '120505');
    expect(original?.balance).toBe(0);
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 2 — R5: anclaje patrimonial Balance↔ECP.
  // -------------------------------------------------------------------------
  it('Cuadratura 2 — R5 absorbe gap ECP↔Balance ≈ $1.572B y ancla controlTotals.patrimonio', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const adj = snap.curator!.convergenceAdjustment;
    expect(
      adj,
      'R5 no produjo convergenceAdjustment — la cuenta 379505 (-$1.572B) debería disparar el gap.',
    ).toBeDefined();

    // gapCop ≈ $1.572B con tolerancia $1K (R1 mueve activos pero NO patrimonio,
    // así que el gap original sigue siendo 1.572B exacto post-R1).
    expect(Math.abs(adj!.gapCop - 1_572_000_000)).toBeLessThanOrEqual(1_000);

    // controlTotals.patrimonio debe estar anclado al ecpClosingBalance al centavo.
    expect(snap.controlTotals.patrimonio).toBe(adj!.ecpClosingBalance);
    expect(snap.controlTotals.patrimonio).toBe(adj!.reconciledEquity);
    // Y el snapshot debe reflejarlo en equityBreakdown.convergenceAdjustment
    // y en equityAnchorAdjustment.
    expect(snap.equityBreakdown.convergenceAdjustment).toBe(adj!.gapCop);
    expect(snap.equityAnchorAdjustment).toBe(adj!.gapCop);
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 3 — R6: cierre EFE↔Caja PUC 11.
  // -------------------------------------------------------------------------
  it('Cuadratura 3 — R6 cierra EFE.netChangeInCash == observedChangeInCash al centavo', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const closure = snap.curator!.cashFlowClosureAdjustment;
    expect(
      closure,
      'R6 no produjo cashFlowClosureAdjustment — el EFE indirecto debería ' +
        'desbalancear vs PUC 11 dada la inconsistencia del fixture.',
    ).toBeDefined();

    // Aserción dura: post-R6, EFE.netChangeInCash == observedChangeInCash al centavo.
    const efe = snap.cashFlowIndirecto;
    expect(efe, 'cashFlowIndirecto post-R6 ausente').toBeDefined();
    expect(efe!.netChangeInCash).toBe(efe!.observedChangeInCash);
    expect(Math.abs(efe!.netChangeInCash - efe!.observedChangeInCash)).toBeLessThanOrEqual(1);
    expect(efe!.reconciled).toBe(true);
    expect(efe!.reconciliationGap).toBe(0);

    // Anclas de caja.
    expect(closure!.reconciledClosingCash).toBe(snap.controlTotals.efectivoCuenta11);
    expect(closure!.openingCash).toBe(
      result.comparative?.controlTotals.efectivoCuenta11 ?? 0,
    );
    expect(snap.controlTotals.cashClose).toBe(closure!.reconciledClosingCash);
    expect(snap.controlTotals.cashOpen).toBe(closure!.openingCash);
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 4 — R7: advertencia de costo presunto.
  // -------------------------------------------------------------------------
  it('Cuadratura 4 — R7 emite presumedCostWarning cuando margen > 85% e inventario > 50% × ingresos', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const warning = snap.curator!.presumedCostWarning;
    expect(
      warning,
      'R7 no produjo presumedCostWarning — margen esperado ≈ 85.3% (>85%) e inventario $1.67B (>50% × $85M revenue).',
    ).toBeDefined();

    // Margen bruto observado debe ser > 0.85.
    expect(warning!.observedGrossMargin).toBeGreaterThan(0.85);
    // Y aproximadamente (85M - 12.5M) / 85M ≈ 0.853.
    const expectedMargin = (85_000_000 - 12_500_000) / 85_000_000;
    expect(Math.abs(warning!.observedGrossMargin - expectedMargin)).toBeLessThan(1e-6);

    // Threshold = 0.85.
    expect(warning!.thresholdGrossMargin).toBe(0.85);

    // El snapshot también debe llevar la advertencia.
    expect(snap.presumedCostWarning).toBe(warning);
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 5 — Ecuación patrimonial post-Curator.
  // -------------------------------------------------------------------------
  it('Cuadratura 5 — Ecuación post-Curator: Activo = Pasivo + Patrimonio (al centavo)', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const lhs = snap.controlTotals.activo;
    const rhs = snap.controlTotals.pasivo + snap.controlTotals.patrimonio;
    const delta = lhs - rhs;

    expect(
      Math.abs(delta),
      `Ecuación patrimonial post-Curator descuadrada al centavo. ` +
        `Activo: $${lhs.toLocaleString()}, ` +
        `Pasivo: $${snap.controlTotals.pasivo.toLocaleString()}, ` +
        `Patrimonio: $${snap.controlTotals.patrimonio.toLocaleString()}, ` +
        `Δ (Activo − [Pasivo + Patrimonio]): $${delta.toLocaleString()}.`,
    ).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Sanidad — periodos detectados, errores ausentes en el Curator.
  // -------------------------------------------------------------------------
  it('Sanidad — detectó 2 periodos (2024 + 2025) y Curator corrió sin errores', () => {
    const result = loadSnapshot();
    expect(result.periods.length).toBe(2);
    expect(result.periods.map((p) => p.period)).toEqual(['2024', '2025']);
    expect(result.primary.period).toBe('2025');
    expect(result.comparative?.period).toBe('2024');

    const errors = result.primary.curator!.errors;
    expect(
      Object.keys(errors),
      `Curator reportó errores: ${JSON.stringify(errors)}`,
    ).toHaveLength(0);
  });
});

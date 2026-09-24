// ---------------------------------------------------------------------------
// ELITE Pulido Diamante — verificación E2E del Curator (R1+R5+R6+R7).
// ---------------------------------------------------------------------------
// Lee el fixture sintético del CFO (`elite-pulido-diamante.csv`), corre
// `preprocessTrialBalance` (que internamente ejecuta `runCurator`), y verifica
// las 5 cuadraturas que el contrato Pulido Diamante exige al centavo:
//
//   1. R1 — al menos una reclasificación aplicada (saldo negativo material
//      en activo movido a cuenta virtual `2810ZZ-<originalCode>` en Pasivo).
//   2. R8 — el descuadre deliberado del archivo (379505) NO se absorbe:
//      queda como residual bloqueante (auditoría 2026-09).
//   3. R6 — cierre EFE↔caja PUC 11.
//   4. R7 — advertencia de costo presunto cuando margen > 85% y
//      inventario > 50% × ingresos.
//   5. Ecuación post-Curator: el residual se expone al centavo.
//
// El fixture se diseñó con descuadres deliberados para activar las reglas
// (R1, R6, R7, R8) en un solo balance de prueba multiperiodo (2024 → 2025).
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
  it('Cuadratura 1 — R1 reclasifica 120505 (-$50M) a 2895VC-120505 con applied:true', () => {
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
    expect(r120505!.reclassifiedToCode).toBe('2895VC-120505');

    // La cuenta virtual debe estar en Clase 2 con balance = $50M.
    const class2 = snap.classes.find((c) => c.code === 2);
    expect(class2, 'Clase 2 (Pasivo) ausente del snapshot').toBeDefined();
    const virtual = class2!.accounts.find((a) => a.code === '2895VC-120505');
    expect(
      virtual,
      `Esperaba cuenta virtual 2895VC-120505 en Clase 2. Recibidas: ${class2!.accounts
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
  // ASERCIÓN 2 — R8 NO absorbe el desbalance del archivo.
  // -------------------------------------------------------------------------
  // El fixture trae la cuenta 379505 "Ajuste pendiente periodo anterior" por
  // -$1.572M, que deja el archivo descuadrado. Hasta la auditoría 2026-09
  // (niif-preproceso-06) R8 llevaba TODO el residual a 3710VC y la ecuación
  // "cuadraba" por construcción: un descuadre real terminaba presentado como
  // patrimonio. Ahora R8 sólo explica el traslado del resultado:
  //
  //   Activo post-R1                          = $3.270.000.000
  //   Pasivo post-R1                          = $880.000.000
  //   Patrimonio CSV                          = $818.000.000
  //     (1.865 + 100 + 145 + 280 − 1.572)
  //   R8 anula 3605 ($145M, resultado anterior) → 3710VC = $145M
  //   R8 inyecta 3605VC                       = -$2.500.000 (utilidad dinámica)
  //   Patrimonio post-R8                      = $815.500.000
  //   Residual NO explicado = 3.270 − 880 − 815,5 = $1.574.500.000 → BLOQUEANTE
  // -------------------------------------------------------------------------
  it('Cuadratura 2 — R8 no absorbe el desbalance del archivo: residual $1.574,5M bloqueante y R5 sin anclaje', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const vc = snap.curator!.virtualCloseAdjustment;
    expect(
      vc,
      'R8 no produjo virtualCloseAdjustment — el fixture tiene actividad P&L y debería disparar.',
    ).toBeDefined();

    // Nada se absorbe en 3710VC salvo la reclasificación del 3605 anterior.
    expect(vc!.centsAdjustment).toBe(0);
    expect(vc!.reclassifiedFrom3605).toBe(true);
    expect(vc!.csvUtilidadEjercicio).toBe(145_000_000);
    expect(vc!.reclassifiedAmount).toBe(145_000_000);
    const v3710 = snap.classes.find((c) => c.code === 3)!.accounts.find((a) => a.code === '3710VC');
    expect(v3710?.balance).toBe(145_000_000);

    // Utilidad dinámica = ingresos − costos − gastos = 85M − 12,5M − 75M = -$2,5M.
    expect(vc!.dynamicNetIncome).toBe(-2_500_000);

    // El residual queda visible, al centavo, y bloquea la emisión.
    expect(vc!.blocking).toBe(true);
    expect(vc!.unexplainedResidualRaw).toBe('1574500000.00');
    expect(vc!.residualGapBeforeCents).toBe(1_574_500_000);
    expect(snap.summary.equationBalanced).toBe(false);
    expect(snap.validation.blocking).toBe(true);
    expect(
      snap.validation.curatorBlockingReasons?.some((r) => r.includes('1.574.500.000,00')),
    ).toBe(true);

    // El patrimonio post-R8 es Σ clase 3 y coincide con controlTotals.
    expect(snap.controlTotals.patrimonio).toBe(vc!.reconciledEquity);
    expect(snap.controlTotals.patrimonio).toBe(815_500_000);
    expect(snap.virtualCloseAdjustment).toBe(vc);

    // R5 ya no ancla el patrimonio a un desglose: el desglose cubre toda la
    // clase 3 (incluida la 379505) y concilia con el total.
    expect(snap.curator!.convergenceAdjustment).toBeUndefined();
    expect(snap.equityAnchorAdjustment).toBeUndefined();
    expect(snap.equityBreakdown.convergenceAdjustment).toBeUndefined();
    expect(snap.validation.curatorBlockingReasons?.some((r) => r.startsWith('[CUR-R5]'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 3 — R6: el EFE no se cierra a la fuerza.
  // -------------------------------------------------------------------------
  // Auditoría 2026-09 (niif-preproceso-15/-16): R2 clasifica TODA cuenta de
  // las clases 1-3, así que el EFE suma exactamente la variación de caja
  // cuando ambos balances cuadran. Este fixture NO cuadra en ninguno de los
  // dos periodos (379505), y la brecha del EFE es exactamente la variación del
  // descuadre: 1.574,5M (2025) − 1.752M (2024) = −177,5M ⇒ brecha +$177,5M.
  // Antes R6 absorbía $80M en varInventarios (y la diferencia quedaba
  // escondida en capital de trabajo); ahora la brecha queda visible.
  // -------------------------------------------------------------------------
  it('Cuadratura 3 — R6 no absorbe la brecha material del EFE en capital de trabajo', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const efe = snap.cashFlowIndirecto;
    expect(efe, 'cashFlowIndirecto (EFE por R2) ausente — R6 no pudo correr').toBeDefined();

    // R6 ancla cashOpen / cashClose SIEMPRE, decida o no aplicar el cierre.
    expect(snap.controlTotals.cashClose).toBe(snap.controlTotals.efectivoCuenta11);
    expect(snap.controlTotals.cashOpen).toBe(
      result.comparative?.controlTotals.efectivoCuenta11 ?? 0,
    );

    // Sin cierre forzado ni línea de ajuste.
    expect(snap.curator!.cashFlowClosureAdjustment).toBeUndefined();
    expect(snap.cashFlowClosureAdjustment).toBeUndefined();
    expect((efe!.operating as { varCapitalTrabajoAjuste?: number }).varCapitalTrabajoAjuste).toBeUndefined();

    // La brecha es la variación del descuadre del archivo entre periodos.
    const residualPrev = result.comparative!.virtualCloseAdjustment!.unexplainedResidual!;
    const residualNow = snap.virtualCloseAdjustment!.unexplainedResidual!;
    expect(efe!.reconciliationGap).toBeCloseTo(-(residualNow - residualPrev), 2);
    expect(efe!.reconciliationGap).toBeCloseTo(177_500_000, 2);
    expect(efe!.reconciled).toBe(false);

    // D&A del periodo recuperada de la correctora 1592 (Δ = $30M).
    expect(efe!.operating.depreciacionAmortizacion).toBe(30_000_000);

    const r6 = snap.curator!.findings.find((f) => f.code === 'CUR-R6');
    expect(r6?.severity).toBe('alto');
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 3-bis — R1 preserva las cuentas correctoras (regresión P0).
  // -------------------------------------------------------------------------
  // Auditoría 2026-08: R1 trataba la depreciación acumulada como "saldo
  // acreedor anómalo" y la movía a Clase 2. NIC 1 párr. 33 dice expresamente
  // que medir por el neto los activos sujetos a correcciones valorativas NO es
  // compensación, y NIC 16 párr. 73(d) obliga a revelar bruto y depreciación
  // acumulada por separado. Ver `curator-rules/contra-asset-registry.ts`.
  // -------------------------------------------------------------------------
  it('R1 preserva la depreciación acumulada en el activo y sigue reclasificando el saldo acreedor anómalo', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const claseActivo = snap.classes.find((c) => c.code === 1);
    const dep = (claseActivo?.accounts ?? []).find((a) => a.code.startsWith('1592'));

    expect(dep, 'La cuenta 159205 desapareció de Clase 1 — R1 la reclasificó').toBeDefined();
    expect(
      dep!.balance,
      'La depreciación acumulada debe conservar su saldo crédito dentro del activo.',
    ).toBe(-130_000_000);

    // Ninguna reclasificación puede apuntar a una cuenta correctora.
    const reclasificadas = (snap.reclassifications ?? []).map((r) => r.accountCode);
    expect(reclasificadas).not.toContain('159205');

    // Pero la regla conserva su trabajo real: 120505 (Inversiones con saldo
    // crédito) sí es una anomalía y sí se reclasifica.
    expect(reclasificadas).toContain('120505');

    // El dato que R14 y el EFE consumen queda disponible.
    expect(snap.ppeDepreciationAudit?.depreciacionAcumuladaCop).toBe(130_000_000);
    expect(snap.ppeDepreciationAudit?.ppeWithoutDepreciation).toBe(false);

    // Y la traza queda registrada para el analista.
    const trazas = snap.curator!.findings.filter((f) => f.code === 'CUR-R1-CA');
    expect(trazas.length).toBe(1);
    expect(trazas[0].normReference).toContain('NIC 1 párr. 33');

    // Invariante de fondo: preservar la correctora NO altera la ecuación. El
    // único residual es el desbalance propio del archivo (379505), que R8 ya
    // no absorbe (ver Cuadratura 2).
    expect(
      snap.controlTotals.activo -
        (snap.controlTotals.pasivo + snap.controlTotals.patrimonio),
    ).toBe(snap.virtualCloseAdjustment!.unexplainedResidual);
    expect(snap.virtualCloseAdjustment!.unexplainedResidual).toBe(1_574_500_000);
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
  it('Cuadratura 5 — Ecuación post-Curator: el descuadre del archivo queda expuesto al centavo (no se oculta)', () => {
    const result = loadSnapshot();
    const snap = result.primary;
    const cents = snap.controlTotals.cents!;

    // Activo − (Pasivo + Patrimonio) en la MISMA representación del gate V1.
    const gapCents = cents.activo - cents.pasivo - cents.patrimonio;
    expect(gapCents).toBe(BigInt(157_450_000_000));
    // Y coincide con lo que R8 reporta como residual no explicado.
    expect(snap.virtualCloseAdjustment!.unexplainedResidualRaw).toBe('1574500000.00');
    expect(snap.summary.equationBalanced).toBe(false);
    expect(snap.validation.blocking).toBe(true);
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

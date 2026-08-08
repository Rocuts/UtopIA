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
  // ASERCIÓN 2 — R8: Cierre Virtual absorbe el gap pre-existente.
  // -------------------------------------------------------------------------
  // Bajo la arquitectura post-R8 (mayo 2026), el ajuste pendiente de la cuenta
  // 379505 (-$1.572B en el fixture) ya no es absorbido por R5: lo absorbe R8
  // como `centsAdjustment` en la cuenta virtual `3710VC`. R5 solo ve la
  // ecuación contable cuadrada por R8 y no actúa.
  //
  // Cálculo manual del residual que R8 absorbe en 3710VC:
  //   Activo post-R1                          = $3.400.000.000
  //   Pasivo post-R1                          = $1.010.000.000
  //   Patrimonio CSV                          = $818.000.000
  //     (1.865 + 100 + 145 + 280 − 1.572)
  //   R8 anula 3605 ($145M) e inyecta 3605VC  = -$2.500.000 (utilidad dinámica)
  //   Patrimonio post-3605VC                  = $670.500.000
  //   Residual = 3.400.000.000 − 1.010.000.000 − 670.500.000 = $1.719.500.000
  //   → R8 inyecta 3710VC = $1.719,5M y centsAdjustment = $1.719,5M.
  //
  // Este residual incluye los $1.572B del 379505 + los $147,5M del gap entre
  // 3605 viejo ($145M) y la utilidad dinámica (-$2,5M). Ambos fluyen al
  // mismo destino contable (3710VC) — semánticamente correcto: ambos
  // representan resultados de ejercicios anteriores no formalmente cerrados.
  // -------------------------------------------------------------------------
  it('Cuadratura 2 — R8 absorbe el gap pre-existente (≈ $1,72B) en 3710VC y R5 queda inactivo', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    // R8: el ajuste de Cierre Virtual debe estar presente.
    const vc = snap.curator!.virtualCloseAdjustment;
    expect(
      vc,
      'R8 no produjo virtualCloseAdjustment — el fixture tiene actividad P&L y debería disparar.',
    ).toBeDefined();

    // El residual absorbido por R8 ≈ $1.719,5M (los $1.572B de la cuenta
    // pendiente 379505 + los $147,5M del gap 3605 viejo vs utilidad dinámica).
    // Tolerancia $1K para redondeos.
    expect(Math.abs(vc!.centsAdjustment - 1_719_500_000)).toBeLessThanOrEqual(1_000);
    // residualGapBeforeCents == centsAdjustment (R8 absorbe TODO el residual).
    expect(vc!.residualGapBeforeCents).toBe(vc!.centsAdjustment);

    // Reclasificación de 3605 viejo: $145M (CSV) → $0 (utilidad dinámica autoritativa).
    expect(vc!.reclassifiedFrom3605).toBe(true);
    expect(vc!.csvUtilidadEjercicio).toBe(145_000_000);
    expect(vc!.reclassifiedAmount).toBe(145_000_000);

    // Utilidad dinámica = ingresos − costos − gastos = 85M − 12,5M − 75M = -$2,5M.
    expect(vc!.dynamicNetIncome).toBe(-2_500_000);

    // El patrimonio post-R8 es autoritativo y debe coincidir con controlTotals.
    expect(snap.controlTotals.patrimonio).toBe(vc!.reconciledEquity);

    // Snapshot debe llevar el ajuste a nivel raíz (acceso rápido para renderers).
    expect(snap.virtualCloseAdjustment).toBe(vc);

    // R5 NO debe actuar: tras R8 la ecuación contable cuadra y el guard de
    // R5 lo deja pasar sin tocar.
    expect(
      snap.curator!.convergenceAdjustment,
      'R5 no debería actuar cuando R8 ya cuadró la ecuación contable.',
    ).toBeUndefined();
    expect(snap.equityAnchorAdjustment).toBeUndefined();
    expect(snap.equityBreakdown.convergenceAdjustment).toBeUndefined();

    // Espíritu del test (multi-arquitectura): el flujo end-to-end produce un
    // patrimonio cuadrado tras procesar el ajuste pendiente de 379505.
    const lhs = snap.controlTotals.activo;
    const rhs = snap.controlTotals.pasivo + snap.controlTotals.patrimonio;
    expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // ASERCIÓN 3 — R6: cierre del EFE contra la caja PUC 11.
  // -------------------------------------------------------------------------
  // PREMISA CORREGIDA (auditoría 2026-08). Este test afirmaba antes que R6
  // rechazaba el cierre porque la brecha era ≈ $312,5M, superior al 50 % de
  // todos los buckets operativos. Esa brecha era un ARTEFACTO de un defecto de
  // R1: la regla reclasificaba la depreciación acumulada (159205, −$130M) a
  // pasivo, con lo cual (a) inflaba Activo y Pasivo en $130M cada uno y
  // (b) anulaba la cuenta 1592 en Clase 1, dejando a R2 sin el ajuste no-cash
  // de D&A del método indirecto. El EFE quedaba descuadrado por construcción.
  //
  // Con las cuentas correctoras preservadas en el activo (NIC 1 párr. 33), R2
  // recupera la D&A del periodo (Δ 1592 = $30M) y la brecha real cae a $80M
  // —absorbible por varInventarios ($170M) sin superar el tope del 50 %—, por
  // lo que el guardrail SÍ autoriza el cierre y el EFE queda reconciliado
  // contra PUC 11 al centavo, que es el contrato de R6 (NIC 7 párr. 45).
  //
  // El caso "guardrail rechaza el cierre" sigue siendo comportamiento válido de
  // R6, pero necesita un fixture cuya brecha sea genuinamente inabsorbible.
  // -------------------------------------------------------------------------
  it('Cuadratura 3 — R6 cierra el EFE contra PUC 11 cuando la brecha es absorbible por un bucket operativo', () => {
    const result = loadSnapshot();
    const snap = result.primary;

    const efe = snap.cashFlowIndirecto;
    expect(efe, 'cashFlowIndirecto (EFE por R2) ausente — R6 no pudo correr').toBeDefined();

    // R6 ancla cashOpen / cashClose SIEMPRE, decida o no aplicar el cierre.
    expect(snap.controlTotals.cashClose).toBeDefined();
    expect(snap.controlTotals.cashOpen).toBeDefined();
    expect(snap.controlTotals.cashClose).toBe(snap.controlTotals.efectivoCuenta11);
    expect(snap.controlTotals.cashOpen).toBe(
      result.comparative?.controlTotals.efectivoCuenta11 ?? 0,
    );

    // La brecha es absorbible ⇒ el cierre se aplica y queda documentado.
    const closure = snap.curator!.cashFlowClosureAdjustment;
    expect(
      closure,
      'R6 debería aplicar el cierre: con las correctoras preservadas la brecha ' +
        'es de $80M, por debajo del 50 % de varInventarios ($170M).',
    ).toBeDefined();

    // El efectivo final reconciliado DEBE ser el saldo PUC 11 al cierre — es el
    // ancla dura de todo el EFE.
    expect(closure!.reconciledClosingCash).toBe(snap.controlTotals.efectivoCuenta11);
    expect(closure!.openingCash).toBe(
      result.comparative?.controlTotals.efectivoCuenta11 ?? 0,
    );

    // La brecha cerrada es exactamente la diferencia entre la variación
    // observada en caja y la que arrojaba el EFE indirecto antes del ajuste.
    expect(closure!.gapCop).toBe(
      closure!.efeNetChangeBefore - closure!.observedChangeInCash,
    );

    // El ajuste va con etiqueta LITERAL y justificación normativa: un plug
    // silencioso sería indefendible ante la DIAN (Art. 647 E.T.).
    expect(closure!.adjustmentLineLabel).toBe(
      'Variaciones en Capital de Trabajo (ajuste de cierre)',
    );
    expect(closure!.justification).toContain('NIC 7');

    // Consecuencia del cierre: el EFE queda reconciliado.
    expect(efe!.reconciled).toBe(true);
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

    // Invariante de fondo: preservar la correctora NO rompe la ecuación.
    expect(
      snap.controlTotals.activo -
        (snap.controlTotals.pasivo + snap.controlTotals.patrimonio),
    ).toBe(0);
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

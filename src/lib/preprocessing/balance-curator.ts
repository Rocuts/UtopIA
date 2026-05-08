// ---------------------------------------------------------------------------
// Balance Curator — orquestador de las 7 reglas NIIF (R1–R7) (Pulido Diamante)
// ---------------------------------------------------------------------------
// Se llama al final de `buildSnapshotForPeriod` (después de todas las
// validaciones existentes) para producir un `CuratorResult` que el snapshot
// expone en `snapshot.curator`. Cada regla corre dentro de un try/catch
// individual: una regla que falle NO interrumpe a las otras — el error
// queda en `result.errors[ruleCode]` para diagnóstico.
//
// Orden de ejecución (Pulido Diamante):
//   R1 → R5 → R3 → R2 → R6 → R4 → R7
//
// Justificación del orden:
//   1. R1 sanea Activos/Pasivos negativos (mutación de control totals).
//   2. R5 ancla el patrimonio al ECP (depende del controlTotals.patrimonio
//      ya saneado por R1).
//   3. R3 atribuye el descuadre residual (lectura sobre control totals
//      saneados).
//   4. R2 construye el EFE indirecto (sobre control totals saneados).
//   5. R6 cierra el EFE contra el saldo PUC 11 (depende de R2).
//   6. R4 valida la provisión de renta (independiente).
//   7. R7 emite advertencia de costo presunto (independiente, no muta).
//
// La función NO ES PURA en sentido estricto: las reglas R1, R5, R6 y R7 mutan
// el snapshot recibido (ver contrato Pulido Diamante en
// `curator-rules/types.ts`). Sigue siendo determinística: mismo input → mismo
// output (snapshot mutado idénticamente).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from './trial-balance';

import { runR1 } from './curator-rules/r1-negative-assets';
import { runR2 } from './curator-rules/r2-indirect-cashflow';
import { runR3 } from './curator-rules/r3-balance-gap-attribution';
import { runR4 } from './curator-rules/r4-tax-provision-sufficiency';
import { runR5 } from './curator-rules/r5-equity-anchor';
import { runR6 } from './curator-rules/r6-cashflow-closure';
import { runR7 } from './curator-rules/r7-presumed-cost';
import type { CuratorFinding, CuratorResult } from './curator-rules/types';

export function runCurator(
  snapshot: PeriodSnapshot,
  prev: PeriodSnapshot | null = null,
): CuratorResult {
  const findings: CuratorFinding[] = [];
  const errors: Record<string, string> = {};

  // R1 — saneo de saldos negativos en Activos (muta).
  let r1Out: ReturnType<typeof runR1> = { reclassifications: [], findings: [] };
  try {
    r1Out = runR1(snapshot);
    findings.push(...r1Out.findings);
  } catch (err) {
    errors['CUR-R1'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R1 failed:', err);
  }

  // R5 — anclaje patrimonial Balance ↔ ECP (muta).
  let r5Out: ReturnType<typeof runR5> = { findings: [] };
  try {
    r5Out = runR5(snapshot, prev);
    findings.push(...r5Out.findings);
  } catch (err) {
    errors['CUR-R5'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R5 failed:', err);
  }

  // R3 — atribución de brecha de cuadratura (lectura).
  let r3Out: ReturnType<typeof runR3> = { findings: [] };
  try {
    r3Out = runR3(snapshot, prev);
    findings.push(...r3Out.findings);
  } catch (err) {
    errors['CUR-R3'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R3 failed:', err);
  }

  // R2 — construcción del EFE método indirecto (lectura, popula
  // `cashFlowIndirecto` que luego R6 cierra).
  let r2Out: ReturnType<typeof runR2> = { findings: [] };
  try {
    r2Out = runR2(snapshot, prev);
    findings.push(...r2Out.findings);
    // Persistir el EFE en el snapshot para que R6 lo encuentre.
    if (r2Out.cashFlowIndirecto) {
      snapshot.cashFlowIndirecto = r2Out.cashFlowIndirecto;
    }
  } catch (err) {
    errors['CUR-R2'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R2 failed:', err);
  }

  // R6 — cierre EFE ↔ caja PUC 11 (muta `snapshot.cashFlowIndirecto`).
  let r6Out: ReturnType<typeof runR6> = { findings: [] };
  try {
    r6Out = runR6(snapshot, prev);
    findings.push(...r6Out.findings);
  } catch (err) {
    errors['CUR-R6'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R6 failed:', err);
  }

  // R4 — provisión de renta (lectura, independiente).
  let r4Out: ReturnType<typeof runR4> = { findings: [] };
  try {
    r4Out = runR4(snapshot);
    findings.push(...r4Out.findings);
  } catch (err) {
    errors['CUR-R4'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R4 failed:', err);
  }

  // R7 — advertencia de costo presunto (lectura, independiente, no muta cifras).
  let r7Out: ReturnType<typeof runR7> = { findings: [] };
  try {
    r7Out = runR7(snapshot);
    findings.push(...r7Out.findings);
  } catch (err) {
    errors['CUR-R7'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R7 failed:', err);
  }

  return {
    period: snapshot.period,
    comparativePeriod: prev?.period ?? null,
    reclassifications: r1Out.reclassifications,
    cashFlowIndirecto: snapshot.cashFlowIndirecto, // post-R6 si R6 mutó
    balanceGapAttribution: r3Out.balanceGapAttribution,
    taxProvisionRisk: r4Out.taxProvisionRisk,
    convergenceAdjustment: r5Out.convergenceAdjustment,
    cashFlowClosureAdjustment: r6Out.cashFlowClosureAdjustment,
    presumedCostWarning: r7Out.presumedCostWarning,
    findings,
    errors,
    generatedAt: new Date().toISOString(),
  };
}

export type { CuratorResult, CuratorFinding } from './curator-rules/types';

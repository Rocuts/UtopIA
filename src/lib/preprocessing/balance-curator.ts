// ---------------------------------------------------------------------------
// Balance Curator — orquestador de las 4 reglas NIIF (R1–R4)
// ---------------------------------------------------------------------------
// Se llama al final de `buildSnapshotForPeriod` (después de todas las
// validaciones existentes) para producir un `CuratorResult` que el snapshot
// expone en `snapshot.curator`. Cada regla corre dentro de un try/catch
// individual: una regla que falle NO interrumpe a las otras tres — el error
// queda en `result.errors[ruleCode]` para diagnóstico.
//
// La función es PURA y DETERMINÍSTICA: mismo input → mismo output. No hace
// llamadas LLM ni I/O.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from './trial-balance';

import { runR1 } from './curator-rules/r1-negative-assets';
import { runR2 } from './curator-rules/r2-indirect-cashflow';
import { runR3 } from './curator-rules/r3-balance-gap-attribution';
import { runR4 } from './curator-rules/r4-tax-provision-sufficiency';
import type { CuratorFinding, CuratorResult } from './curator-rules/types';

export function runCurator(
  snapshot: PeriodSnapshot,
  prev: PeriodSnapshot | null = null,
): CuratorResult {
  const findings: CuratorFinding[] = [];
  const errors: Record<string, string> = {};

  // R1
  let r1Out: ReturnType<typeof runR1> = { reclassifications: [], findings: [] };
  try {
    r1Out = runR1(snapshot);
    findings.push(...r1Out.findings);
  } catch (err) {
    errors['CUR-R1'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R1 failed:', err);
  }

  // R2
  let r2Out: ReturnType<typeof runR2> = { findings: [] };
  try {
    r2Out = runR2(snapshot, prev);
    findings.push(...r2Out.findings);
  } catch (err) {
    errors['CUR-R2'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R2 failed:', err);
  }

  // R3
  let r3Out: ReturnType<typeof runR3> = { findings: [] };
  try {
    r3Out = runR3(snapshot, prev);
    findings.push(...r3Out.findings);
  } catch (err) {
    errors['CUR-R3'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R3 failed:', err);
  }

  // R4
  let r4Out: ReturnType<typeof runR4> = { findings: [] };
  try {
    r4Out = runR4(snapshot);
    findings.push(...r4Out.findings);
  } catch (err) {
    errors['CUR-R4'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R4 failed:', err);
  }

  return {
    period: snapshot.period,
    comparativePeriod: prev?.period ?? null,
    reclassifications: r1Out.reclassifications,
    cashFlowIndirecto: r2Out.cashFlowIndirecto,
    balanceGapAttribution: r3Out.balanceGapAttribution,
    taxProvisionRisk: r4Out.taxProvisionRisk,
    findings,
    errors,
    generatedAt: new Date().toISOString(),
  };
}

export type { CuratorResult, CuratorFinding } from './curator-rules/types';

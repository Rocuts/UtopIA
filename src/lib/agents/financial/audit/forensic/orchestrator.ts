// ─── D5.3 — Forensic Scan Orchestrator ───────────────────────────────────────
//
// Corre todas las reglas deterministas en secuencia (cada una capturada
// individualmente para que un fallo no cancele las demás), agrega las
// Anomaly[], calcula score y retorna ForensicScanResult.
//
// Las reglas son idempotentes — correr el mismo (workspaceId, periodId) dos
// veces produce el mismo resultado.

import { ALL_RULES } from './rules/index';
import { computeScore, countBySeverity } from './score';
import type {
  Anomaly,
  ForensicScanInput,
  ForensicScanResult,
} from './types';

export async function runForensicScan(
  input: ForensicScanInput,
): Promise<ForensicScanResult> {
  const start = Date.now();
  const anomalies: Anomaly[] = [];
  const warnings: string[] = [];

  const rulesToRun = ALL_RULES.filter(
    (rule) => !input.skipRules?.includes(rule.kind),
  );

  for (const rule of rulesToRun) {
    try {
      const result = await rule.run({
        workspaceId: input.workspaceId,
        periodId: input.periodId,
      });
      anomalies.push(...result.anomalies);
      if (result.warnings) warnings.push(...result.warnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`[forensic] Regla ${rule.kind} falló: ${msg}`);
    }
  }

  return {
    workspaceId: input.workspaceId,
    periodId: input.periodId,
    scanStartedAt: new Date(start),
    scanDurationMs: Date.now() - start,
    totalAnomalies: anomalies.length,
    bySeverity: countBySeverity(anomalies),
    score: computeScore(anomalies),
    anomalies,
    warnings,
  };
}

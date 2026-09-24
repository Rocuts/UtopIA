// ─── D5.3 — Forensic Scan Orchestrator ───────────────────────────────────────
//
// Corre todas las reglas deterministas en secuencia (cada una capturada
// individualmente para que un fallo no cancele las demás), agrega las
// Anomaly[], calcula score y retorna ForensicScanResult.
//
// Las reglas son idempotentes — correr el mismo (workspaceId, periodId) dos
// veces produce el mismo resultado.
//
// Cobertura (auditoria-calidad-19): una regla que lanza NO es una regla
// "limpia". Antes cada excepción se degradaba a warning y computeScore([])
// devolvía 100, de modo que un escaneo con la BD caída quedaba persistido
// como "limpio" y no notificaba. Ahora:
//   - `rulesFailed` / `rulesEvaluated` y `coverage` ('completa' | 'parcial')
//     declaran explícitamente la cobertura;
//   - si NINGUNA regla se pudo evaluar, el escaneo lanza
//     `ForensicScanFailedError` en vez de devolver un score.

import { ALL_RULES } from './rules/index';
import { computeScore, countBySeverity } from './score';
import type {
  Anomaly,
  AnomalyKind,
  ForensicScanInput,
  ForensicScanResult,
} from './types';

/** Ninguna regla forense pudo evaluarse: no hay score que reportar. */
export class ForensicScanFailedError extends Error {
  readonly rulesFailed: AnomalyKind[];
  constructor(rulesFailed: AnomalyKind[], detail: string[]) {
    super(`[forensic] Ninguna regla se pudo evaluar (${rulesFailed.join(', ')}): ${detail.join(' | ')}`);
    this.name = 'ForensicScanFailedError';
    this.rulesFailed = rulesFailed;
  }
}

export async function runForensicScan(
  input: ForensicScanInput,
): Promise<ForensicScanResult> {
  const start = Date.now();
  const anomalies: Anomaly[] = [];
  const warnings: string[] = [];
  const rulesFailed: AnomalyKind[] = [];
  const rulesEvaluated: AnomalyKind[] = [];
  const failureDetail: string[] = [];

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
      rulesEvaluated.push(rule.kind);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`[forensic] Regla ${rule.kind} falló: ${msg}`);
      rulesFailed.push(rule.kind);
      failureDetail.push(`${rule.kind}: ${msg}`);
    }
  }

  if (rulesToRun.length > 0 && rulesEvaluated.length === 0) {
    throw new ForensicScanFailedError(rulesFailed, failureDetail);
  }

  const coverage: ForensicScanResult['coverage'] =
    rulesFailed.length > 0 || rulesToRun.length < ALL_RULES.length ? 'parcial' : 'completa';
  if (rulesFailed.length > 0) {
    warnings.push(
      `[forensic] Cobertura PARCIAL: ${rulesFailed.length} de ${rulesToRun.length} reglas no se evaluaron; ` +
        'el score no describe esas pruebas y no equivale a un período limpio.',
    );
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
    rulesEvaluated,
    rulesFailed,
    coverage,
  };
}

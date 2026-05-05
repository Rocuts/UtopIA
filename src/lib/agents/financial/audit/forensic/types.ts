// ─── D5.3 — Forensic Anomaly Detection: tipos públicos ───────────────────────
//
// Reglas deterministas (sin LLM): Benford, gaps de numeración, asientos en
// fin de semana, montos repetidos, terceros nuevos sin verificar, sesgo de
// números redondos.
//
// Todos los tipos son serializables a JSON (sin Date en los campos expuestos).

export type AnomalySeverity = 'low' | 'medium' | 'high';

export type AnomalyKind =
  | 'benford_violation'
  | 'numeration_gap'
  | 'weekend_posting'
  | 'repeated_amount'
  | 'new_third_party_unverified'
  | 'round_number_bias';

export interface Anomaly {
  /** Tipo de anomalía detectada. */
  kind: AnomalyKind;
  /** Nivel de severidad. */
  severity: AnomalySeverity;
  /** Descripción en español para el revisor. */
  description: string;
  /** IDs de journal_entries involucradas. */
  affectedEntryIds: string[];
  /** Suma absoluta de los montos involucrados (string NUMERIC para precisión). */
  affectedAmountCop: string;
  /** Path en la UI para revisión rápida. */
  reviewUrl?: string;
  /** Evidencia estructurada para auditoría (chi-square, gaps, etc.). */
  evidence: Record<string, unknown>;
}

export interface ForensicScanInput {
  workspaceId: string;
  /** accounting_periods.id — puede ser open o closed reciente. */
  periodId: string;
  /** Reglas a omitir (útil para tests y replays parciales). */
  skipRules?: AnomalyKind[];
}

export interface ForensicScanResult {
  workspaceId: string;
  periodId: string;
  scanStartedAt: Date;
  scanDurationMs: number;
  totalAnomalies: number;
  bySeverity: { low: number; medium: number; high: number };
  /** Score 0-100. 100 = limpio, 0 = altamente sospechoso. */
  score: number;
  anomalies: Anomaly[];
  /** Advertencias no bloqueantes (ej. datos insuficientes para Benford). */
  warnings: string[];
}

// ─── Contrato interno de cada regla ──────────────────────────────────────────

export interface RuleInput {
  workspaceId: string;
  periodId: string;
}

export interface RuleResult {
  anomalies: Anomaly[];
  warnings?: string[];
}

export interface ForensicRule {
  kind: AnomalyKind;
  run(input: RuleInput): Promise<RuleResult>;
}

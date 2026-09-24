// ─── D5.3 — Forensic Anomaly Detection: punto de entrada público ──────────────

export { runForensicScan, ForensicScanFailedError } from './orchestrator';
export type {
  Anomaly,
  AnomalyKind,
  AnomalySeverity,
  ForensicScanInput,
  ForensicScanResult,
} from './types';

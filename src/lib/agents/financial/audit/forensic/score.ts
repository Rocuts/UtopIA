// ─── D5.3 — Score de riesgo forense ──────────────────────────────────────────
//
// Fórmula simple y auditable:
//   base = 100
//   deducciones acumuladas por anomalía según severidad
//   score = max(0, base - total_deducciones)
//
// Ladder de severity:
//   score >= 85  → "limpio"
//   70-84        → "advertencia"
//   50-69        → "requiere revisión"
//   < 50         → "alto riesgo"

import type { Anomaly, AnomalySeverity } from './types';

const DEDUCTIONS: Record<AnomalySeverity, number> = {
  low: 2,
  medium: 6,
  high: 15,
};

export function computeScore(anomalies: Anomaly[]): number {
  const deduction = anomalies.reduce(
    (sum, a) => sum + (DEDUCTIONS[a.severity] ?? 0),
    0,
  );
  return Math.max(0, 100 - deduction);
}

export function scoreSummary(
  score: number,
): 'limpio' | 'advertencia' | 'requiere_revision' | 'alto_riesgo' {
  if (score >= 85) return 'limpio';
  if (score >= 70) return 'advertencia';
  if (score >= 50) return 'requiere_revision';
  return 'alto_riesgo';
}

export function countBySeverity(
  anomalies: Anomaly[],
): { low: number; medium: number; high: number } {
  return {
    low: anomalies.filter((a) => a.severity === 'low').length,
    medium: anomalies.filter((a) => a.severity === 'medium').length,
    high: anomalies.filter((a) => a.severity === 'high').length,
  };
}

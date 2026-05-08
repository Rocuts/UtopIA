// ---------------------------------------------------------------------------
// Health Score — helpers de scoring numérico para los 4 Pilares.
// ---------------------------------------------------------------------------
// Funciones puras, sin side effects. Todas trabajan sobre `number` (no
// BigInt) porque los scores son ratios sin precision crítica.
// ---------------------------------------------------------------------------

import type { PillarSeverity, PillarStatus } from './types';

/** Mapea un score 0-100 a status. */
export function scoreToStatus(score: number): PillarStatus {
  if (score >= 90) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 30) return 'warning';
  return 'critical';
}

/** Mapea un status a la severity de UI (token semántico). */
export function statusToSeverity(status: PillarStatus): PillarSeverity {
  if (status === 'healthy') return 'success';
  if (status === 'watch' || status === 'warning') return 'warning';
  if (status === 'critical') return 'danger';
  return 'neutral';
}

/** Restringe un score al rango [0, 100]. NaN → 0; +Infinity → 100; -Infinity → 0. */
export function clampScore(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity || n > 100) return 100;
  if (n === -Infinity || n < 0) return 0;
  return Math.round(n);
}

/** Promedio ponderado de scores parciales. weights debe sumar ~1. */
export function weightedScore(parts: Array<{ score: number; weight: number }>): number {
  let total = 0;
  let totalW = 0;
  for (const p of parts) {
    if (!Number.isFinite(p.score) || !Number.isFinite(p.weight)) continue;
    total += p.score * p.weight;
    totalW += p.weight;
  }
  if (totalW <= 0) return 0;
  return clampScore(total / totalW);
}

// ─── Threshold-based KPI scoring ────────────────────────────────────────────

export type ThresholdDirection = 'higher-better' | 'lower-better';

/** 4 bandas: healthy / watch / warning / critical (orden inclusivo desc). */
export interface KpiThresholds {
  healthy: number;
  watch: number;
  warning: number;
}

/**
 * Convierte un valor en un score 0-100 según thresholds.
 *
 *   higher-better → score asciende con el valor:
 *     value >= healthy  → 95
 *     value >= watch    → 75
 *     value >= warning  → 50
 *     else              → 15
 *
 *   lower-better → score asciende cuando el valor BAJA:
 *     value <= healthy  → 95
 *     value <= watch    → 75
 *     value <= warning  → 50
 *     else              → 15
 *
 * Para `value === null`, retornamos 50 (neutral) — el llamador decide si
 * eso aporta a su weighted score o lo excluye.
 */
export function kpiToScore(
  value: number | null,
  thresholds: KpiThresholds,
  direction: ThresholdDirection,
): number {
  if (value === null || !Number.isFinite(value)) return 50;
  if (direction === 'higher-better') {
    if (value >= thresholds.healthy) return 95;
    if (value >= thresholds.watch) return 75;
    if (value >= thresholds.warning) return 50;
    return 15;
  }
  // lower-better
  if (value <= thresholds.healthy) return 95;
  if (value <= thresholds.watch) return 75;
  if (value <= thresholds.warning) return 50;
  return 15;
}

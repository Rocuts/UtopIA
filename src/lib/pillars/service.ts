// ---------------------------------------------------------------------------
// Pillars Service — orquestador de los 4 pilares.
// ---------------------------------------------------------------------------
// Llama a `compute{Escudo,Valor,Verdad,Futuro}Pillar` con try/catch individual:
// un pilar que falle NO interrumpe a los otros 3. El error queda en
// `pillar.errors` para diagnóstico.
//
// Función PURA, sin I/O ni LLM. La consume el agregador del Vista Dueño v2
// (P5) y los triggers del Sentinel Workflow (P6).
// ---------------------------------------------------------------------------

import { computeEscudoPillar } from './escudo';
import { computeValorPillar } from './valor';
import { computeVerdadPillar } from './verdad';
import { computeFuturoPillar } from './futuro';
import { scoreToStatus } from './health-score';
import type {
  PillarMetrics,
  PillarsAggregateInput,
  PillarsResult,
} from './types';

function safeCompute(
  fn: (input: PillarsAggregateInput) => PillarMetrics,
  input: PillarsAggregateInput,
  pillarId: PillarMetrics['pillarId'],
): PillarMetrics {
  try {
    return fn(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[pillars] ${pillarId} failed:`, err);
    return {
      pillarId,
      healthScore: 0,
      status: 'critical',
      kpis: [],
      alerts: [],
      errors: { compute: message },
      generatedAt: new Date().toISOString(),
    };
  }
}

export function aggregatePillars(input: PillarsAggregateInput): PillarsResult {
  const escudo = safeCompute(computeEscudoPillar, input, 'escudo');
  const valor = safeCompute(computeValorPillar, input, 'valor');
  const verdad = safeCompute(computeVerdadPillar, input, 'verdad');
  const futuro = safeCompute(computeFuturoPillar, input, 'futuro');

  const overallScore = Math.round(
    (escudo.healthScore + valor.healthScore + verdad.healthScore + futuro.healthScore) / 4,
  );
  const overallStatus = scoreToStatus(overallScore);

  return {
    escudo,
    valor,
    verdad,
    futuro,
    overallScore,
    overallStatus,
    generatedAt: new Date().toISOString(),
  };
}

export type { PillarsResult, PillarsAggregateInput, PillarMetrics, PillarKpi } from './types';

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
import { computeEscudoExecutiveCards } from './escudo-cards';
import { computeValorPillar } from './valor';
import { computeValorExecutiveCards } from './valor-cards';
import { computeVerdadPillar } from './verdad';
import { computeVerdadExecutiveCards } from './verdad-cards';
import { computeFuturoPillar } from './futuro';
import { computeFuturoExecutiveCards } from './futuro-cards';
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

  // Inyectar las 4 tarjetas ejecutivas (EBITDA / WAOO / Ratio / FCF) sólo en
  // el pilar Valor. Try/catch independiente — si falla, las cards no aparecen
  // pero el pilar Valor (con sus 3 KPIs NIIF clásicos) sigue intacto.
  try {
    valor.executiveCards = computeValorExecutiveCards(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[pillars] valor.executiveCards failed:', err);
    valor.errors = { ...(valor.errors ?? {}), executiveCards: message };
  }

  // Inyectar las 4 tarjetas ejecutivas del Pilar Escudo: Autonomía / Cobertura
  // de Pasivos / Reserva Fiscal / Brecha Escudo. Mismo patrón fail-soft.
  try {
    escudo.escudoCards = computeEscudoExecutiveCards(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[pillars] escudo.escudoCards failed:', err);
    escudo.errors = { ...(escudo.errors ?? {}), escudoCards: message };
  }

  // Inyectar las 4 tarjetas ejecutivas del Pilar Verdad: Ecuación Maestra /
  // Consistencia / Anomalías / Salud Contable. Mismo patrón fail-soft.
  try {
    verdad.verdadCards = computeVerdadExecutiveCards(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[pillars] verdad.verdadCards failed:', err);
    verdad.errors = { ...(verdad.errors ?? {}), verdadCards: message };
  }

  // Inyectar las 4 tarjetas ejecutivas del Pilar Futuro: CAGR / Punto Quiebre /
  // Provisión Tributaria Futura / Capacidad de Inversión. Cierra el ciclo de
  // las 4 ventanas (Verdad → Escudo → Valor → Futuro). Mismo patrón fail-soft.
  try {
    futuro.futuroCards = computeFuturoExecutiveCards(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[pillars] futuro.futuroCards failed:', err);
    futuro.errors = { ...(futuro.errors ?? {}), futuroCards: message };
  }

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

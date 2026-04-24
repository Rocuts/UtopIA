// ---------------------------------------------------------------------------
// Configuracion central de modelos para 1+1 (Directorio Ejecutivo Digital)
// ---------------------------------------------------------------------------
// Todos los IDs de modelo usados en el codigo viven aqui. Para cambiar un
// modelo (ej. cuando sale una familia nueva), se cambia en UN solo lugar.
//
// Las llamadas LLM van DIRECTO a OpenAI usando `OPENAI_API_KEY` via
// `@ai-sdk/openai`. Los exports principales (CHAT, FINANCIAL_PIPELINE,
// CLASSIFIER, SYNTHESIZER, OCR) son instancias de `LanguageModel` listas para
// pasarse a `generateText` / `streamText` / `streamObject`. No pasamos
// `apiKey` manualmente — el provider del SDK lo lee de `process.env`.
//
// REALTIME y EMBEDDINGS se mantienen como strings:
//   - REALTIME se consume via `fetch` directo a la Realtime API de OpenAI
//     (no expuesta por el AI SDK todavia).
//   - EMBEDDINGS se consume por `@langchain/openai` con su propio cliente.
//
// Para sobrescribir sin redeploy, exporta `OPENAI_MODEL_*` con el ID de
// OpenAI (ej. `gpt-4o`, `gpt-4o-mini`). El prefijo legacy `openai/` (gateway)
// se elimina automaticamente si aparece en la env var.
// ---------------------------------------------------------------------------

import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * Lee una env var de modelo y normaliza:
 *   - Trim whitespace.
 *   - Elimina el prefijo legacy `openai/` (convencion del Vercel AI Gateway).
 *     OpenAI directo solo acepta el ID puro (`gpt-4o-mini`, no `openai/gpt-4o-mini`).
 *   - Si la env var no esta seteada o queda vacia, devuelve `fallback`.
 */
function envModel(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) return fallback;
  const trimmed = value.trim();
  return trimmed.startsWith('openai/') ? trimmed.slice('openai/'.length) : trimmed;
}

export const MODELS = {
  /** Chat orchestrator, classifier, synthesizer, specialists (tool-calling loop). */
  CHAT: openai(envModel('OPENAI_MODEL_CHAT', 'gpt-4o-mini')) as LanguageModel,

  /**
   * Financial pipelines (NIIF report, audit, tax-planning, transfer-pricing,
   * valuation, fiscal-opinion, tax-reconciliation, feasibility, quality).
   * Necesita contexto grande para balances de prueba y salida markdown estructurada.
   */
  FINANCIAL_PIPELINE: openai(
    envModel('OPENAI_MODEL_FINANCIAL', 'gpt-4o-mini'),
  ) as LanguageModel,

  /** Classifier / lightweight routing. */
  CLASSIFIER: openai(envModel('OPENAI_MODEL_CLASSIFIER', 'gpt-4o-mini')) as LanguageModel,

  /** Prompt enhancer / synthesizer. */
  SYNTHESIZER: openai(envModel('OPENAI_MODEL_SYNTHESIZER', 'gpt-4o-mini')) as LanguageModel,

  /** OCR / vision (PDF escaneado, imagenes). Usa el modelo full — precision sobre
   *  balances de prueba y facturas es critica, y la ruta se llama poco. */
  OCR: openai(envModel('OPENAI_MODEL_OCR', 'gpt-4o')) as LanguageModel,

  /** Realtime voice API. Se consume via `fetch` directo (string, no LanguageModel). */
  REALTIME: envModel('OPENAI_MODEL_REALTIME', 'gpt-4o-realtime-preview-2024-12-17'),

  /** Embeddings para RAG. Lo consume `@langchain/openai` (string, no LanguageModel). */
  EMBEDDINGS: envModel('OPENAI_MODEL_EMBEDDINGS', 'text-embedding-3-small'),
} as const;

export type ModelKey = keyof typeof MODELS;

// ---------------------------------------------------------------------------
// Configuracion central de modelos para UtopIA (Directorio Ejecutivo Digital)
// ---------------------------------------------------------------------------
// Todos los IDs de modelo usados en el codigo viven aqui. Para cambiar un
// modelo (ej. cuando sale una familia nueva), se cambia en UN solo lugar.
//
// Las llamadas LLM van DIRECTO a OpenAI usando `OPENAI_API_KEY` via
// `@ai-sdk/openai`. Los exports en `MODELS` son instancias de `LanguageModel`
// listas para pasarse a `generateText` / `streamText` / `streamObject`. No
// pasamos `apiKey` manualmente — el provider del SDK lo lee de `process.env`.
//
// REALTIME y EMBEDDINGS se mantienen como strings:
//   - REALTIME se consume via `fetch` directo a la Realtime API de OpenAI
//     (no expuesta por el AI SDK todavia).
//   - EMBEDDINGS se consume por `@langchain/openai` con su propio cliente.
//
// Defaults: familia GPT-5.4 (lanzada marzo 2026). gpt-4o esta deprecado.
//   - gpt-5.4-mini   : chat/specialists/financial pipelines (400K ctx, vision, reasoning)
//   - gpt-5.4-nano   : classifier T1/T2/T3 (rapido y barato)
//   - gpt-5.4 (full) : OCR de balances de prueba (alta fidelidad numerica)
//
// AI SDK >= 3.0.55 mapea automaticamente `maxOutputTokens` -> `max_completion_tokens`
// para los reasoning models de la familia GPT-5.4. No hace falta cambiar las
// llamadas existentes.
//
// Para sobrescribir sin redeploy, exporta `OPENAI_MODEL_*` con el ID puro de
// OpenAI (ej. `gpt-5.4-mini`). El prefijo legacy `openai/` (gateway) se
// elimina automaticamente si aparece en la env var.
// ---------------------------------------------------------------------------

import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * Lee una env var de modelo y normaliza:
 *   - Trim whitespace.
 *   - Elimina el prefijo legacy `openai/` (convencion del Vercel AI Gateway).
 *     OpenAI directo solo acepta el ID puro (`gpt-5.4-mini`, no `openai/gpt-5.4-mini`).
 *   - Si la env var no esta seteada o queda vacia, devuelve `fallback`.
 */
function envModel(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) return fallback;
  const trimmed = value.trim();
  return trimmed.startsWith('openai/') ? trimmed.slice('openai/'.length) : trimmed;
}

/**
 * Model ID strings (sin envoltura de provider). Usalos cuando necesites el
 * string puro, ej. para llamar a la Realtime API por `fetch` directo o para
 * pasar `modelName` al cliente de embeddings de LangChain.
 */
export const MODEL_IDS = {
  /** Chat orchestrator, classifier secundario, synthesizer, specialists. */
  CHAT: envModel('OPENAI_MODEL_CHAT', 'gpt-5.4-mini'),

  /**
   * Financial pipelines (NIIF report, audit, tax-planning, transfer-pricing,
   * valuation, fiscal-opinion, tax-reconciliation, feasibility, quality).
   * Necesita contexto grande para balances de prueba y salida markdown estructurada.
   */
  FINANCIAL_PIPELINE: envModel('OPENAI_MODEL_FINANCIAL', 'gpt-5.4-mini'),

  /** Classifier T1/T2/T3 — query routing barato y rapido. */
  CLASSIFIER: envModel('OPENAI_MODEL_CLASSIFIER', 'gpt-5.4-nano'),

  /** Prompt enhancer / synthesizer multi-agente. */
  SYNTHESIZER: envModel('OPENAI_MODEL_SYNTHESIZER', 'gpt-5.4-mini'),

  /** OCR / vision para balances de prueba y PDFs escaneados criticos.
   *  Usa el modelo full porque la precision numerica es critica. */
  OCR: envModel('OPENAI_MODEL_OCR', 'gpt-5.4'),

  /** OCR ligero para facturas, tirillas y documentos de baja densidad numerica. */
  OCR_LIGHT: envModel('OPENAI_MODEL_OCR_LIGHT', 'gpt-5.4-mini'),

  /** Realtime voice API. Se consume via `fetch` directo (string, no LanguageModel). */
  REALTIME: envModel('OPENAI_MODEL_REALTIME', 'gpt-4o-realtime-preview-2024-12-17'),

  /** Embeddings para RAG. Lo consume `@langchain/openai` (string, no LanguageModel). */
  EMBEDDINGS: envModel('OPENAI_MODEL_EMBEDDINGS', 'text-embedding-3-small'),
} as const;

/**
 * `LanguageModel` instances listas para `generateText` / `streamText` / `streamObject`.
 * Todas usan `OPENAI_API_KEY` automaticamente via `@ai-sdk/openai`.
 */
export const MODELS = {
  /** Chat orchestrator, synthesizer, specialists (tool-calling loop). */
  CHAT: openai(MODEL_IDS.CHAT) as LanguageModel,

  /** Financial / audit / tax / valuation / etc. pipelines. */
  FINANCIAL_PIPELINE: openai(MODEL_IDS.FINANCIAL_PIPELINE) as LanguageModel,

  /** Classifier T1/T2/T3. */
  CLASSIFIER: openai(MODEL_IDS.CLASSIFIER) as LanguageModel,

  /** Prompt enhancer / synthesizer. */
  SYNTHESIZER: openai(MODEL_IDS.SYNTHESIZER) as LanguageModel,

  /** OCR full (balances criticos). */
  OCR: openai(MODEL_IDS.OCR) as LanguageModel,

  /** OCR ligero (facturas, tirillas). */
  OCR_LIGHT: openai(MODEL_IDS.OCR_LIGHT) as LanguageModel,

  /** Realtime voice API. Se consume via `fetch` directo (string, no LanguageModel). */
  REALTIME: MODEL_IDS.REALTIME,

  /** Embeddings para RAG. Lo consume `@langchain/openai` (string, no LanguageModel). */
  EMBEDDINGS: MODEL_IDS.EMBEDDINGS,
} as const;

/** Alias publico para consumidores que ya importan el ID de embeddings. */
export const EMBEDDING_MODEL_ID = MODEL_IDS.EMBEDDINGS;

export type ModelKey = keyof typeof MODELS;

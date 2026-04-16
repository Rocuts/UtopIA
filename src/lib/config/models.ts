// ---------------------------------------------------------------------------
// Central OpenAI model configuration for UtopIA
// ---------------------------------------------------------------------------
// All OpenAI model names used across the codebase live here. To switch a
// model (e.g. when a new family ships), change it in ONE place.
//
// Environment variables override the defaults so we can A/B different models
// without redeploying code.
// ---------------------------------------------------------------------------

function envModel(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export const MODELS = {
  /** Chat orchestrator, classifier, synthesizer, specialists (tool-calling loop). */
  CHAT: envModel('OPENAI_MODEL_CHAT', 'gpt-4o-mini'),

  /**
   * Financial pipelines (NIIF report, audit, tax-planning, transfer-pricing,
   * valuation, fiscal-opinion, tax-reconciliation, feasibility, quality).
   * Needs large context for trial balances and structured markdown output.
   */
  FINANCIAL_PIPELINE: envModel('OPENAI_MODEL_FINANCIAL', 'gpt-4o-mini'),

  /** Classifier / lightweight routing. */
  CLASSIFIER: envModel('OPENAI_MODEL_CLASSIFIER', 'gpt-4o-mini'),

  /** Prompt enhancer / synthesizer. */
  SYNTHESIZER: envModel('OPENAI_MODEL_SYNTHESIZER', 'gpt-4o-mini'),

  /** OCR / vision (PDF escaneado, imágenes). Requires multimodal. */
  OCR: envModel('OPENAI_MODEL_OCR', 'gpt-4o'),

  /** Realtime voice API. */
  REALTIME: envModel('OPENAI_MODEL_REALTIME', 'gpt-4o-realtime-preview-2024-12-17'),

  /** Embeddings for RAG. */
  EMBEDDINGS: envModel('OPENAI_MODEL_EMBEDDINGS', 'text-embedding-3-small'),
} as const;

export type ModelKey = keyof typeof MODELS;

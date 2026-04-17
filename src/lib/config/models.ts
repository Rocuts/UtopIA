// ---------------------------------------------------------------------------
// Configuración central de modelos para UtopIA
// ---------------------------------------------------------------------------
// Todos los IDs de modelo usados en el código viven aquí. Para cambiar un
// modelo (ej. cuando sale una familia nueva), se cambia en UN solo lugar.
//
// Los IDs llevan el prefijo `openai/` porque se resuelven a través del
// Vercel AI Gateway (ver `ai` SDK v6, resolve-model.ts). El gateway expone
// observability, failover entre modelos, cost tracking y zero data retention.
// Env var de auth: AI_GATEWAY_API_KEY (OIDC en prod vía VERCEL_OIDC_TOKEN).
//
// Para sobrescribir sin redeploy, exporta `OPENAI_MODEL_*` con el ID
// completo (ej. `anthropic/claude-haiku-4-5`) — el gateway lo enruta igual.
// ---------------------------------------------------------------------------

function envModel(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export const MODELS = {
  /** Chat orchestrator, classifier, synthesizer, specialists (tool-calling loop). */
  CHAT: envModel('OPENAI_MODEL_CHAT', 'openai/gpt-4o-mini'),

  /**
   * Financial pipelines (NIIF report, audit, tax-planning, transfer-pricing,
   * valuation, fiscal-opinion, tax-reconciliation, feasibility, quality).
   * Needs large context for trial balances and structured markdown output.
   */
  FINANCIAL_PIPELINE: envModel('OPENAI_MODEL_FINANCIAL', 'openai/gpt-4o-mini'),

  /** Classifier / lightweight routing. */
  CLASSIFIER: envModel('OPENAI_MODEL_CLASSIFIER', 'openai/gpt-4o-mini'),

  /** Prompt enhancer / synthesizer. */
  SYNTHESIZER: envModel('OPENAI_MODEL_SYNTHESIZER', 'openai/gpt-4o-mini'),

  /** OCR / vision (PDF escaneado, imágenes). Requires multimodal. */
  OCR: envModel('OPENAI_MODEL_OCR', 'openai/gpt-4o'),

  /** Realtime voice API. Se mantiene en OpenAI directo (el gateway aún no expone la Realtime API). */
  REALTIME: envModel('OPENAI_MODEL_REALTIME', 'gpt-4o-realtime-preview-2024-12-17'),

  /** Embeddings for RAG. */
  EMBEDDINGS: envModel('OPENAI_MODEL_EMBEDDINGS', 'openai/text-embedding-3-small'),
} as const;

export type ModelKey = keyof typeof MODELS;

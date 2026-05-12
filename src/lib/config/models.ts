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
   * Financial pipelines (audit, tax-planning, transfer-pricing, valuation,
   * fiscal-opinion, tax-reconciliation, feasibility, quality). Necesita
   * contexto grande para balances de prueba y salida JSON estructurada.
   */
  FINANCIAL_PIPELINE: envModel('OPENAI_MODEL_FINANCIAL', 'gpt-5.4-mini'),

  /**
   * Pipeline financiero base PREMIUM (NIIF Analyst, Strategy Director,
   * Governance Specialist). Modelo más capaz (gpt-5.5) con 128K de output
   * ceiling y 19-34% menos tokens reasoning — blinda el reporte NIIF contra
   * el bug intermitente `finish_reason=length` que afecta a reasoning models
   * de la familia GPT-5 cuando combinan prompts grandes + schemas Zod
   * complejos. Costo ~10x sobre mini, pero el reporte NIIF es la pieza más
   * crítica del producto y los costos absolutos siguen siendo bajos.
   *
   * Override via `OPENAI_MODEL_FINANCIAL_PREMIUM`. Default a `gpt-5.5`.
   */
  FINANCIAL_PIPELINE_PREMIUM: envModel('OPENAI_MODEL_FINANCIAL_PREMIUM', 'gpt-5.5'),

  /** Classifier T1/T2/T3 — query routing barato y rapido. */
  CLASSIFIER: envModel('OPENAI_MODEL_CLASSIFIER', 'gpt-5.4-nano'),

  /** Prompt enhancer / synthesizer multi-agente. */
  SYNTHESIZER: envModel('OPENAI_MODEL_SYNTHESIZER', 'gpt-5.4-mini'),

  /** OCR / vision — TODO: usa `gpt-5.4-mini` por preferencia del usuario.
   *  Tiene visión nativa, soporta reasoning con `reasoningEffort: 'low'` para
   *  tareas de OCR (que no requieren cadenas de pensamiento profundas), y es
   *  ~5x más barato que el modelo full. La precisión para cuadernos
   *  manuscritos y balances PDF es suficiente con `MAX_OUTPUT_TOKENS=16000`.
   *  Override con `OPENAI_MODEL_OCR=gpt-5.4` si una empresa requiere full. */
  OCR: envModel('OPENAI_MODEL_OCR', 'gpt-5.4-mini'),

  /** Alias retrocompatible — mismo modelo ahora. Mantengamos el slot
   *  por si en el futuro queremos diferenciar (e.g. nano para tirillas). */
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

  /** Pipeline financiero PREMIUM (NIIF Analyst, Strategy, Governance) — gpt-5.5. */
  FINANCIAL_PIPELINE_PREMIUM: openai(MODEL_IDS.FINANCIAL_PIPELINE_PREMIUM) as LanguageModel,

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

// ---------------------------------------------------------------------------
// MODELS_CONFIG — reasoning_effort y textVerbosity calibrados por agente
// ---------------------------------------------------------------------------
// La familia GPT-5.4 expone dos parámetros que el AI SDK pasa por
// `providerOptions.openai.reasoningEffort` y `.textVerbosity`. La guía oficial
// OpenAI 2026 recomienda:
//
//   - `minimal` : latencia mínima, sin cadena de razonamiento. Para tareas
//                 deterministas y de routing.
//   - `low`     : razonamiento corto (~1-2k tokens reasoning). OCR, validators.
//   - `medium`  : default OpenAI. Razonamiento balanceado (~5-10k). Pipelines
//                 contables y auditoría.
//   - `high`    : razonamiento profundo (~20k+). Reservar para dictámenes y
//                 decisiones estratégicas donde el costo se justifica.
//
// Centralizar aquí evita que cada agente improvise su nivel. El `callFinancialAgent`
// (`src/lib/agents/financial/agents/runtime.ts`) consume estos defaults.
// ---------------------------------------------------------------------------

export type ReasoningEffortLevel = 'minimal' | 'low' | 'medium' | 'high';
export type TextVerbosityLevel = 'low' | 'medium' | 'high';

export interface AgentRuntimeConfig {
  reasoningEffort: ReasoningEffortLevel;
  textVerbosity: TextVerbosityLevel;
  /** Token budget para la respuesta. Mapea a `max_completion_tokens`. */
  maxOutputTokens: number;
}

export const MODELS_CONFIG = {
  // -- Chat orchestrator / routing -----------------------------------------
  classifier: { reasoningEffort: 'minimal', textVerbosity: 'low', maxOutputTokens: 150 } as const,
  promptEnhancer: { reasoningEffort: 'low', textVerbosity: 'medium', maxOutputTokens: 500 } as const,
  synthesizer: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 2000 } as const,
  specialist: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 4000 } as const,

  // -- OCR / vision --------------------------------------------------------
  ocr: { reasoningEffort: 'low', textVerbosity: 'low', maxOutputTokens: 16000 } as const,
  ocrLight: { reasoningEffort: 'minimal', textVerbosity: 'low', maxOutputTokens: 8000 } as const,

  // -- Pipeline financiero base (NIIF -> Strategy -> Governance) -----------
  // GPT-5.4 BUG NOTE: `max_completion_tokens` INCLUYE los tokens de reasoning
  // (invisibles). Con `reasoning_effort: 'medium'` el modelo gasta ~5-10k
  // tokens internos. Estos agents tienen prompts grandes post-cableado
  // niif-colombia-knowledge (guardrail + colombia-2026 + niif-measurement +
  // niif-disclosures = ~5k input) y schemas Zod complejos (~8-12k output
  // strict JSON). Budget DEBE acomodar reasoning + output — si no, finish_reason
  // = 'length' con textLen=0 (bug conocido OpenAI dev community 2026).
  // 16k → 32k para NIIF Analyst que tiene el schema más rico (NiifReportSchema).
  niifAnalyst: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 32000 } as const,
  strategyDirector: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 24000 } as const,
  governanceSpecialist: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 24000 } as const,

  // -- Auditoría especializada (paralelo) ----------------------------------
  // niifAuditor también recibe niif-measurement + niif-disclosures: budget ampliado.
  niifAuditor: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 12000 } as const,
  taxAuditor: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  legalAuditor: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  fiscalReviewer: { reasoningEffort: 'high', textVerbosity: 'medium', maxOutputTokens: 8000 } as const,

  // -- Meta-auditoría de calidad ------------------------------------------
  qualityMetaAuditor: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 8000 } as const,

  // -- Tax planning (secuencial) ------------------------------------------
  taxOptimizer: { reasoningEffort: 'high', textVerbosity: 'medium', maxOutputTokens: 10000 } as const,
  niifImpactAnalyst: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 6000 } as const,
  complianceValidator: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,

  // -- Transfer pricing (secuencial) --------------------------------------
  tpAnalyst: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 10000 } as const,
  comparableAnalyst: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 8000 } as const,
  tpDocumentationWriter: { reasoningEffort: 'medium', textVerbosity: 'high', maxOutputTokens: 12000 } as const,

  // -- Valuation (híbrido) ------------------------------------------------
  dcfModeler: { reasoningEffort: 'high', textVerbosity: 'medium', maxOutputTokens: 10000 } as const,
  marketComparables: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 8000 } as const,
  valuationSynthesizer: { reasoningEffort: 'high', textVerbosity: 'medium', maxOutputTokens: 10000 } as const,

  // -- Fiscal audit opinion (híbrido) -------------------------------------
  goingConcernAuditor: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  // misstatementReviewer recibe niif-measurement + niif-disclosures (~5K input
  // extra). Budget ampliado para acomodar reasoning + output strict JSON.
  misstatementReviewer: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 12000 } as const,
  complianceChecker: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  opinionDrafter: { reasoningEffort: 'high', textVerbosity: 'medium', maxOutputTokens: 10000 } as const,

  // -- Tax reconciliation (secuencial) ------------------------------------
  // Ambos reciben niif-measurement (~3K input extra) — budget ampliado.
  differenceIdentifier: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 16000 } as const,
  deferredTaxCalculator: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 12000 } as const,

  // -- Feasibility (secuencial) -------------------------------------------
  marketAnalyst: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 10000 } as const,
  financialModeler: { reasoningEffort: 'high', textVerbosity: 'medium', maxOutputTokens: 12000 } as const,
  riskAssessor: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 8000 } as const,

  // -- Escudo de Supervivencia (paralelo + sintetizador) ------------------
  tetCalculator: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  retentionShield: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  antiDianAuditor: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 6000 } as const,
  contingencyReserve: { reasoningEffort: 'medium', textVerbosity: 'low', maxOutputTokens: 4000 } as const,
  dividendOptimizer: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 6000 } as const,
  escudoSynthesizer: { reasoningEffort: 'medium', textVerbosity: 'medium', maxOutputTokens: 8000 } as const,
} as const satisfies Record<string, AgentRuntimeConfig>;

export type AgentSlot = keyof typeof MODELS_CONFIG;

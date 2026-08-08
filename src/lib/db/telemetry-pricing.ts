// ---------------------------------------------------------------------------
// Calculadora de costo por llamada a OpenAI
// ---------------------------------------------------------------------------
//
// Mantiene una tabla estatica con $/1M tokens por modelo y devuelve el
// costo total en MICRO-DOLARES (1 USD = 1_000_000 micros). Se almacena en
// `agent_telemetry.cost_usd_micros` como `integer` — preservamos 6 decimales
// de precision sin necesidad de NUMERIC (mas barato + mas rapido para
// agregaciones SUM/AVG en dashboards).
//
// Cache pricing: los `cached_input_tokens` (tokens servidos por el prompt
// cache automatico de la Responses API) cobran a 1/10 del precio normal de
// input. La logica de descuento ya esta aplicada: `input_tokens` viene como
// TOTAL (cached + uncached), por lo que restamos el cached antes de
// multiplicar por el precio uncached.
//
// MISS DE PRICING: antes devolviamos 0 con un `console.warn`. Eso es peor que
// no medir — un 0 es indistinguible de "esta llamada fue gratis" en el SUM del
// dashboard, y la alerta de costo diario >$50 nunca dispara. Ahora devolvemos
// `null` (la columna es nullable y el endpoint admin ya hace COALESCE) y
// logueamos UNA vez por modelo a nivel error. Una fila con calls>0 y costo $0
// delata el modelo sin tarifa en el desglose `perAgent`.
//
// OVERRIDE SIN REDEPLOY: `UTOPIA_MODEL_PRICING_JSON` acepta un JSON
// `{"<modelId>":{"input":N,"output":N,"cached":N}}` en $/1M tokens y se
// fusiona sobre la tabla estatica. Es la valvula para un modelo nuevo que
// OpenAI publique despues del ultimo deploy — sin ella, la unica alternativa
// seria inventar tarifas.
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** USD por 1M tokens de input no cacheado. */
  input: number;
  /** USD por 1M tokens de output (incluye reasoning tokens). */
  output: number;
  /** USD por 1M tokens de input servidos por cache. */
  cached: number;
}

/**
 * Pricing publico OpenAI, tier Standard, contexto corto ($/1M tokens).
 *
 * Familia GPT-5.4/5.5 — snapshot 2026-05-12.
 * Familia GPT-5.6 (sol/terra/luna) — verificado 2026-08-07 contra el anuncio
 * de OpenAI y dos agregadores independientes (eesel.ai, aipricing.guru), que
 * coinciden en $5 / $0,50 / $30 por 1M para `gpt-5.6-sol`.
 *
 * OJO: son tarifas del tier Standard. Batch/Flex facturan 0.5x y Fast 2x, y
 * los prompts >272K tokens de input llevan recargo. `agent_telemetry` no
 * registra el tier, asi que el costo aqui es el del tier Standard.
 */
const PRICING: Record<string, ModelPricing> = {
  // -- GPT-5.6 (default del pipeline financiero desde 2026) ------------------
  'gpt-5.6-sol': { input: 5.0, output: 30.0, cached: 0.5 },
  'gpt-5.6-terra': { input: 2.0, output: 12.0, cached: 0.2 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cached: 0.02 },
  // -- GPT-5.5 / 5.4 --------------------------------------------------------
  'gpt-5.5': { input: 5.0, output: 30.0, cached: 0.5 },
  'gpt-5.4': { input: 2.5, output: 12.5, cached: 0.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cached: 0.075 },
  'gpt-5.4-nano': { input: 0.15, output: 0.6, cached: 0.015 },
};

let overridesCache: Record<string, ModelPricing> | null = null;

/** Lee (y memoiza) `UTOPIA_MODEL_PRICING_JSON`. JSON invalido => se ignora. */
function pricingOverrides(): Record<string, ModelPricing> {
  if (overridesCache) return overridesCache;
  overridesCache = {};
  const raw = process.env.UTOPIA_MODEL_PRICING_JSON;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<ModelPricing>>;
      for (const [id, p] of Object.entries(parsed)) {
        if (
          typeof p?.input === 'number' &&
          typeof p?.output === 'number' &&
          Number.isFinite(p.input) &&
          Number.isFinite(p.output)
        ) {
          overridesCache[normalizeModelId(id)] = {
            input: p.input,
            output: p.output,
            cached: typeof p.cached === 'number' ? p.cached : p.input / 10,
          };
        }
      }
    } catch {
      console.error('[telemetry-pricing] UTOPIA_MODEL_PRICING_JSON no es JSON valido — ignorado.');
    }
  }
  return overridesCache;
}

/**
 * Normaliza el id que llega del provider al id tarifado:
 *   - quita el prefijo legacy de gateway `openai/`
 *   - baja a minusculas
 *   - quita el sufijo de snapshot (`gpt-5.6-sol-2026-05-12`, `...-20260512`)
 * Sin esto, un pin de snapshot en `OPENAI_MODEL_FINANCIAL` tumbaria el pricing
 * al mismo agujero que motivo este fix.
 */
export function normalizeModelId(modelId: string): string {
  let id = (modelId ?? '').trim().toLowerCase();
  if (id.startsWith('openai/')) id = id.slice('openai/'.length);
  id = id.replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, '');
  return id;
}

/** Tarifa aplicable a un modelo, o `null` si no la conocemos. */
export function getModelPricing(modelId: string): ModelPricing | null {
  const id = normalizeModelId(modelId);
  return pricingOverrides()[id] ?? PRICING[id] ?? null;
}

/** Modelos ya reportados como "sin tarifa" — evita inundar los logs. */
const missReported = new Set<string>();

/**
 * Costo de UNA llamada en micro-USD.
 *
 * @returns `null` cuando el modelo no tiene tarifa conocida. NUNCA 0: un 0
 *          falso contamina el SUM del dashboard y silencia la alerta de
 *          presupuesto.
 */
export function calculateCostUsdMicros(args: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number | null {
  const pricing = getModelPricing(args.modelId);
  if (!pricing) {
    const id = normalizeModelId(args.modelId);
    if (!missReported.has(id)) {
      missReported.add(id);
      console.error(
        `[telemetry-pricing] sin tarifa para el modelo "${id}" — la telemetria se guarda con ` +
          `costo NULL y el gasto de este modelo NO cuenta para la alerta de presupuesto. ` +
          `Agregalo a PRICING o define UTOPIA_MODEL_PRICING_JSON.`,
      );
    }
    return null;
  }
  const cached = Math.max(0, args.cachedInputTokens ?? 0);
  const uncachedInput = Math.max(0, args.inputTokens - cached);
  const inputCost = (uncachedInput * pricing.input) / 1_000_000;
  const cachedCost = (cached * pricing.cached) / 1_000_000;
  const outputCost = (Math.max(0, args.outputTokens) * pricing.output) / 1_000_000;
  const totalUsd = inputCost + cachedCost + outputCost;
  return Math.round(totalUsd * 1_000_000);
}

/** Solo para tests: limpia los caches de override y de logs deduplicados. */
export function __resetPricingCachesForTests(): void {
  overridesCache = null;
  missReported.clear();
}

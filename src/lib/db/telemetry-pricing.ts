// ---------------------------------------------------------------------------
// Calculadora de costo por llamada a OpenAI — pricing oficial 2026-05-12
// ---------------------------------------------------------------------------
//
// Mantiene una tabla estatica con $/1M tokens por modelo y devuelve el
// costo total en MICRO-DOLARES (1 USD = 1_000_000 micros). Se almacena en
// `agent_telemetry.cost_usd_micros` como `integer` — preservamos 6 decimales
// de precision sin necesidad de NUMERIC (mas barato + mas rapido para
// agregaciones SUM/AVG en dashboards).
//
// Fuente: developers.openai.com/api/docs/pricing (snapshot 2026-05-12).
// Mantener sincronizado — afecta directamente el `cost_usd_micros` que
// alimenta dashboards de costo y alertas de budget.
//
// Cache pricing: los `cached_input_tokens` (tokens servidos por el prompt
// cache automatico de la Responses API) cobran a 1/10 del precio normal de
// input. La logica de descuento ya esta aplicada: `input_tokens` viene como
// TOTAL (cached + uncached), por lo que restamos el cached antes de
// multiplicar por el precio uncached.
//
// Si un modelo no esta en la tabla devolvemos 0 con warn — no rompemos el
// insert; preferible perder un costo que perder la fila entera de
// telemetria.

/**
 * Pricing oficial OpenAI al 2026-05-12 ($/1M tokens).
 * Mantener sincronizado con pricing público — afecta `cost_usd_micros`.
 *
 * `*_micros` = costo total en MICRO-DÓLARES (1 USD = 1_000_000 micros).
 * Esto preserva 6 decimales sin pérdida de precisión en SQL integer.
 */
const PRICING: Record<string, { input: number; output: number; cached: number }> = {
  'gpt-5.5': { input: 5.00, output: 30.00, cached: 0.50 },
  'gpt-5.4': { input: 2.50, output: 12.50, cached: 0.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50, cached: 0.075 },
  'gpt-5.4-nano': { input: 0.15, output: 0.60, cached: 0.015 },
};

export function calculateCostUsdMicros(args: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number {
  const pricing = PRICING[args.modelId];
  if (!pricing) {
    console.warn(`[telemetry-pricing] sin pricing para modelo "${args.modelId}" — costo=0`);
    return 0;
  }
  const uncachedInput = Math.max(0, args.inputTokens - (args.cachedInputTokens ?? 0));
  const inputCost = (uncachedInput * pricing.input) / 1_000_000;
  const cachedCost = ((args.cachedInputTokens ?? 0) * pricing.cached) / 1_000_000;
  const outputCost = (args.outputTokens * pricing.output) / 1_000_000;
  const totalUsd = inputCost + cachedCost + outputCost;
  return Math.round(totalUsd * 1_000_000);
}

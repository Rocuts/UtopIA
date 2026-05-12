// ---------------------------------------------------------------------------
// `persistAgentTelemetry` — helper fire-and-forget para registrar el `meta`
// que `callFinancialAgent` ya devuelve hoy en cada llamada a un agente LLM.
// ---------------------------------------------------------------------------
//
// Audit observability (P1 audit C): hasta ahora el helper canonico de
// runtime construye `meta` con tokens/elapsed/finish_reason/fallback pero
// el caller lo descarta. Sin persistencia no hay dashboard de costos, ni
// alertas por slot caliente, ni base para tunear `maxOutputTokens`.
//
// Se llama desde `callFinancialAgent` justo antes de devolver el resultado.
// El workspaceId y reportId vienen del context que el caller (orquestador
// del pipeline) setea via `providerOptions.metadata` o equivalente — esa
// integracion la hace F1A; este modulo solo expone la API.
//
// Fire-and-forget: cualquier excepcion se loguea y se traga. La telemetria
// NUNCA debe romper el pipeline. El caller usa `void persistAgentTelemetry(...)`
// o `.catch(() => {})` para no bloquear el return path del agente.

import { getDb } from './client';
import { agentTelemetry, type NewAgentTelemetry } from './schema';
import { calculateCostUsdMicros } from './telemetry-pricing';

/**
 * Persiste telemetría de UNA llamada a `callFinancialAgent`. Es fire-and-forget
 * desde el caller — captura excepciones y solo loggea (no debe bloquear el flujo).
 *
 * Se llama desde `callFinancialAgent` en `src/lib/agents/financial/agents/runtime.ts`
 * justo antes de devolver el resultado. El workspaceId y reportId vienen del context
 * que el caller setea via providerOptions.metadata.
 */
export async function persistAgentTelemetry(
  row: Omit<NewAgentTelemetry, 'id' | 'createdAt' | 'costUsdMicros'> & {
    /** Para calcular costo: tokens individuales + modelId. */
    modelId: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
  },
): Promise<void> {
  try {
    const db = getDb();
    const costUsdMicros = calculateCostUsdMicros({
      modelId: row.modelId,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      cachedInputTokens: row.cachedInputTokens ?? 0,
    });
    await db.insert(agentTelemetry).values({
      ...row,
      costUsdMicros,
    });
  } catch (err) {
    // Fire-and-forget — telemetría no debe romper el pipeline.
    console.error('[persistAgentTelemetry] insert failed:', err);
  }
}

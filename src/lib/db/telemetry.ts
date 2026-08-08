// ---------------------------------------------------------------------------
// `persistAgentTelemetry` — registro fire-and-forget del `meta` que
// `callFinancialAgent` produce en cada llamada a un agente LLM.
// ---------------------------------------------------------------------------
//
// ESTADO ANTERIOR (bug corregido): este helper no tenia NI UN caller. El
// docstring afirmaba "se llama desde callFinancialAgent", pero runtime.ts solo
// hacia `opts.onTelemetry?.(meta)` y ninguno de los ~40 agentes proveia el
// callback. Consecuencia: `agent_telemetry` siempre vacia, y las alertas que
// promete docs/TELEMETRY.md (fallback >3% P1, finishReason!=stop >1% P0, costo
// diario >$50 P1) se calculaban sobre cero filas — observabilidad ficticia.
//
// DISENO ACTUAL: la persistencia la dispara `callFinancialAgent` para TODOS los
// agentes (un solo punto de cableado, no 40). `onTelemetry` se conserva como
// canal de UI (evento SSE `agent_telemetry`), no como via de persistencia.
//
// EL PROBLEMA DEL workspaceId: la columna es NOT NULL, pero runtime.ts no
// recibe el tenant. Se resuelve con un contexto AsyncLocalStorage que el route
// handler abre una vez (`runWithTelemetryContext({ workspaceId }, () => ...)`)
// y que atraviesa todo el pipeline sin tocar 40 firmas. Si no hay contexto ni
// `workspaceId` explicito, la fila se OMITE con un log deduplicado: preferimos
// no medir a romper el pipeline con un insert que viola NOT NULL.
//
// Fire-and-forget: cualquier excepcion se loguea y se traga. La telemetria
// NUNCA debe romper el pipeline ni bloquear su return path.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb } from './client';
import { agentTelemetry } from './schema';
import { calculateCostUsdMicros } from './telemetry-pricing';

// ---------------------------------------------------------------------------
// Contexto de request (tenant + reporte)
// ---------------------------------------------------------------------------

export interface TelemetryContext {
  /** Workspace dueno de la llamada. Sin el no se puede insertar (columna NOT NULL). */
  workspaceId: string;
  /** Reporte que disparo el pipeline, si el orchestrator ya creo la fila. */
  reportId?: string | null;
}

const telemetryStore = new AsyncLocalStorage<TelemetryContext>();

/**
 * Abre el contexto de telemetria para todo lo que ocurra dentro de `fn`
 * (incluidas las continuaciones async). Uso tipico en un route handler:
 *
 * ```ts
 * const workspaceId = await getCurrentWorkspaceId();
 * return runWithTelemetryContext({ workspaceId }, () => runNiifPhase(...));
 * ```
 */
export function runWithTelemetryContext<T>(ctx: TelemetryContext, fn: () => T): T {
  return telemetryStore.run(ctx, fn);
}

/** Contexto activo, si algun ancestro abrio uno. */
export function getTelemetryContext(): TelemetryContext | undefined {
  return telemetryStore.getStore();
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

export interface AgentTelemetryInput {
  /** Si se omite, se toma del contexto AsyncLocalStorage. */
  workspaceId?: string | null;
  reportId?: string | null;
  agentName: string;
  modelId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedInputTokens?: number | null;
  elapsedMs: number;
  finishReason?: string | null;
  fallbackUsed?: boolean;
  firstPassReasoningTokens?: number | null;
  firstPassFinishReason?: string | null;
}

/** Agentes ya reportados como "sin workspace" — evita inundar los logs. */
const missingWorkspaceReported = new Set<string>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Último recurso cuando no hay contexto explícito: resolver el tenant desde el
 * request activo (sesión BetterAuth o cookie `utopia_workspace_id`).
 *
 * Es best-effort a propósito — `cookies()` lanza si se llama fuera del scope de
 * request (p.ej. dentro del callback de un ReadableStream SSE), y en ese caso
 * simplemente no medimos. La función que consulta es de SOLO LECTURA: no crea
 * workspaces, así que la telemetría nunca puede alterar el estado del tenant.
 */
async function resolveWorkspaceFromRequest(): Promise<string | null> {
  try {
    const { getCurrentWorkspaceId } = await import('./workspace');
    const id = await getCurrentWorkspaceId();
    return id && UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Persiste la telemetria de UNA llamada a `callFinancialAgent`.
 *
 * Fire-and-forget: nunca lanza. Devuelve `true` si la fila se inserto, `false`
 * si se omitio (sin workspace, sin DB configurada o error de insert) — el valor
 * existe para los tests; el caller de produccion la invoca con `void`.
 */
export async function persistAgentTelemetry(row: AgentTelemetryInput): Promise<boolean> {
  try {
    // Sin DATABASE_URL (tests unitarios, build) no hay nada que escribir.
    if (!process.env.DATABASE_URL) return false;

    const ctx = getTelemetryContext();
    const workspaceId =
      row.workspaceId ?? ctx?.workspaceId ?? (await resolveWorkspaceFromRequest());

    if (!workspaceId) {
      if (!missingWorkspaceReported.has(row.agentName)) {
        missingWorkspaceReported.add(row.agentName);
        console.warn(
          `[persistAgentTelemetry] sin workspaceId para "${row.agentName}" — fila omitida. ` +
            `Envuelve el pipeline en runWithTelemetryContext({ workspaceId }) desde el route handler.`,
        );
      }
      return false;
    }

    const costUsdMicros = calculateCostUsdMicros({
      modelId: row.modelId,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      cachedInputTokens: row.cachedInputTokens ?? 0,
    });

    const db = getDb();
    await db.insert(agentTelemetry).values({
      workspaceId,
      reportId: row.reportId ?? ctx?.reportId ?? null,
      agentName: row.agentName,
      modelId: row.modelId,
      inputTokens: row.inputTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      reasoningTokens: row.reasoningTokens ?? null,
      cachedInputTokens: row.cachedInputTokens ?? null,
      // `null` (no 0) cuando no conocemos la tarifa del modelo — ver
      // telemetry-pricing.ts.
      costUsdMicros,
      elapsedMs: Math.max(0, Math.round(row.elapsedMs)),
      finishReason: row.finishReason ?? null,
      fallbackUsed: row.fallbackUsed ?? false,
      firstPassReasoningTokens: row.firstPassReasoningTokens ?? null,
      firstPassFinishReason: row.firstPassFinishReason ?? null,
    });
    return true;
  } catch (err) {
    // Fire-and-forget — telemetria no debe romper el pipeline.
    console.error('[persistAgentTelemetry] insert failed:', err);
    return false;
  }
}

/** Solo para tests: limpia la deduplicacion de logs. */
export function __resetTelemetryLogDedupeForTests(): void {
  missingWorkspaceReported.clear();
}

// ---------------------------------------------------------------------------
// Lightweight agent telemetry — used by ToolLoopAgent's onStepFinish hook
// ---------------------------------------------------------------------------
// Diseñado para ser estructurado (un único console.log JSON por step), barato y
// fácil de redirigir a Datadog/Logtail/etc. sin dependencias adicionales.
//
// La auditoría 0.E pidió un wrapper logAgentCall({agent, model, tokens,
// latencyMs, workspaceId, requestId}) — aquí está la implementación mínima.
// Cualquier consumidor (BaseSpecialist, financial pipelines, audit pipelines)
// puede llamar `logAgentCall()` directo o pasar `agentStepLogger()` como
// `onStepFinish` a un `ToolLoopAgent`.
// ---------------------------------------------------------------------------

import type { OnStepFinishEvent, ToolSet, LanguageModelUsage } from 'ai';

export interface AgentLogEntry {
  /** Logical agent name — e.g. "tax", "accounting", "synthesizer". */
  agent: string;
  /** Model id reported by the provider (e.g. "gpt-4o-mini"). */
  model?: string;
  /** Provider id (e.g. "openai"). */
  provider?: string;
  /** Step number (zero-based). Undefined for one-shot calls. */
  step?: number;
  /** Reason for finishing this step (stop, tool-calls, length, ...). */
  finishReason?: string;
  /** Names of tools the step invoked. */
  toolsUsed?: string[];
  /** Token usage on this step. */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Latency in ms (start → end of step or full call). */
  latencyMs?: number;
  /** Optional tenant identifier. */
  workspaceId?: string;
  /** Optional request id (e.g. SSE stream id, route handler invocation id). */
  requestId?: string;
  /** Free-form extra data for the entry. */
  extra?: Record<string, unknown>;
}

const ENABLED =
  typeof process !== 'undefined' &&
  process.env.UTOPIA_AGENT_TELEMETRY !== 'off';

/**
 * Emit a single structured log line.
 * Falls back to silent when `UTOPIA_AGENT_TELEMETRY=off`.
 */
export function logAgentCall(entry: AgentLogEntry): void {
  if (!ENABLED) return;
  try {
    // Structured single-line JSON keeps this drainable to log aggregators.
    console.log(
      `[agent] ${JSON.stringify({ ts: new Date().toISOString(), ...entry })}`,
    );
  } catch {
    // Never crash a request because of logging.
  }
}

/**
 * Build a `onStepFinish` callback for a ToolLoopAgent (or generateText/streamText).
 * Wires step-level telemetry without leaking implementation details.
 */
export function agentStepLogger(meta: {
  agent: string;
  workspaceId?: string;
  requestId?: string;
  /** Optional override for start time so latency is computed against external anchor. */
  startedAt?: number;
}): <TOOLS extends ToolSet>(event: OnStepFinishEvent<TOOLS>) => void {
  let lastEnd = meta.startedAt ?? Date.now();
  return (event) => {
    const now = Date.now();
    const latencyMs = now - lastEnd;
    lastEnd = now;

    const usage: LanguageModelUsage | undefined = event.usage;
    const toolsUsed = (event.toolCalls ?? []).map((tc) => tc.toolName);

    logAgentCall({
      agent: meta.agent,
      model: event.model?.modelId,
      provider: event.model?.provider,
      step: event.stepNumber,
      finishReason: event.finishReason,
      toolsUsed: toolsUsed.length ? toolsUsed : undefined,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      latencyMs,
      workspaceId: meta.workspaceId,
      requestId: meta.requestId,
    });
  };
}

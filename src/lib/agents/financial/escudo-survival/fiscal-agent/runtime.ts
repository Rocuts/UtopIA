// ---------------------------------------------------------------------------
// Capa 4 — Agente Fiscal — Runtime wrapper
// ---------------------------------------------------------------------------
//
// `callFiscalAgent` es un wrapper temático sobre `callFinancialAgent` que:
//   - Inyecta el slot `MODELS_CONFIG[slot]` correcto (reasoningEffort,
//     textVerbosity, maxOutputTokens) según el módulo del Agente Fiscal.
//   - Setea el modelo por defecto a `MODELS.FINANCIAL_PIPELINE` (override por
//     `OPENAI_MODEL_FINANCIAL`).
//   - Estandariza el `agentName` con prefijo "escudo-fiscal:" para telemetría.
//
// El consumidor (cada módulo en `agents/**`) llama a `callFiscalAgent` con su
// schema Zod, su system prompt y el userContent dinámico — no necesita
// preocuparse por el slot ni por el modelo.
// ---------------------------------------------------------------------------

import type { z } from 'zod';
import { MODELS, MODELS_CONFIG, type AgentSlot } from '@/lib/config/models';
import {
  callFinancialAgent,
  type CallFinancialAgentResult,
} from '../../agents/runtime';

export type FiscalAgentSlot = Extract<
  AgentSlot,
  | 'escudoFiscalCcv'
  | 'escudoFiscalConciliacion'
  | 'escudoFiscalRiskScore'
  | 'escudoFiscalPlaneacion'
  | 'escudoFiscalDefensaDian'
  | 'escudoFiscalDevoluciones'
  | 'escudoFiscalSupervivencia'
  | 'escudoFiscalSynthesizer'
>;

export interface CallFiscalAgentOptions<TSchema extends z.ZodTypeAny> {
  /** Identificador legible — concatenado con prefijo "escudo-fiscal:". */
  module: string;
  /** Slot de configuración. */
  slot: FiscalAgentSlot;
  /** Schema Zod estricto (.nullable() en lugar de .optional()). */
  schema: TSchema;
  /** System prompt (cabecera estable + <task> + <context> + <success_criteria>). */
  system: string;
  /** User content dinámico por request. */
  userContent: string;
  /** Aborts (timeout SSE). */
  signal?: AbortSignal;
  /** Override de telemetría. */
  onTelemetry?: (meta: CallFinancialAgentResult<TSchema>['meta']) => void;
}

export async function callFiscalAgent<TSchema extends z.ZodTypeAny>(
  opts: CallFiscalAgentOptions<TSchema>,
): Promise<CallFinancialAgentResult<TSchema>> {
  const cfg = MODELS_CONFIG[opts.slot];
  return callFinancialAgent({
    agentName: `escudo-fiscal:${opts.module}`,
    model: MODELS.FINANCIAL_PIPELINE,
    schema: opts.schema,
    system: opts.system,
    userContent: opts.userContent,
    maxOutputTokens: cfg.maxOutputTokens,
    reasoningEffort: cfg.reasoningEffort,
    textVerbosity: cfg.textVerbosity,
    signal: opts.signal,
    onTelemetry: opts.onTelemetry,
  });
}

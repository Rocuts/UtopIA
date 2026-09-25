'use client';

// ---------------------------------------------------------------------------
// useFiscalAgentSSE — SSE consumer for /api/escudo/fiscal
// ---------------------------------------------------------------------------
//
// Mirrors the pattern of useEscudoSurvival but targets Capa 4 (Agente Fiscal).
// SSE events from the server:
//   progress       — FiscalAgentProgressEvent (stage started/completed/failed)
//   module_complete — { stage, data: <module result> }
//   report          — { report: FiscalAgentReport }
//   done            — { partial: boolean }
//   error           — { error: string, detail?: string, code?, reasons? }
// ---------------------------------------------------------------------------

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  FiscalAgentReport,
  FiscalAgentProgressEvent,
  FiscalAgentMode,
  FiscalAgentOrchestratorInput,
} from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import {
  escudoErrorFromHttp,
  escudoErrorFromSse,
} from '@/components/workspace/escudo/escudo-error';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FiscalAgentState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'streaming'; progress: FiscalAgentProgressEvent[] }
  | {
      status: 'done';
      report: FiscalAgentReport;
      progress: FiscalAgentProgressEvent[];
    }
  | {
      status: 'error';
      error: string;
      /**
       * Razones del bloqueo del balance (422 / evento `error` con
       * `code: 'BALANCE_VALIDATION_FAILED'`), para que el panel las muestre.
       */
      reasons?: string[];
      progress: FiscalAgentProgressEvent[];
    };

export interface FiscalAgentStartInput {
  rawData: string;
  mode: FiscalAgentMode;
  company?: {
    name?: string;
    nit?: string;
    sector?: string;
    ciiu?: string;
  };
  language?: 'es' | 'en';
  instructions?: string;
  dianRequirementText?: string;
  dianRequirementKind?: FiscalAgentOrchestratorInput['dianRequirementKind'];
  /**
   * Saldo a favor LIQUIDADO en la declaración de renta (Formulario 110), en
   * centavos MoneyCop (string de enteros no negativos). Sin él la devolución
   * queda N/D: F04 es una estimación contable, no la declaración
   * (tributario-modulos-02).
   */
  saldoAFavorDeclaradoCents?: string | null;
}

/**
 * Cuerpo JSON para POST /api/escudo/fiscal. `saldoAFavorDeclaradoCents` sólo
 * viaja cuando se conoce: nunca se sustituye por 0 ni por F04.
 */
export function buildFiscalAgentRequestBody(input: FiscalAgentStartInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    rawData: input.rawData,
    mode: input.mode,
    language: input.language ?? 'es',
    company: input.company,
    instructions: input.instructions,
    dianRequirementText: input.dianRequirementText,
    dianRequirementKind: input.dianRequirementKind,
  };
  const saldo = input.saldoAFavorDeclaradoCents?.trim();
  if (saldo) body.saldoAFavorDeclaradoCents = saldo;
  return body;
}

export interface UseFiscalAgentSSE {
  state: FiscalAgentState;
  start: (input: FiscalAgentStartInput) => void;
  abort: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// SSE block parser — re-uses the same pattern as useEscudoSurvival
// ---------------------------------------------------------------------------

interface SseBlock {
  event: string;
  data: string;
}

function parseSseChunk(chunk: string): { blocks: SseBlock[]; remainder: string } {
  const blocks: SseBlock[] = [];
  const parts = chunk.split(/\n\n/);
  const remainder = parts.pop() ?? '';

  for (const part of parts) {
    const lines = part.split('\n');
    let event = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.slice('event: '.length).trim();
      } else if (line.startsWith('data: ')) {
        data = line.slice('data: '.length).trim();
      }
    }

    if (data) {
      blocks.push({ event, data });
    }
  }

  return { blocks, remainder };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFiscalAgentSSE(): UseFiscalAgentSSE {
  const [state, setState] = useState<FiscalAgentState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (input: FiscalAgentStartInput) => {
    // Cancel any running stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: 'submitting' });

    try {
      const res = await fetch('/api/escudo/fiscal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stream': 'true',
        },
        body: JSON.stringify(buildFiscalAgentRequestBody(input)),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        // 422 del balance bloqueado: { error, code, reasons } (I4-escudo 1).
        const info = escudoErrorFromHttp(res.status, text);
        setState({
          status: 'error',
          error: info.error,
          reasons: info.reasons,
          progress: [],
        });
        return;
      }

      if (!res.body) {
        setState({
          status: 'error',
          error: 'Respuesta sin cuerpo del servidor.',
          progress: [],
        });
        return;
      }

      setState({ status: 'streaming', progress: [] });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let progressAcc: FiscalAgentProgressEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { blocks, remainder } = parseSseChunk(buffer);
        buffer = remainder;

        for (const block of blocks) {
          if (block.event === 'progress') {
            try {
              const evt = JSON.parse(block.data) as FiscalAgentProgressEvent;
              progressAcc = [...progressAcc, evt];
              setState({ status: 'streaming', progress: progressAcc });
            } catch {
              // Malformed progress event — skip
            }
          } else if (block.event === 'report') {
            try {
              const parsed = JSON.parse(block.data) as { report: FiscalAgentReport };
              setState({
                status: 'done',
                report: parsed.report,
                progress: progressAcc,
              });
            } catch {
              setState({
                status: 'error',
                error: 'Respuesta del servidor inválida.',
                progress: progressAcc,
              });
            }
          } else if (block.event === 'done') {
            // `done` arrives after `report` — no extra state change needed
            // (state already 'done'). Guard in case report arrives after done.
          } else if (block.event === 'error') {
            // Con el balance bloqueado trae `reasons` (I4-escudo 1).
            const info = escudoErrorFromSse(block.data, 'Error en el análisis.');
            setState({
              status: 'error',
              error: info.error,
              reasons: info.reasons,
              progress: progressAcc,
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState({
        status: 'error',
        error: (err as Error).message ?? 'Error de conexión.',
        progress: [],
      });
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: 'idle' });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: 'idle' });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { state, start, abort, reset };
}

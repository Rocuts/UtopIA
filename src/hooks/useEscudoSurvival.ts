'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  EscudoSurvivalReport,
  EscudoSurvivalProgressEvent,
  CompanyContext,
  Language,
} from '@/lib/agents/financial/escudo-survival/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type UseEscudoSurvivalState =
  | { status: 'idle' }
  | { status: 'running'; progress: EscudoSurvivalProgressEvent[] }
  | {
      status: 'done';
      report: EscudoSurvivalReport;
      progress: EscudoSurvivalProgressEvent[];
    }
  | { status: 'error'; error: string; progress: EscudoSurvivalProgressEvent[] };

export interface StartInput {
  rawData: string;
  company?: CompanyContext;
  language?: Language;
  instructions?: string;
}

// ---------------------------------------------------------------------------
// SSE parser helper
// Parser reads a chunk of text and extracts complete SSE blocks separated
// by double newlines. Returns { events, remainder }.
// ---------------------------------------------------------------------------

interface SseBlock {
  event: string;
  data: string;
}

function parseSseChunk(
  chunk: string,
): { blocks: SseBlock[]; remainder: string } {
  const blocks: SseBlock[] = [];
  // Split on double-newline (SSE block separator)
  const parts = chunk.split(/\n\n/);
  // Last element is the trailing incomplete block (no double-newline yet)
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

export function useEscudoSurvival() {
  const [state, setState] = useState<UseEscudoSurvivalState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (input: StartInput) => {
    // Cancel any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: 'running', progress: [] });

    try {
      const res = await fetch('/api/escudo-survival', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stream': 'true',
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        setState({
          status: 'error',
          error: text || `HTTP ${res.status}`,
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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let progressAcc: EscudoSurvivalProgressEvent[] = [];

      while (true) { // infinite read loop — breaks on stream done
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { blocks, remainder } = parseSseChunk(buffer);
        buffer = remainder;

        for (const block of blocks) {
          if (block.event === 'progress') {
            try {
              const evt = JSON.parse(block.data) as EscudoSurvivalProgressEvent;
              progressAcc = [...progressAcc, evt];
              setState({ status: 'running', progress: progressAcc });
            } catch {
              // Malformed progress event — skip
            }
          } else if (block.event === 'result') {
            try {
              const report = JSON.parse(block.data) as EscudoSurvivalReport;
              setState({ status: 'done', report, progress: progressAcc });
            } catch {
              setState({
                status: 'error',
                error: 'Respuesta del servidor inválida.',
                progress: progressAcc,
              });
            }
          } else if (block.event === 'error') {
            try {
              const err = JSON.parse(block.data) as {
                error: string;
                detail?: string;
              };
              setState({
                status: 'error',
                error: err.error ?? 'Error desconocido en el análisis.',
                progress: progressAcc,
              });
            } catch {
              setState({
                status: 'error',
                error: 'Error en el análisis.',
                progress: progressAcc,
              });
            }
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

  const cancel = useCallback(() => {
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

  return { state, start, cancel, reset };
}

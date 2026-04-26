'use client';

// ---------------------------------------------------------------------------
// useRepairChat — hook que maneja el ciclo de vida del chat con el "Doctor de
// Datos" (Phase 1). Consume `/api/repair-chat` via SSE con eventos:
//   - token        → delta de texto del asistente
//   - tool_call    → el agente invocó una tool (read_account / mark_provisional)
//   - tool_result  → resultado de la tool
//   - action       → side-channel: el agente decidió que el usuario debería
//                    confirmar marcar el reporte como provisional (override)
//   - done         → fin del turno (flush del pending → messages)
//   - error        → falla del backend
//
// Server es stateless — el contexto (errorMessage, rawCsv, language, …) viaja
// en cada request. El hook solo mantiene el historial cliente.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { consumeSSE } from '@/lib/sse/consume';
import type {
  RepairContext,
  RepairMessage,
  RepairChatRequest,
  RepairTokenEvent,
  RepairToolCallEvent,
  RepairToolResultEvent,
  RepairActionEvent,
  RepairErrorEvent,
  RepairToolName,
} from '@/lib/agents/repair/types';

// ─── Tipos públicos del hook ────────────────────────────────────────────────

export interface RepairToolInvocation {
  id: string;
  name: RepairToolName;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface UseRepairChat {
  messages: RepairMessage[];
  pendingAssistant: string;
  toolCalls: RepairToolInvocation[];
  isLoading: boolean;
  error: string | null;
  pendingProvisionalReason: string | null;
  sendMessage: (content: string) => Promise<void>;
  abort: () => void;
  resetError: () => void;
  consumeProvisional: () => string | null;
}

// ─── Implementación ─────────────────────────────────────────────────────────

export function useRepairChat(initialContext: RepairContext): UseRepairChat {
  const [messages, setMessages] = useState<RepairMessage[]>([]);
  const [pendingAssistant, setPendingAssistant] = useState('');
  const [toolCalls, setToolCalls] = useState<RepairToolInvocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingProvisionalReason, setPendingProvisionalReason] =
    useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Mantenemos el contexto inicial en una ref para que `sendMessage` no se
  // re-cree cada vez que el host pase una referencia nueva (objetos inline).
  // El contexto es estable durante la sesión; si el host necesita cambiarlo
  // debe re-montar el hook (lo que es coherente con el contrato Phase 1).
  const contextRef = useRef<RepairContext>(initialContext);
  useEffect(() => {
    contextRef.current = initialContext;
  }, [initialContext]);

  // Cleanup: si el componente se desmonta con un fetch en curso, abortar.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const consumeProvisional = useCallback((): string | null => {
    let captured: string | null = null;
    setPendingProvisionalReason((prev) => {
      captured = prev;
      return null;
    });
    return captured;
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isLoading) return;

      // Snapshot del historial ANTES de mutarlo, para construir el payload.
      const priorMessages = messages;
      const userMessage: RepairMessage = { role: 'user', content: trimmed };

      setMessages((prev) => [...prev, userMessage]);
      setPendingAssistant('');
      setError(null);
      setIsLoading(true);

      // Cancelar cualquier request previo.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Acumulador local de tokens — el state `pendingAssistant` sirve a la UI
      // pero al cerrar el stream necesitamos el texto completo para hacer
      // flush a `messages` sin depender del orden de batching de React.
      let streamedText = '';

      try {
        const payload: RepairChatRequest = {
          messages: [...priorMessages, userMessage],
          context: contextRef.current,
        };

        const response = await fetch('/api/repair-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await consumeSSE(response, controller.signal, {
          token: (raw) => {
            const delta = (raw as RepairTokenEvent)?.delta ?? '';
            if (!delta) return;
            streamedText += delta;
            setPendingAssistant(streamedText);
          },
          tool_call: (raw) => {
            const ev = raw as RepairToolCallEvent;
            if (!ev?.id || !ev?.name) return;
            setToolCalls((prev) => [
              ...prev,
              { id: ev.id, name: ev.name, args: ev.args ?? {} },
            ]);
          },
          tool_result: (raw) => {
            const ev = raw as RepairToolResultEvent;
            if (!ev?.id) return;
            setToolCalls((prev) =>
              prev.map((tc) =>
                tc.id === ev.id ? { ...tc, result: ev.result } : tc,
              ),
            );
          },
          action: (raw) => {
            const ev = raw as RepairActionEvent;
            if (ev?.type === 'mark_provisional' && typeof ev.reason === 'string') {
              setPendingProvisionalReason(ev.reason);
            }
          },
          done: () => {
            // Flush del texto streameado al historial. Si no hubo tokens (turno
            // que terminó solo en tool-calls sin respuesta final) NO empujamos
            // un mensaje vacío.
            if (streamedText.trim()) {
              const assistantMessage: RepairMessage = {
                role: 'assistant',
                content: streamedText,
              };
              setMessages((prev) => [...prev, assistantMessage]);
            }
            setPendingAssistant('');
            setIsLoading(false);
          },
          error: (raw) => {
            const ev = raw as RepairErrorEvent;
            const msg =
              ev?.detail ||
              ev?.error ||
              (contextRef.current.language === 'en'
                ? 'The repair chat failed.'
                : 'El chat de reparación falló.');
            // Throw para que `consumeSSE` propague y caiga al catch de abajo.
            throw new Error(msg);
          },
        });

        // Si el server cerró el stream sin emitir `done` (caso degradado),
        // hacemos flush defensivo aquí.
        if (streamedText.trim() && isLoadingRef.current) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.content === streamedText) {
              return prev;
            }
            return [...prev, { role: 'assistant', content: streamedText }];
          });
          setPendingAssistant('');
        }
      } catch (err) {
        const name = (err as Error | undefined)?.name;
        if (name === 'AbortError') {
          // Aborto explícito o unmount — no es un error visible.
          setPendingAssistant('');
          return;
        }
        const msg =
          err instanceof Error
            ? err.message
            : contextRef.current.language === 'en'
              ? 'Unknown error.'
              : 'Error desconocido.';
        setError(msg);
      } finally {
        // Si seguimos en loading (caso de error que no pasó por `done`), apagar.
        setIsLoading(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [isLoading, messages],
  );

  // Ref espejo de `isLoading` para usar dentro del `consumeSSE` sin re-cerrar
  // closures. Lo declaramos al final para minimizar reordenamientos del hook
  // anterior — las reglas de hooks se respetan porque siempre se llama.
  const isLoadingRef = useRef(false);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  return {
    messages,
    pendingAssistant,
    toolCalls,
    isLoading,
    error,
    pendingProvisionalReason,
    sendMessage,
    abort,
    resetError,
    consumeProvisional,
  };
}

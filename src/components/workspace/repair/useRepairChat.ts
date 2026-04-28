'use client';

// ---------------------------------------------------------------------------
// useRepairChat — hook que maneja el ciclo de vida del chat con el "Doctor de
// Datos".
//
// Phase 1: read-only diagnostics (read_account, mark_provisional).
// Phase 2: collaborative repair — el agente puede proponer ajustes
//   (`propose_adjustment`), pedir confirmación al usuario (`apply_adjustment` →
//   action `confirm_adjustment`), y revalidar la ecuación contable
//   (`recheck_validation`). El estado canónico (adjustment ledger) vive en el
//   cliente y se replay-ea al servidor en cada `sendMessage`.
//
// Eventos SSE consumidos:
//   - token        → delta de texto del asistente
//   - tool_call    → el agente invocó una tool
//   - tool_result  → resultado de la tool
//   - action       → side-channel (mark_provisional | confirm_adjustment)
//   - done         → fin del turno
//   - error        → falla del backend
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { consumeSSE } from '@/lib/sse/consume';
import type {
  Adjustment,
  ProposeAdjustmentInput,
  ProposeAdjustmentOutput,
  RecheckValidationOutput,
  RepairContext,
  RepairMessage,
  RepairChatRequest,
  RepairTokenEvent,
  RepairToolCallEvent,
  RepairToolResultEvent,
  RepairActionEvent,
  RepairErrorEvent,
  RepairToolErrorEvent,
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
  // Phase 1
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

  // Phase 2
  adjustments: Adjustment[];
  pendingAdjustmentId: string | null;
  validationStatus: RecheckValidationOutput | null;
  confirmAdjustment: (id: string) => void;
  rejectAdjustment: (id: string) => void;
  consumeAdjustmentConfirmation: () => string | null;

  // Phase 3 hardening (P1 fixes)
  /** Last schema-failed / unknown / executor-failed tool call surfaced by the backend. */
  toolError: RepairToolErrorEvent | null;
  /** Dismiss the current tool error banner. */
  clearToolError: () => void;
  /** Last autosave failure message (localized). null when last autosave succeeded. */
  autosaveError: string | null;
  /** Dismiss the autosave error banner. */
  clearAutosaveError: () => void;
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

  // Phase 2 state
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [pendingAdjustmentId, setPendingAdjustmentId] = useState<string | null>(
    null,
  );
  const [validationStatus, setValidationStatus] =
    useState<RecheckValidationOutput | null>(null);

  // Phase 3 hardening: P1 banners.
  // - toolError: last schema/exec failure emitted by backend via SSE `tool_error`.
  // - autosaveError: last localized message when the autosave PUT failed.
  const [toolError, setToolError] = useState<RepairToolErrorEvent | null>(null);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Mantenemos el contexto inicial en una ref para que `sendMessage` no se
  // re-cree cada vez que el host pase una referencia nueva (objetos inline).
  const contextRef = useRef<RepairContext>(initialContext);
  useEffect(() => {
    contextRef.current = initialContext;
  }, [initialContext]);

  // Espejo del adjustment ledger para enviarlo en `sendMessage` sin recrear
  // el callback con cada cambio del state.
  const adjustmentsRef = useRef<Adjustment[]>([]);
  useEffect(() => {
    adjustmentsRef.current = adjustments;
  }, [adjustments]);

  // Cache toolCallId → args. Cuando llega un `tool_result` de
  // `propose_adjustment`, el `result` solo trae `id` y `preview`; los datos
  // originales (accountCode, accountName, amount, rationale) están en los
  // args del tool_call previo. Los recordamos por id.
  // Ref (no state): no afecta render, no debe disparar re-renders, y no se
  // serializa al servidor — se reconstruye en cada montaje (consistente con
  // el modelo stateless del server).
  const toolCallArgsRef = useRef<Map<string, Record<string, unknown>>>(
    new Map(),
  );

  // Cleanup: si el componente se desmonta con un fetch en curso, abortar.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      // Cancelar autosave debounce pendiente al desmontar.
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, []);

  // ─── Phase 3: hidratación + autosave ──────────────────────────────────────
  //
  // Hidratación one-shot por conversationId: al montar, hace GET /api/
  // repair-session y rehidrata el ledger. NO toca `messages` (esos siguen
  // siendo ephemeral por ahora).
  //
  // `hydratedRef` bloquea el autosave hasta que la hidratación termine; sin
  // esto, el primer render (adjustments = []) dispararía un PUT que borraría
  // los adjustments persistidos antes de poder leerlos.
  const hydratedRef = useRef(false);
  // Track del conversationId que ya hidratamos, para re-hidratar si el
  // host cambia el contexto a una sesión distinta (raro, pero posible).
  const hydratedConversationIdRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightAutosaveRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cid = initialContext.conversationId;
    if (!cid) return;
    if (hydratedConversationIdRef.current === cid) return;

    hydratedRef.current = false;
    hydratedConversationIdRef.current = cid;

    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/repair-session?conversationId=${encodeURIComponent(cid)}`,
          { signal: ctrl.signal, credentials: 'same-origin' },
        );
        if (!res.ok) {
          // 4xx/5xx: silently fallback to empty state. La persistencia es
          // best-effort, no debe romper el chat.
          return;
        }
        const json = (await res.json()) as {
          session: { adjustments?: Adjustment[] } | null;
        };
        if (json?.session && Array.isArray(json.session.adjustments)) {
          // Reemplazo total del ledger — el server es la autoridad. Si la
          // sesión persistida tiene array vacío (todos rechazados o ninguno
          // confirmado todavía), TAMBIEN reemplazamos: si dejamos el state
          // local intacto, una sesión "limpia" en DB convivira con ajustes
          // ephemeral del cliente y se desincronizan irreversiblemente.
          setAdjustments(json.session.adjustments);
        }
      } catch (err) {
        if ((err as Error | undefined)?.name !== 'AbortError') {
          console.error('[useRepairChat] hydrate failed', err);
        }
      } finally {
        hydratedRef.current = true;
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [initialContext.conversationId]);

  // Autosave debounce 500 ms: cada cambio en `adjustments` programa un PUT.
  // Si llega otro cambio antes de que dispare, reinicia el timer (debounce
  // estándar). Solo un PUT en vuelo a la vez (cancelamos el anterior).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const ctx = contextRef.current;
    if (!ctx?.conversationId) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;

      // Cancelar PUT previo si seguía corriendo.
      inFlightAutosaveRef.current?.abort();
      const ctrl = new AbortController();
      inFlightAutosaveRef.current = ctrl;

      const body = {
        conversationId: ctx.conversationId,
        errorMessage: ctx.errorMessage,
        rawCsv: ctx.rawCsv,
        language: ctx.language,
        companyName: ctx.companyName,
        period: ctx.period,
        // Phase 3 P1 fix #4: el host inyecta el provisional flag en el
        // RepairContext (campo opcional). Si está, lo persistimos para que un
        // reload preserve la intención del usuario.
        provisional: ctx.provisional ?? null,
        status: 'open' as const,
        adjustments: adjustmentsRef.current,
      };

      const failureMessage =
        ctx.language === 'en'
          ? "We couldn't save your changes. We'll retry."
          : 'No pudimos guardar los cambios. Se reintentarán.';

      fetch('/api/repair-session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        credentials: 'same-origin',
      })
        .then((res) => {
          if (!res.ok) {
            console.error(
              '[useRepairChat] autosave non-2xx',
              res.status,
            );
            setAutosaveError(failureMessage);
          } else {
            // Éxito: limpiar cualquier banner anterior. Solo mutamos si
            // estaba en error para evitar renders innecesarios.
            setAutosaveError((prev) => (prev === null ? prev : null));
          }
        })
        .catch((err) => {
          if ((err as Error | undefined)?.name !== 'AbortError') {
            console.error('[useRepairChat] autosave failed', err);
            setAutosaveError(failureMessage);
          }
        })
        .finally(() => {
          if (inFlightAutosaveRef.current === ctrl) {
            inFlightAutosaveRef.current = null;
          }
        });
    }, 500);

    return () => {
      // Si `adjustments` cambia otra vez antes del timeout, lo limpiamos
      // y se re-programa en el siguiente run del efecto.
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [adjustments]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const clearToolError = useCallback(() => {
    setToolError(null);
  }, []);

  const clearAutosaveError = useCallback(() => {
    setAutosaveError(null);
  }, []);

  const consumeProvisional = useCallback((): string | null => {
    let captured: string | null = null;
    setPendingProvisionalReason((prev) => {
      captured = prev;
      return null;
    });
    return captured;
  }, []);

  const consumeAdjustmentConfirmation = useCallback((): string | null => {
    let captured: string | null = null;
    setPendingAdjustmentId((prev) => {
      captured = prev;
      return null;
    });
    return captured;
  }, []);

  const confirmAdjustment = useCallback((id: string) => {
    const nowIso = new Date().toISOString();
    setAdjustments((prev) =>
      prev.map((adj) =>
        adj.id === id && adj.status === 'proposed'
          ? { ...adj, status: 'applied', appliedAt: nowIso }
          : adj,
      ),
    );
    // Limpia el pending solo si coincide; si la UI ya lo había consumido,
    // este set es no-op.
    setPendingAdjustmentId((prev) => (prev === id ? null : prev));
  }, []);

  const rejectAdjustment = useCallback((id: string) => {
    const nowIso = new Date().toISOString();
    setAdjustments((prev) =>
      prev.map((adj) =>
        adj.id === id && adj.status === 'proposed'
          ? { ...adj, status: 'rejected', rejectedAt: nowIso }
          : adj,
      ),
    );
    setPendingAdjustmentId((prev) => (prev === id ? null : prev));
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
          adjustments: adjustmentsRef.current,
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
            const args = ev.args ?? {};
            // Cachear args para emparejar con el tool_result subsiguiente.
            toolCallArgsRef.current.set(ev.id, args);
            setToolCalls((prev) => [
              ...prev,
              { id: ev.id, name: ev.name, args },
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

            // Phase 2: side-effects de tool results específicos.
            //
            // propose_adjustment → agregar Adjustment 'proposed' al ledger.
            // recheck_validation → guardar el último estado de validación.
            //
            // Buscamos el nombre via el tool_call cacheado por id (`toolCalls`
            // del state aún no refleja el cambio de este tick — usamos el ref).
            const cachedArgs = toolCallArgsRef.current.get(ev.id);
            if (!cachedArgs) return;

            // El `name` no está en el tool_result event, así que lo
            // recuperamos desde el state via búsqueda. Como el state es
            // asíncrono, dependemos del ref de toolCallNames separado.
            const name = toolCallNamesRef.current.get(ev.id);
            if (!name) return;

            if (name === 'propose_adjustment') {
              const result = ev.result as ProposeAdjustmentOutput | undefined;
              if (!result?.id) return;
              const input = cachedArgs as unknown as ProposeAdjustmentInput;

              // Si por alguna razón el server reusara un id (improbable),
              // hacemos upsert idempotente.
              setAdjustments((prev) => {
                if (prev.some((a) => a.id === result.id)) return prev;
                const adj: Adjustment = {
                  id: result.id,
                  accountCode: String(input.accountCode ?? ''),
                  accountName:
                    input.accountName ??
                    result.preview?.affectedAccount?.name ??
                    `Cuenta ${input.accountCode ?? '?'}`,
                  amount: Number(input.amount ?? 0),
                  rationale: String(input.rationale ?? ''),
                  status: 'proposed',
                  proposedAt: new Date().toISOString(),
                };
                return [...prev, adj];
              });
            } else if (name === 'recheck_validation') {
              const result = ev.result as RecheckValidationOutput | undefined;
              if (
                result &&
                typeof result === 'object' &&
                'ok' in result &&
                'controlTotals' in result
              ) {
                setValidationStatus(result);
              }
            }
          },
          action: (raw) => {
            const ev = raw as RepairActionEvent;
            if (!ev || typeof ev !== 'object' || !('type' in ev)) return;
            if (ev.type === 'mark_provisional' && typeof ev.reason === 'string') {
              setPendingProvisionalReason(ev.reason);
            } else if (
              ev.type === 'confirm_adjustment' &&
              typeof ev.adjustmentId === 'string'
            ) {
              setPendingAdjustmentId(ev.adjustmentId);
            }
          },
          tool_error: (raw) => {
            // Phase 3 P1 fix #1: backend emite este evento cuando un tool call
            // falla por schema/unknown/exec. La UI muestra un strip dismissible.
            const ev = raw as RepairToolErrorEvent;
            if (!ev || typeof ev !== 'object' || !('message' in ev)) return;
            setToolError({
              id: typeof ev.id === 'string' ? ev.id : '',
              name: typeof ev.name === 'string' ? ev.name : 'unknown',
              kind: ev.kind ?? 'execution_failed',
              message:
                typeof ev.message === 'string' && ev.message.trim()
                  ? ev.message
                  : contextRef.current.language === 'en'
                    ? 'A tool call failed.'
                    : 'Una herramienta falló.',
              args: ev.args,
            });
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
  // closures.
  const isLoadingRef = useRef(false);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Ref espejo de los nombres de tool_call por id, para que el handler de
  // `tool_result` pueda discriminar por nombre sin depender del `toolCalls`
  // state (que se actualiza en el mismo tick y produce closure stale).
  const toolCallNamesRef = useRef<Map<string, RepairToolName>>(new Map());
  useEffect(() => {
    // Sincronización mínima: solo agregamos los ids nuevos. Las entradas
    // viejas se conservan por el resto de la vida del hook.
    for (const tc of toolCalls) {
      if (!toolCallNamesRef.current.has(tc.id)) {
        toolCallNamesRef.current.set(tc.id, tc.name);
      }
    }
  }, [toolCalls]);

  return {
    // Phase 1
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
    // Phase 2
    adjustments,
    pendingAdjustmentId,
    validationStatus,
    confirmAdjustment,
    rejectAdjustment,
    consumeAdjustmentConfirmation,
    // Phase 3 hardening
    toolError,
    clearToolError,
    autosaveError,
    clearAutosaveError,
  };
}

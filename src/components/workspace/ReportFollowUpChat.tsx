'use client';

// ---------------------------------------------------------------------------
// ReportFollowUpChat — chat de seguimiento adjunto al reporte financiero.
// ---------------------------------------------------------------------------
// Se monta dentro de `ReportViewer` (en `PipelineWorkspace.tsx`) cuando el
// pipeline ha completado. Consume `/api/chat` via SSE con
// `useCase: 'financial-report'` para que el orquestrador suba el limite
// del `documentContext` al contexto completo del reporte + data cruda.
//
// Contrato:
// - Props: { report, rawData, company, language, onPatchReport? }
// - UI: panel colapsable (48px colapsado / 40vh expandido) con transcript,
//   composer y chips sugeridos.
// - a11y: `aria-expanded` en el toggle, `aria-live="polite"` en el transcript,
//   `aria-label` en textarea y boton.
// - Patch-apply: si la respuesta contiene el sentinel
//     <<<PATCH_REPORT>>>\n<markdown>\n<<<END_PATCH>>>
//   se parsea y se ofrece "Aplicar al reporte" via `onPatchReport(newMd)`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp, Send, MessageSquare, CheckCircle, AlertTriangle, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';
import { consumeSSE } from '@/lib/sse/consume';
import type { FinancialReport, CompanyInfo } from '@/lib/agents/financial/types';
import type { ReportIterationTurn } from './types';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface ReportFollowUpChatProps {
  report: FinancialReport;
  rawData: string;
  company: CompanyInfo;
  language: 'es' | 'en';
  /** Turnos persistidos (si el WorkspaceContext los hidrata desde storage). */
  initialTurns?: ReportIterationTurn[];
  /**
   * Notifica al padre cuando los turnos cambian (persist). El padre decide si
   * persistirlos via `WorkspaceContext.updateReportTurns`.
   */
  onTurnsChange?: (turns: ReportIterationTurn[]) => void;
  /** Handler para aplicar el parche propuesto por el agente al reporte. */
  onPatchReport?: (newConsolidatedMarkdown: string) => void;
  /** ID estable del reporte/conversacion. Si no se pasa, se genera uno local. */
  conversationId?: string;
}

// ─── Constantes i18n (es/en) ───────────────────────────────────────────────

const COPY = {
  es: {
    toggleCollapsed: 'Preguntar al agente sobre este reporte',
    toggleExpanded: 'Chat de seguimiento del reporte',
    inputPlaceholder: 'Pregunta sobre este reporte... (Cmd/Ctrl+Enter para enviar)',
    sendLabel: 'Enviar pregunta',
    sending: 'Enviando...',
    emptyHint: 'Sugerencias rápidas:',
    applyPatch: 'Aplicar al reporte',
    patchApplied: 'Aplicado',
    detectedPatch: 'El agente propuso una actualización del reporte.',
    genericError: 'No se pudo completar la respuesta. Intenta de nuevo.',
    streaming: 'Generando respuesta...',
  },
  en: {
    toggleCollapsed: 'Ask the agent about this report',
    toggleExpanded: 'Report follow-up chat',
    inputPlaceholder: 'Ask about this report... (Cmd/Ctrl+Enter to send)',
    sendLabel: 'Send question',
    sending: 'Sending...',
    emptyHint: 'Quick suggestions:',
    applyPatch: 'Apply to report',
    patchApplied: 'Applied',
    detectedPatch: 'The agent proposed an update to the report.',
    genericError: 'The response could not be completed. Try again.',
    streaming: 'Generating response...',
  },
} as const;

const STARTER_CHIPS = {
  es: [
    'Completa las cifras faltantes del patrimonio',
    'Explica por qué la utilidad neta es negativa',
    'Valida la ecuación Activo = Pasivo + Patrimonio',
  ],
  en: [
    'Fill in the missing equity figures',
    'Explain why net income is negative',
    'Validate the equation Assets = Liabilities + Equity',
  ],
} as const;

// ─── Utils ──────────────────────────────────────────────────────────────────

function newId(): string {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch {
    /* fallback */
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Arma el bloque de contexto que se envia a `/api/chat` como `documentContext`.
 * Tope conservador: 40 KB del rawData para que el total < ~80 KB (bajo el
 * limite de 100 KB del `chatRequestSchema`).
 */
function composeContext(report: FinancialReport, rawData: string, company: CompanyInfo): string {
  const RAW_DATA_LIMIT = 40_000;
  const truncatedRaw = rawData.length > RAW_DATA_LIMIT ? rawData.slice(0, RAW_DATA_LIMIT) : rawData;
  return [
    'REPORTE FINANCIERO ACTUAL (Markdown completo):',
    report.consolidatedReport,
    '',
    '---',
    'BALANCE DE PRUEBA ORIGINAL (texto extraído del XLSX/CSV):',
    truncatedRaw,
    '',
    '---',
    `EMPRESA: ${company.name} (NIT ${company.nit})`,
    `PERIODO: ${company.fiscalPeriod}`,
  ].join('\n');
}

/**
 * Busca el sentinel `<<<PATCH_REPORT>>>...<<<END_PATCH>>>` en el contenido.
 * Si lo encuentra, retorna el markdown parcheado y el mensaje visible (sin el bloque).
 */
function parsePatch(content: string): { visible: string; patch?: { newConsolidatedMarkdown: string; summary: string } } {
  const START = '<<<PATCH_REPORT>>>';
  const END = '<<<END_PATCH>>>';
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    return { visible: content };
  }
  const newMd = content.slice(startIdx + START.length, endIdx).trim();
  const before = content.slice(0, startIdx).trim();
  const after = content.slice(endIdx + END.length).trim();
  const summary = [before, after].filter(Boolean).join('\n\n');
  return {
    visible: summary || 'Propuesta de actualización generada.',
    patch: { newConsolidatedMarkdown: newMd, summary },
  };
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function ReportFollowUpChat({
  report,
  rawData,
  company,
  language,
  initialTurns,
  onTurnsChange,
  onPatchReport,
  conversationId: conversationIdProp,
}: ReportFollowUpChatProps) {
  const copy = COPY[language];
  const chips = STARTER_CHIPS[language];

  const [expanded, setExpanded] = useState(false);
  const [turns, setTurns] = useState<ReportIterationTurn[]>(() => initialTurns ?? []);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelId = useId();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ID estable del reporte: prop > localId. Solo se genera una vez por mount.
  const fallbackIdRef = useRef<string>(conversationIdProp ?? `report-${Date.now()}`);
  const conversationId = conversationIdProp ?? fallbackIdRef.current;

  // Notificar cambios al padre solo si efectivamente cambio la lista.
  // (evita loops si el padre pasa `initialTurns` como mismo array).
  const lastNotifiedRef = useRef<ReportIterationTurn[] | null>(null);
  useEffect(() => {
    if (!onTurnsChange) return;
    if (lastNotifiedRef.current === turns) return;
    lastNotifiedRef.current = turns;
    onTurnsChange(turns);
  }, [turns, onTurnsChange]);

  // Auto-scroll al final al agregar contenido. No interfiere con scroll manual
  // porque solo corre cuando cambia la longitud del transcript.
  const lastTurnLen = turns.length;
  const lastStreamingContent = turns[turns.length - 1]?.content ?? '';
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || !expanded) return;
    el.scrollTop = el.scrollHeight;
  }, [lastTurnLen, lastStreamingContent, expanded]);

  // Cleanup del fetch en curso al desmontar.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const documentContext = useMemo(
    () => composeContext(report, rawData, company),
    [report, rawData, company],
  );

  // ─── Envio ───────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;

    const userTurn: ReportIterationTurn = {
      id: newId(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    };
    const assistantTurn: ReportIterationTurn = {
      id: newId(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streaming: true,
    };

    // Snapshot del historial ANTES de agregar los turnos nuevos — lo usamos
    // para construir el payload a `/api/chat`.
    const priorTurns = turns;
    setTurns((prev) => [...prev, userTurn, assistantTurn]);
    setInput('');
    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = {
        messages: [
          ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
          { role: 'user' as const, content: prompt },
        ],
        language,
        useCase: 'financial-report',
        documentContext,
        conversationId,
        streaming: true,
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stream': 'true',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      let streamedContent = '';
      let finalResult: { content?: string } | null = null;

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        await consumeSSE(response, controller.signal, {
          content: (raw) => {
            const delta = (raw as { delta?: string })?.delta ?? '';
            if (!delta) return;
            streamedContent += delta;
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurn.id ? { ...t, content: streamedContent } : t,
              ),
            );
          },
          progress: () => {
            // Por ahora no renderizamos progreso granular en este panel.
            // El usuario ve el indicador "streaming" en la burbuja.
          },
          result: (raw) => {
            finalResult = raw as { content?: string };
          },
          error: (raw) => {
            const err = (raw as { error?: string })?.error;
            throw new Error(err || copy.genericError);
          },
        });
      } else {
        const data = (await response.json()) as { content?: string };
        finalResult = data;
        streamedContent = data.content ?? '';
      }

      const rawFinal = finalResult?.content ?? streamedContent;
      if (!rawFinal) {
        throw new Error(copy.genericError);
      }

      // Detectar sentinel de parche.
      const { visible, patch } = parsePatch(rawFinal);

      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurn.id
            ? {
                ...t,
                content: visible,
                streaming: false,
                patch: patch,
              }
            : t,
        ),
      );
    } catch (err) {
      const name = (err as Error | undefined)?.name;
      if (name === 'AbortError') {
        // Usuario abandono / unmount — limpiar el turno vacio.
        setTurns((prev) => prev.filter((t) => t.id !== assistantTurn.id));
        return;
      }
      const msg = err instanceof Error ? err.message : copy.genericError;
      setError(msg);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurn.id
            ? { ...t, content: msg, streaming: false }
            : t,
        ),
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, turns, language, documentContext, conversationId, copy.genericError]);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChipClick = useCallback((chip: string) => {
    setInput(chip);
    // Foco al textarea para permitir editar antes de enviar.
    textareaRef.current?.focus();
  }, []);

  const handleApplyPatch = useCallback(
    (turnId: string, newMd: string) => {
      if (!onPatchReport) return;
      onPatchReport(newMd);
      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, applied: true } : t)),
      );
    },
    [onPatchReport],
  );

  return (
    <div className="border-t border-[#e5e5e5] bg-white">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full flex items-center justify-between px-6 h-12 text-sm font-medium text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#D4A017]" />
          {expanded ? copy.toggleExpanded : copy.toggleCollapsed}
          {turns.length > 0 && (
            <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
              ({turns.length})
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-[#a3a3a3]" />
        ) : (
          <ChevronUp className="w-4 h-4 text-[#a3a3a3]" />
        )}
      </button>

      {/* Panel expandible */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="panel"
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '40vh', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-[#e5e5e5] bg-white flex flex-col"
          >
            {/* Transcript — scrollable. data-lenis-prevent para no pelear con Lenis. */}
            <div
              ref={transcriptRef}
              data-lenis-prevent
              aria-live="polite"
              className="flex-1 min-h-0 overflow-y-auto styled-scrollbar px-6 py-4 space-y-3"
            >
              {turns.length === 0 ? (
                <div className="text-xs text-[#a3a3a3]">
                  <div className="mb-3 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#D4A017]" />
                    <span className="font-semibold">{copy.emptyHint}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleChipClick(chip)}
                        className="text-left px-3 py-2 rounded border border-[#e5e5e5] bg-[#fafafa] text-[#525252] text-xs hover:border-[#D4A017] hover:text-[#0a0a0a] transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((turn) => (
                  <div
                    key={turn.id}
                    className={cn(
                      'flex',
                      turn.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded px-3 py-2 text-sm',
                        turn.role === 'user'
                          ? 'bg-[#0a0a0a] text-white'
                          : 'bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]',
                      )}
                    >
                      {turn.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none text-[#0a0a0a] prose-p:leading-relaxed prose-headings:text-[#0a0a0a]">
                          {turn.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                              {turn.content}
                            </ReactMarkdown>
                          ) : (
                            <span className="text-[#a3a3a3] italic text-xs">{copy.streaming}</span>
                          )}
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap">{turn.content}</span>
                      )}

                      {turn.streaming && turn.content && (
                        <span className="inline-block w-2 h-3 ml-0.5 bg-[#D4A017] animate-pulse align-text-bottom" />
                      )}

                      {/* Affordance de parche */}
                      {turn.patch && onPatchReport && !turn.applied && (
                        <div className="mt-2 pt-2 border-t border-[#e5e5e5] flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-[#D4A017]" />
                          <span className="text-xs text-[#525252]">{copy.detectedPatch}</span>
                          <button
                            type="button"
                            onClick={() => handleApplyPatch(turn.id, turn.patch!.newConsolidatedMarkdown)}
                            className="ml-auto px-2 py-1 rounded bg-[#D4A017] text-white text-[11px] font-medium hover:bg-[#A87C10] transition-colors"
                          >
                            {copy.applyPatch}
                          </button>
                        </div>
                      )}
                      {turn.applied && (
                        <div className="mt-2 pt-2 border-t border-[#e5e5e5] flex items-center gap-1.5 text-[#16A34A] text-[11px]">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {copy.patchApplied}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {error && (
                <div className="flex items-start gap-2 rounded border border-[#EF4444] bg-[#FEF2F2] px-3 py-2 text-xs text-[#DC2626]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap break-words">{error}</span>
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-[#e5e5e5] bg-white px-6 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  placeholder={copy.inputPlaceholder}
                  aria-label={copy.inputPlaceholder}
                  className="flex-1 resize-none rounded border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#0a0a0a] placeholder:text-[#a3a3a3] focus:border-[#D4A017] focus:outline-none"
                  disabled={isStreaming}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isStreaming || !input.trim()}
                  aria-label={copy.sendLabel}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors shrink-0',
                    isStreaming || !input.trim()
                      ? 'bg-[#f5f5f5] text-[#a3a3a3] cursor-not-allowed'
                      : 'bg-[#D4A017] text-white hover:bg-[#A87C10]',
                  )}
                >
                  <Send className="w-3.5 h-3.5" />
                  {isStreaming ? copy.sending : copy.sendLabel}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ReportFollowUpChat;

'use client';

// ---------------------------------------------------------------------------
// RepairChat — UI inline (NO modal) del "Doctor de Datos" Phase 1.
// ---------------------------------------------------------------------------
// Se monta dentro del card de error del pipeline (PipelineWorkspace) cuando el
// validador determinístico falla. Permite al usuario conversar con un agente
// que tiene acceso de solo-lectura al balance crudo (tool `read_account`) y
// que puede ofrecerle marcar el reporte como BORRADOR provisional vía la
// tool `mark_provisional` — la confirmación final la da el usuario aquí, NO
// el agente.
//
// Restricciones críticas:
//   - Inline expandible (no portal, no overlay).
//   - `data-lenis-prevent` en el contenedor scrollable: el root layout monta
//     Lenis en root mode y se come los wheel events. Sin este atributo el
//     scroll interno muere silencioso. Ver CLAUDE.md → "Layout Gotchas".
//   - Tokens polares (`bg-n-50`, `text-n-800`, …) — los overrides `dark:`
//     solo cuando el token polar no resuelve correctamente.
//   - `prefers-reduced-motion`: motion ya respeta el media query; además
//     usamos `transition` cortos (180 ms) que se anulan automáticamente.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, Loader2, Send, X, AlertTriangle, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRepairChat, type RepairToolInvocation } from './useRepairChat';
import type { RepairContext, RepairLanguage } from '@/lib/agents/repair/types';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface RepairChatProps {
  context: RepairContext;
  /** Host re-dispara el pipeline con `{ provisional: { active: true, reason } }`. */
  onMarkProvisional: (reason: string) => void;
  onClose: () => void;
  language: RepairLanguage;
  /**
   * Si se provee, se envía automáticamente como primer turno del usuario al
   * montar. Útil para "Continuar de todas formas" — el host pre-llena la
   * intención y deja que el agente confirme y dispare `mark_provisional`.
   */
  initialUserMessage?: string;
}

// ─── i18n ───────────────────────────────────────────────────────────────────

const COPY = {
  es: {
    region: 'Chat de reparación con el Doctor de Datos',
    title: 'El Doctor de Datos',
    subtitle: 'Hago preguntas sobre tu balance, no lo modifico.',
    closeLabel: 'Cerrar chat',
    placeholder: 'Escribe tu pregunta o instrucción…',
    sendLabel: 'Enviar',
    abortLabel: 'Cancelar',
    retryLabel: 'Reintentar',
    thinking: 'El Doctor está revisando…',
    provisionalTitle: 'Confirmación necesaria',
    provisionalBody:
      'El Doctor propuso marcar el reporte como BORRADOR con la razón:',
    provisionalConfirm: 'Confirmar y generar borrador',
    provisionalCancel: 'Cancelar',
    emptyHint:
      'Pregúntale al Doctor por una cuenta específica (p. ej. “revisa la cuenta 1120”) o pídele que te ayude a entender el descuadre.',
    toolPrefix: 'Consulté',
  },
  en: {
    region: 'Data Doctor repair chat',
    title: 'The Data Doctor',
    subtitle: 'I ask about your trial balance — I don’t change it.',
    closeLabel: 'Close chat',
    placeholder: 'Type your question or instruction…',
    sendLabel: 'Send',
    abortLabel: 'Cancel',
    retryLabel: 'Retry',
    thinking: 'The Doctor is reviewing…',
    provisionalTitle: 'Confirmation required',
    provisionalBody:
      'The Doctor proposed marking the report as DRAFT with the reason:',
    provisionalConfirm: 'Confirm and generate draft',
    provisionalCancel: 'Cancel',
    emptyHint:
      'Ask the Doctor about a specific account (e.g. “check account 1120”) or have it explain the imbalance.',
    toolPrefix: 'Looked up',
  },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Renderiza un tool-call de forma compacta y legible. No es markdown — es una
 * línea informativa para que el usuario vea "qué hizo el agente" sin asustarse.
 */
function formatToolCall(tc: RepairToolInvocation, language: RepairLanguage): string {
  const prefix = COPY[language].toolPrefix;
  if (tc.name === 'read_account') {
    const code = (tc.args as { code?: string })?.code ?? '?';
    const result = tc.result as
      | { found?: boolean; account?: { name?: string; balance?: number } }
      | undefined;
    if (!result) {
      return `${prefix} read_account(${code})…`;
    }
    if (!result.found) {
      const noFound = language === 'en' ? 'not found' : 'no encontrada';
      return `${prefix} read_account(${code}) → ${noFound}`;
    }
    const name = result.account?.name ?? '';
    const balance = result.account?.balance;
    const balanceStr =
      typeof balance === 'number'
        ? ` $${balance.toLocaleString(language === 'en' ? 'en-US' : 'es-CO')}`
        : '';
    return `${prefix} read_account(${code}) → ${name}${balanceStr}`;
  }
  if (tc.name === 'mark_provisional') {
    const reason = (tc.args as { reason?: string })?.reason ?? '';
    const label =
      language === 'en' ? 'proposed mark_provisional' : 'propuso mark_provisional';
    return `${prefix} ${label}: "${reason}"`;
  }
  return `${prefix} ${tc.name}`;
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function RepairChat({
  context,
  onMarkProvisional,
  onClose,
  language,
  initialUserMessage,
}: RepairChatProps) {
  const copy = COPY[language];
  const regionId = useId();

  const {
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
  } = useRepairChat(context);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputValueRef = useRef('');

  // Focus inicial en la textarea al montar el chat.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-envío del mensaje inicial (caso "Continuar de todas formas"). Guard
  // con ref para que no se reenvíe si las props cambian de identidad.
  const initialSentRef = useRef(false);
  useEffect(() => {
    if (initialSentRef.current) return;
    const seed = initialUserMessage?.trim();
    if (!seed) return;
    initialSentRef.current = true;
    void sendMessage(seed);
  }, [initialUserMessage, sendMessage]);

  // Auto-scroll al fondo cuando llegan tokens nuevos o cambia el historial.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pendingAssistant, toolCalls]);

  // Auto-grow de la textarea (max 4 líneas ≈ 96 px considerando line-height
  // de la tipografía base). Lo recalculamos en cada keystroke.
  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    const max = 96; // ~4 líneas
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);

  // Mantenemos el value en un ref espejo para que `handleSend` lo pueda leer
  // sin recrear callbacks en cada keystroke.
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      inputValueRef.current = e.target.value;
      autoGrow(e.currentTarget);
    },
    [autoGrow],
  );

  const handleSend = useCallback(async () => {
    const value = textareaRef.current?.value ?? inputValueRef.current;
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    // Limpiar UI ANTES del await — sensación de inmediatez.
    if (textareaRef.current) {
      textareaRef.current.value = '';
      autoGrow(textareaRef.current);
    }
    inputValueRef.current = '';
    await sendMessage(trimmed);
  }, [isLoading, sendMessage, autoGrow]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter envía, Shift+Enter inserta salto. IME composing safety: si el
      // usuario está en mitad de un IME, dejamos pasar.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleConfirmProvisional = useCallback(() => {
    const reason = consumeProvisional();
    if (reason) {
      onMarkProvisional(reason);
      onClose();
    }
  }, [consumeProvisional, onMarkProvisional, onClose]);

  const handleCancelProvisional = useCallback(() => {
    consumeProvisional();
  }, [consumeProvisional]);

  // Index O(1) para emparejar tool-calls con su mensaje. En Phase 1 los tool
  // calls del último turno se renderizan al final del transcript (decisión de
  // diseño: el usuario no necesita verlos intercalados con cada token).
  const visibleToolCalls = useMemo(() => toolCalls, [toolCalls]);

  return (
    <motion.section
      role="region"
      aria-label={copy.region}
      aria-describedby={regionId}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="overflow-hidden border-t border-n-200 bg-n-0"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gold-500/12 text-gold-500 shrink-0">
              <Bot className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-n-900 truncate">
                {copy.title}
              </div>
              <div
                id={regionId}
                className="text-xs text-n-600 truncate"
              >
                {copy.subtitle}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.closeLabel}
            className="flex items-center justify-center w-8 h-8 rounded text-n-600 hover:text-n-900 hover:bg-n-50 transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Transcript */}
        <div
          ref={transcriptRef}
          data-lenis-prevent
          aria-live="polite"
          aria-busy={isLoading}
          className="max-h-[480px] overflow-y-auto px-5 py-3 space-y-3 styled-scrollbar"
        >
          {messages.length === 0 && !pendingAssistant && (
            <p className="text-xs text-n-600 italic">{copy.emptyHint}</p>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble key={`${msg.role}-${idx}`} role={msg.role} content={msg.content} />
          ))}

          {/* Pending assistant — burbuja en construcción con cursor titilante */}
          {pendingAssistant && (
            <MessageBubble role="assistant" content={pendingAssistant} streaming />
          )}

          {/* Tool calls del turno actual */}
          {visibleToolCalls.length > 0 && (
            <ul className="space-y-1 pt-1">
              {visibleToolCalls.map((tc) => (
                <li
                  key={tc.id}
                  className="flex items-start gap-1.5 text-xs text-n-600"
                >
                  <Wrench className="w-3 h-3 mt-0.5 shrink-0 text-gold-500" aria-hidden="true" />
                  <span className="break-words">{formatToolCall(tc, language)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Indicador "thinking" cuando no hay tokens aún pero estamos cargando */}
          {isLoading && !pendingAssistant && (
            <div className="flex items-center gap-2 text-xs text-n-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gold-500" aria-hidden="true" />
              <span>{copy.thinking}</span>
            </div>
          )}
        </div>

        {/* Provisional confirmation panel */}
        <AnimatePresence initial={false}>
          {pendingProvisionalReason !== null && (
            <motion.div
              key="provisional"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="overflow-hidden"
            >
              <div className="mx-5 mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className="w-4 h-4 mt-0.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-n-900">
                      {copy.provisionalTitle}
                    </div>
                    <p className="mt-0.5 text-xs text-n-700">
                      {copy.provisionalBody}{' '}
                      <span className="italic">
                        “{pendingProvisionalReason}”
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleConfirmProvisional}
                        className="px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors"
                      >
                        {copy.provisionalConfirm}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelProvisional}
                        className="px-3 py-1.5 rounded text-xs font-medium text-n-700 hover:text-n-900 hover:bg-n-50 transition-colors"
                      >
                        {copy.provisionalCancel}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Composer */}
        <div className="border-t border-n-200 px-5 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              defaultValue=""
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={copy.placeholder}
              aria-label={copy.placeholder}
              disabled={isLoading}
              className={cn(
                'flex-1 resize-none rounded border border-n-200 px-3 py-2',
                'bg-n-50 dark:bg-[rgba(10,10,10,0.6)]',
                'text-sm text-n-900 placeholder:text-n-400',
                'focus:border-gold-500 focus:outline-none',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                'transition-colors',
              )}
              style={{ maxHeight: 96 }}
            />
            {isLoading ? (
              <button
                type="button"
                onClick={abort}
                aria-label={copy.abortLabel}
                className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium bg-n-100 text-n-700 hover:bg-n-200 transition-colors shrink-0"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                {copy.abortLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                aria-label={copy.sendLabel}
                className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-600 disabled:bg-n-100 disabled:text-n-400 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                {copy.sendLabel}
              </button>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div
              role="alert"
              className="mt-2 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              <AlertTriangle
                className="w-3.5 h-3.5 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <span className="flex-1 whitespace-pre-wrap break-words">{error}</span>
              <button
                type="button"
                onClick={resetError}
                className="px-2 py-0.5 rounded text-xs font-medium text-danger hover:bg-danger/20 transition-colors shrink-0"
              >
                {copy.retryLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// ─── Subcomponente: bubble ──────────────────────────────────────────────────

function MessageBubble({
  role,
  content,
  streaming = false,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap break-words',
          isUser
            ? 'bg-n-100 dark:bg-n-100 text-n-900'
            : 'bg-n-50 dark:bg-[rgba(10,10,10,0.4)] text-n-800 border border-n-200',
        )}
      >
        {content}
        {streaming && (
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-3 ml-0.5 bg-gold-500 align-text-bottom animate-pulse"
          />
        )}
      </div>
    </div>
  );
}

export default RepairChat;

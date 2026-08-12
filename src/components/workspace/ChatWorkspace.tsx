'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Mic,
  MicOff,
  Upload,
  FileText,
  X,
  Square,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRealtimeAPI } from '@/hooks/useRealtimeAPI';
import { useToast } from '@/design-system/components/Toast';
import { cn } from '@/lib/utils';
import { uploadDocument } from '@/lib/upload/blob-client';
import {
  loadConversation,
  saveConversation,
  generateConversationId,
  inferTitle,
  loadConversationDocs,
  saveConversationDocs,
} from '@/lib/storage/conversation-history';
import type {
  ChatMessage,
  RiskAssessmentData,
  UploadedDocument,
} from './types';
import type { AgentNode, AgentTier } from '@/types/platform';
import { SPRING, INITIAL_MSG } from './chat/constants';
import {
  generateId,
  classifyError,
  errorMessageText,
  extractLegalReferences,
  resolveAgentPresentation,
  resolveFinalAnswer,
  type ChatErrorKind,
} from './chat/utils';
import type { PipelineVizState } from './chat/types';
import { CaseHeader } from './chat/CaseHeader';
import { PipelineBanner } from './chat/PipelineBanner';
import { TypingIndicator } from './chat/TypingIndicator';
import { UserMessage } from './chat/UserMessage';
import { AssistantMessage } from './chat/AssistantMessage';
import { StarterChips } from './chat/StarterChips';

// ─── Main Component ───────────────────────────────────────────────────────────

// El servidor (chatRequestSchema) rechaza documentContext > 500.000 chars —
// capamos el join por debajo para no brickear la conversación.
const DOC_CONTEXT_MAX_CHARS = 480_000;

function joinDocContext(docs: UploadedDocument[]): string {
  const joined = docs.filter(d => d.extractedText).map(d => d.extractedText).join('\n\n');
  return joined.length > DOC_CONTEXT_MAX_CHARS
    ? `${joined.slice(0, DOC_CONTEXT_MAX_CHARS)}\n[...documentos truncados...]`
    : joined;
}

interface ChatWorkspaceProps {
  conversationId: string;
  useCase: string;
  language: 'es' | 'en';
  onRiskAssessment?: (data: RiskAssessmentData) => void;
  onDocumentUploaded?: (doc: UploadedDocument) => void;
}

export function ChatWorkspace({
  conversationId: externalConversationId,
  useCase,
  language: propLanguage,
  onRiskAssessment,
  onDocumentUploaded,
}: ChatWorkspaceProps) {
  const { t } = useLanguage();
  const { setIntelligencePanelData } = useWorkspace();
  const { toast } = useToast();
  const language = propLanguage;

  // State
  const [conversationId] = useState(() => externalConversationId || generateConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadConversation(externalConversationId);
    const cleaned = saved && Array.isArray(saved.messages)
      ? saved.messages
          .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
          .map(m => ({
            id: m.id || generateId(),
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: '',
            webSearchUsed: m.webSearchUsed,
          }))
      : [];
    if (cleaned.length > 0) return cleaned;
    return [{
      id: '1',
      role: 'assistant' as const,
      content: (INITIAL_MSG[useCase === 'general' ? 'general' : 'default'] ?? INITIAL_MSG.default)[language],
      // Empty string keeps SSR/CSR markup identical. The actual time is stamped
      // post-mount in an effect (or for new outbound messages).
      timestamp: '',
    }];
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Documentos subidos en esta conversación (persistidos en localStorage por conversationId).
  // El initializer corre una sola vez por mount; al cambiar de conversación en el sidebar,
  // `key={activeCase}` fuerza remount y se vuelve a ejecutar con el id nuevo.
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>(() => {
    const stored = loadConversationDocs(externalConversationId);
    return stored as UploadedDocument[];
  });
  const [documentContext, setDocumentContext] = useState(() => {
    const stored = loadConversationDocs(externalConversationId);
    return joinDocContext(stored as UploadedDocument[]);
  });
  const [progressStatus, setProgressStatus] = useState<string | undefined>(undefined);
  /** id of the message currently being streamed from the server (if any) */
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  // Pipeline viz state
  const [vizState, setVizState] = useState<PipelineVizState>({
    visible: false,
    collapsed: false,
    tier: 'T1',
    nodes: [],
    toolLog: [],
  });

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Abort controller for the in-flight fetch — null when idle */
  const abortRef = useRef<AbortController | null>(null);
  /** Whether the latest abort was initiated by the user (Stop button) vs a timeout/error */
  const userAbortedRef = useRef(false);

  // Voice
  const {
    isConnecting,
    volume,
    startSession,
    stopSession,
  } = useRealtimeAPI();

  useEffect(() => {
    if (messages.length === 1 && messages[0].id === '1') {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: (INITIAL_MSG[useCase === 'general' ? 'general' : 'default'] ?? INITIAL_MSG.default)[language],
        timestamp: new Date().toISOString(),
      }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Cancel any in-flight request when the component unmounts
  useEffect(() => {
    return () => {
      // Marcar como abort de usuario: sin esto, classifyError lo trata como
      // 'timeout' y dispara un toast global falso al navegar.
      userAbortedRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  // ─── Error handling helper ───────────────────────────────────────────────

  const appendErrorMessage = useCallback((
    err: unknown,
    history: ChatMessage[],
    userAborted: boolean,
    retryFn: () => void,
  ) => {
    const kind = classifyError(err, userAborted);
    if (kind === 'user_abort') {
      // User hit Stop — don't show an error, the partial message is already there.
      return;
    }
    const content = errorMessageText(kind as ChatErrorKind, language);
    toast('error', content);
    setMessages([
      ...history,
      {
        id: generateId(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        errorKind: kind as ChatErrorKind,
        onRetry: retryFn,
      },
    ]);
  }, [language, toast]);

  // ─── API Call (SSE) ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (allMessages: ChatMessage[]) => {
    setIsTyping(true);
    setProgressStatus(undefined);
    setVizState({ visible: false, collapsed: false, tier: 'T1', nodes: [], toolLog: [] });

    // Create the in-progress assistant message up front so tokens can stream into it.
    const streamId = generateId();
    setStreamingMessageId(streamId);
    setMessages(prev => [
      ...prev,
      { id: streamId, role: 'assistant', content: '', timestamp: new Date().toISOString() },
    ]);

    // Accumulated streamed content — committed to state on every delta via functional setter.
    let streamedContent = '';

    // Wire up abort controller for the fetch + Stop button
    const controller = new AbortController();
    abortRef.current = controller;
    userAbortedRef.current = false;

    try {
      // Read connected ERP provider names from localStorage (provider names only — no credentials).
      // Credentials are resolved server-side from the encrypted erp_credentials table.
      let erpProviders: string[] = [];
      try {
        const raw = localStorage.getItem('utopia_erp_connections');
        if (raw) {
          const decoded = JSON.parse(decodeURIComponent(atob(raw)));
          if (Array.isArray(decoded)) {
            erpProviders = decoded
              .map((c: unknown) => (typeof c === 'string' ? c : (c as { provider?: string })?.provider))
              .filter((p): p is string => typeof p === 'string' && p.length > 0);
          }
        }
      } catch { /* ignore malformed data */ }

      // El servidor (chatRequestSchema) rechaza >50 mensajes y mensajes
      // >10.000 chars — recortamos defensivamente antes de enviar.
      const payload = {
        messages: allMessages
          .filter(m => m.meta !== 'upload-notice')
          .slice(-40)
          .map(m => ({
            id: m.id,
            role: m.role,
            content: m.content.length > 9_800 ? `${m.content.slice(0, 9_800)}…` : m.content,
          })),
        language, useCase,
        ...(documentContext ? { documentContext } : {}),
        ...(erpProviders.length > 0 ? { erpProviders } : {}),
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('Content-Type') || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;

      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // Persiste entre chunks: `event:` y `data:` pueden llegar en lecturas
        // TCP distintas — si se reinicia por chunk se pierden eventos.
        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6);
              try {
                const eventData = JSON.parse(jsonStr);
                if (currentEvent === 'content') {
                  // Token streaming — append to in-progress assistant message
                  const delta: string = eventData.delta ?? '';
                  if (delta) {
                    streamedContent += delta;
                    setMessages(prev => prev.map(m =>
                      m.id === streamId ? { ...m, content: streamedContent } : m,
                    ));
                  }
                } else if (currentEvent === 'progress') {
                  setProgressStatus(eventData.type);

                  if (eventData.type === 'classifying') {
                    setVizState(prev => ({
                      ...prev,
                      visible: true,
                      nodes: [{ id: 'classifier', label: 'Clasificador', status: 'active', branch: 'main' }],
                    }));
                  } else if (eventData.type === 'enhancing') {
                    setVizState(prev => ({
                      ...prev,
                      nodes: prev.nodes.map(n => n.id === 'classifier' ? { ...n, status: 'complete' as const } : n)
                        .concat([{ id: 'enhancer', label: 'Optimizador', status: 'active', branch: 'main' }]),
                    }));
                  } else if (eventData.type === 'routing') {
                    const tier = (eventData.agents?.length ?? 0) > 1 ? 'T3' : 'T2';
                    // `id` DEBE seguir siendo el string crudo del servidor: el
                    // evento `agent_working` referencia al agente por displayName.
                    // Solo la etiqueta y la rama se derivan del mapa.
                    const agentNodes: AgentNode[] = (eventData.agents ?? []).map((a: string) => {
                      const { label, branch } = resolveAgentPresentation(a);
                      return { id: a, label, status: 'pending' as const, branch };
                    });
                    setVizState(prev => ({
                      ...prev,
                      tier: tier as AgentTier,
                      nodes: prev.nodes.map(n => n.id === 'enhancer' ? { ...n, status: 'complete' as const } : n)
                        .concat(agentNodes)
                        .concat(tier === 'T3' ? [{ id: 'synthesizer', label: 'Sintetizador', status: 'pending' as const, branch: 'main' }] : []),
                    }));
                  } else if (eventData.type === 'agent_working') {
                    const agentId = eventData.agent;
                    setVizState(prev => ({
                      ...prev,
                      nodes: prev.nodes.map(n =>
                        n.id === agentId ? { ...n, status: 'active' as const, lastTool: eventData.status } : n
                      ),
                      toolLog: [...prev.toolLog, `${agentId}: ${eventData.status}`],
                    }));
                  } else if (eventData.type === 'synthesizing') {
                    setVizState(prev => ({
                      ...prev,
                      nodes: prev.nodes.map(n =>
                        n.id === 'synthesizer' ? { ...n, status: 'active' as const } :
                        (n.status === 'active' ? { ...n, status: 'complete' as const } : n)
                      ),
                    }));
                  }
                } else if (currentEvent === 'result') {
                  data = eventData;
                } else if (currentEvent === 'error') {
                  throw new Error(eventData.error || 'Stream error');
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }
      } else {
        data = await response.json();
      }

      // Un stream cerrado sin evento `result` significa que `orchestrate` nunca
      // termino: `resolveFinalAnswer` marca esa respuesta como amputada en vez
      // de aceptarla como definitiva (logica compartida con ChatSidebar).
      const resolved = resolveFinalAnswer({ result: data, streamed: streamedContent, language });
      if (!resolved) throw new Error('No response data received');
      const truncated = resolved.truncated;
      if (!data) data = { content: resolved.content };

      setVizState(prev => ({
        ...prev,
        collapsed: true,
        // Un stream cortado NO completa el pipeline: los nodos que seguian
        // activos/pendientes quedan en error, no en "complete".
        nodes: prev.nodes.map(n => ({
          ...n,
          status: truncated && n.status !== 'complete' ? ('error' as const) : ('complete' as const),
        })),
      }));

      const finalContent = resolved.content;

      // Finalize the streaming message with full metadata.
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === streamId
            ? {
                ...m,
                content: finalContent,
                webSearchUsed: data.webSearchUsed || false,
                riskAssessment: data.riskAssessment ?? undefined,
                sanctionCalculation: data.sanctionCalculation ?? undefined,
                tier: data.tier,
                agentsUsed: data.agentsUsed,
                enhancedQuery: data.enhancedQuery,
              }
            : m,
        );
        saveConversation({
          id: conversationId,
          title: inferTitle(updated.map(m => ({ id: m.id, role: m.role, content: m.content }))),
          useCase,
          messages: updated.map(m => ({ id: m.id, role: m.role, content: m.content, webSearchUsed: m.webSearchUsed })),
          createdAt: updated[0]?.timestamp || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          riskLevel: data.riskAssessment?.level ?? 'bajo',
        });
        return updated;
      });

      // Stream cortado: ademas de la marca embebida, ofrecer reintento explicito.
      if (truncated) {
        const retryTruncated = () => {
          setMessages(allMessages);
          sendMessage(allMessages);
        };
        setMessages(prev => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: errorMessageText('timeout', language),
            timestamp: new Date().toISOString(),
            errorKind: 'timeout' as ChatErrorKind,
            onRetry: retryTruncated,
          },
        ]);
      }

      // Update intelligence panel
      if (data.riskAssessment) {
        onRiskAssessment?.(data.riskAssessment);
        setIntelligencePanelData(prev => ({
          ...prev,
          riskLevel: ({ bajo: 'low', medio: 'medium', alto: 'high', critico: 'critical' } as const)[data.riskAssessment.level as 'bajo' | 'medio' | 'alto' | 'critico'],
          riskScore: data.riskAssessment.score,
        }));
      }

      // El `source` sale de lo que el texto DECLARA (extractLegalReferences ya
      // lo resuelve). Forzar 'Estatuto Tributario' convertia cualquier "Art. N"
      // —incluido uno de la Ley 2277, de un contrato o alucinado— en una cita
      // del E.T. aparentemente verificada dentro del panel de Fuentes.
      const legalRefs = extractLegalReferences(finalContent);
      if (legalRefs.length > 0) {
        setIntelligencePanelData(prev => ({
          ...prev,
          citations: legalRefs.map(r => ({ article: r.article, source: r.source })),
        }));
      }
    } catch (err) {
      const userAborted = userAbortedRef.current;

      if (userAborted) {
        // User stopped: keep the partial message as-is, just finalize it and persist.
        setMessages(prev => {
          const updated = prev.map(m =>
            m.id === streamId
              ? { ...m, content: streamedContent || m.content }
              : m,
          );
          saveConversation({
            id: conversationId,
            title: inferTitle(updated.map(m => ({ id: m.id, role: m.role, content: m.content }))),
            useCase,
            messages: updated.map(m => ({ id: m.id, role: m.role, content: m.content, webSearchUsed: m.webSearchUsed })),
            createdAt: updated[0]?.timestamp || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            riskLevel: 'bajo',
          });
          return updated;
        });
      } else {
        // Real error: remove the in-progress placeholder, then append a typed error message with Retry.
        const retry = () => {
          setMessages(allMessages);
          sendMessage(allMessages);
        };
        setMessages(prev => prev.filter(m => m.id !== streamId));
        appendErrorMessage(err, allMessages, false, retry);
      }
    } finally {
      setIsTyping(false);
      setProgressStatus(undefined);
      setStreamingMessageId(null);
      abortRef.current = null;
      userAbortedRef.current = false;
    }
  }, [
    conversationId,
    useCase,
    language,
    documentContext,
    onRiskAssessment,
    setIntelligencePanelData,
    appendErrorMessage,
  ]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    let content = input.trim();
    if (content.length > 9_800) {
      // El servidor rechaza mensajes >10.000 chars — recortar e informar.
      content = `${content.slice(0, 9_800)}…`;
      toast('info', language === 'es'
        ? 'Su mensaje superaba el límite de 10.000 caracteres y fue recortado.'
        : 'Your message exceeded the 10,000-character limit and was trimmed.');
    }
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content, timestamp: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    sendMessage(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  const handleStop = useCallback(() => {
    userAbortedRef.current = true;
    abortRef.current?.abort();
  }, []);

  /** Regenerate the last assistant reply by re-sending the prior user message. */
  const handleRegenerate = useCallback(() => {
    if (isTyping) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const truncated = messages.slice(0, lastUserIdx + 1);
    setMessages(truncated);
    sendMessage(truncated);
  }, [isTyping, messages, sendMessage]);

  const pickStarter = useCallback((prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const toggleVoice = () => {
    if (voiceMode) { stopSession(); setVoiceMode(false); }
    else { startSession(); setVoiceMode(true); }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    const newDoc: UploadedDocument = { filename: file.name, size: file.size, chunks: 0, uploadedAt: new Date().toISOString() };
    setUploadedDocs(prev => {
      const next = [...prev, newDoc];
      // No persistimos aún: el doc todavía no tiene texto y el backend
      // podría fallar. Guardaremos cuando llegue la respuesta.
      return next;
    });
    try {
      const data = await uploadDocument(file, file.name);
      const fullText = data.extractedText || '';
      const finishedDoc: UploadedDocument = { ...newDoc, chunks: data.chunks || 0, textPreview: fullText.slice(0, 2000), extractedText: fullText };
      setUploadedDocs(prev => {
        const updated = prev.map(d => d.filename === file.name && d.uploadedAt === newDoc.uploadedAt ? finishedDoc : d);
        setDocumentContext(joinDocContext(updated));
        // Persistir la lista final (con extractedText) para que sobreviva
        // a recargas y cambios de conversación.
        saveConversationDocs(conversationId, updated);
        return updated;
      });
      onDocumentUploaded?.(finishedDoc);
      setMessages(prev => [...prev, {
        id: generateId(), role: 'assistant',
        content: language === 'es'
          ? `He procesado su documento **"${file.name}"** (${data.chunks} fragmentos). Ahora puedo responder preguntas basadas en su contenido.`
          : `I've processed your document **"${file.name}"** (${data.chunks} chunks). I can now answer questions based on its content.`,
        timestamp: new Date().toISOString(),
        meta: 'upload-notice',
      }]);
    } catch (err) {
      // `uploadDocument` propaga el motivo real del servidor. Mostrarlo en
      // lugar de un consejo genérico que el usuario no puede accionar.
      const reason = (err instanceof Error ? err.message : String(err)).trim();
      setUploadedDocs(prev => {
        const next = prev.filter(d => d.uploadedAt !== newDoc.uploadedAt);
        // Mantener el almacenamiento sincronizado tras el rollback.
        saveConversationDocs(conversationId, next);
        return next;
      });
      setMessages(prev => [...prev, {
        id: generateId(), role: 'assistant',
        content: reason
          ? (language === 'es'
            ? `No pude procesar **"${file.name}"**: ${reason}`
            : `Could not process **"${file.name}"**: ${reason}`)
          : (language === 'es'
            ? `No pude procesar el archivo. Verifique el formato e intente de nuevo.`
            : `Could not process the file. Please check the format and try again.`),
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  // Clave compuesta filename+uploadedAt (la misma que usa uploadFile) para no
  // borrar duplicados del mismo archivo subido varias veces.
  const removeDocument = (filename: string, uploadedAt: string) => {
    setUploadedDocs(prev => {
      const remaining = prev.filter(d => !(d.filename === filename && d.uploadedAt === uploadedAt));
      setDocumentContext(joinDocContext(remaining));
      saveConversationDocs(conversationId, remaining);
      return remaining;
    });
  };

  // Show starter chips only when the conversation is just the welcome message
  const showStarters = !isTyping && messages.length === 1 && messages[0].id === '1';
  const hasUserMessages = messages.some(m => m.role === 'user');

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
      onDrop={async e => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) await uploadFile(file); }}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-n-0/90 border-2 border-dashed border-gold-500 rounded-sm flex flex-col items-center justify-center gap-3"
          >
            <Upload className="w-8 h-8 text-gold-500" />
            <p className="text-sm font-medium text-n-900">
              {language === 'es' ? 'Suelte su documento aquí' : 'Drop your document here'}
            </p>
            <p className="text-xs text-n-600">
              PDF, Excel, Word, CSV, imágenes
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Case header */}
      <CaseHeader useCase={useCase} caseId={conversationId} language={language} />

      {/* Pipeline Banner */}
      <PipelineBanner vizState={vizState} onToggle={() => setVizState(prev => ({ ...prev, collapsed: !prev.collapsed }))} />

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        data-lenis-prevent
        className="flex-1 min-h-0 overflow-y-auto styled-scrollbar"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div
          className="flex flex-col w-full"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={language === 'es' ? 'Historial de mensajes' : 'Message history'}
        >
          {messages.map(msg =>
            msg.role === 'user'
              ? <UserMessage key={msg.id} message={msg} />
              : <AssistantMessage
                  key={msg.id}
                  message={msg}
                  language={language}
                  useCase={useCase}
                  isStreaming={streamingMessageId === msg.id}
                  canRegenerate={hasUserMessages && msg.id !== '1' && !msg.errorKind}
                  onRegenerate={handleRegenerate}
                />
          )}
          {showStarters && (
            <StarterChips useCase={useCase} language={language} onPick={pickStarter} />
          )}
          <AnimatePresence>
            {isTyping && !streamingMessageId && (
              <TypingIndicator language={language} progressStatus={progressStatus} />
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Voice overlay */}
      <AnimatePresence>
        {voiceMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', ...SPRING }}
            className="absolute bottom-24 right-4 z-40"
          >
            <div className="w-[120px] h-[120px] rounded-lg overflow-hidden bg-n-900 border border-n-200 shadow-lg relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                  className="rounded-full"
                  style={{ width: 48, height: 48, background: 'radial-gradient(circle, var(--color-n-0) 0%, var(--color-gold-500) 50%, transparent 100%)' }}
                  animate={{ scale: isConnecting ? [1, 1.2, 1] : [1 + volume * 0.5, 1 + volume * 0.8, 1 + volume * 0.5], opacity: isConnecting ? [0.5, 1, 0.5] : 0.9 }}
                  transition={{ duration: isConnecting ? 1 : 0.3, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
              <button type="button" onClick={toggleVoice} className="absolute bottom-1 right-1 p-1 rounded bg-danger/90 text-n-0 hover:bg-danger transition-colors" aria-label="Detener voz">
                <MicOff className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attached documents strip */}
      <AnimatePresence>
        {uploadedDocs.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', ...SPRING }}
            className="overflow-hidden border-t border-n-200 bg-n-50"
          >
            <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto styled-scrollbar">
              {uploadedDocs.map((doc, i) => (
                <div key={`${doc.filename}-${i}`} className="flex items-center gap-1.5 bg-n-0 border border-n-200 rounded px-2 py-1 shrink-0">
                  <FileText className="w-3 h-3 text-n-600" />
                  <span className="text-xs text-n-900 max-w-[120px] truncate">{doc.filename}</span>
                  <button type="button" onClick={() => removeDocument(doc.filename, doc.uploadedAt)} className="p-0.5 text-n-700 hover:text-danger transition-colors" aria-label={`Remover ${doc.filename}`}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="p-4 bg-n-0 border-t border-n-200 relative z-20">
        <div className="max-w-[var(--chat-reading-width)] mx-auto w-full">
          <form onSubmit={handleSubmit} className="flex items-end gap-2 bg-n-50 border border-n-200 rounded-lg p-1.5 focus-within:border-gold-500 transition-colors">
            <button type="button" onClick={toggleVoice} className={cn('p-2.5 rounded-md flex items-center justify-center shrink-0 transition-colors', voiceMode ? 'text-danger bg-danger/10' : 'text-n-400 hover:text-n-900 hover:bg-n-100')} aria-pressed={voiceMode} aria-label={voiceMode ? 'Detener voz' : 'Voz'}>
              {voiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.xml,.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.tiff,.tif,.bmp,.heic" onChange={handleFileSelect} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="p-2.5 rounded-md flex items-center justify-center shrink-0 transition-colors text-n-400 hover:text-n-900 hover:bg-n-100 disabled:opacity-50" aria-label="Subir documento">
              <Upload className="w-4 h-4" />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={language === 'es'
                ? (useCase === 'general' ? 'Escriba su consulta o suba un documento...' : 'Haga una pregunta sobre este caso...')
                : (useCase === 'general' ? 'Type your question or upload a document...' : 'Ask a question about this case...')}
              disabled={isTyping}
              className="flex-1 bg-transparent border-none focus:ring-0 text-n-900 text-md resize-none py-2.5 px-2 outline-none min-h-[40px] max-h-[120px] placeholder:text-n-400 disabled:opacity-50"
              aria-label={language === 'es' ? 'Escribir mensaje' : 'Type message'}
            />
            {isTyping ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-2.5 rounded-md bg-gold-500 text-n-0 shrink-0 hover:bg-gold-600 transition-colors flex items-center gap-1.5 px-3"
                aria-label={language === 'es' ? 'Detener generación' : 'Stop generation'}
                title={language === 'es' ? 'Detener' : 'Stop'}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span className="text-xs font-medium hidden sm:inline">
                  {language === 'es' ? 'Detener' : 'Stop'}
                </span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-2.5 rounded-md bg-n-900 text-n-0 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-n-700 transition-colors"
                aria-label={language === 'es' ? 'Enviar' : 'Send'}
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
          <p className="text-center text-xs text-n-600 mt-3 font-mono num">
            {t.chat.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}

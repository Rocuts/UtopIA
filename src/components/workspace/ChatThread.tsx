'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Send,
  Mic,
  MicOff,
  Upload,
  Globe,
  ChevronDown,
  ChevronUp,
  Scale,
  BookOpen,
  CheckSquare,
  Calculator,
  FileText,
  X,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useRealtimeAPI } from '@/hooks/useRealtimeAPI';
import { RiskGauge } from '@/components/ui/RiskGauge';
import { DocumentPreview } from '@/components/ui/DocumentPreview';
import { cn } from '@/lib/utils';
import {
  loadConversation,
  saveConversation,
  generateConversationId,
  inferTitle,
} from '@/lib/storage/conversation-history';
import type {
  ChatMessage,
  RiskAssessmentData,
  UploadedDocument,
  LegalReference,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const INITIAL_MSG = {
  es: 'Bienvenido a UtopIA. Soy su asistente especializado en consultoría contable y tributaria colombiana. ¿En qué puedo ayudarle hoy?',
  en: 'Welcome to UtopIA. I am your assistant specialized in Colombian accounting and tax consulting. How can I help you today?',
};

function generateId(): string {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch {
    // fallback below
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Extract legal article references from markdown content. */
function extractLegalReferences(content: string): LegalReference[] {
  const refs: LegalReference[] = [];
  const seen = new Set<string>();
  // Match patterns like "Art. 641 E.T.", "Artículo 644", "Art. 647 del Estatuto Tributario"
  const regex = /(?:Art(?:\.|ículo)\s+(\d+(?:\s*[-–]\d+)?))\s*(?:(?:del\s+)?(?:E\.?\s*T\.?|Estatuto\s+Tributario))?(?:\s*[-–—]\s*(.+?))?(?:\.|,|;|\n|$)/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const article = `Art. ${match[1].trim()} E.T.`;
    if (seen.has(article)) continue;
    seen.add(article);
    refs.push({
      article,
      description: match[2]?.trim() || '',
    });
  }
  return refs;
}

/** Extract actionable recommendation lines from content. */
function extractRecommendations(content: string): string[] {
  const lines = content.split('\n');
  const recs: string[] = [];
  let inRecommendationSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#+\s*(recomendaciones|acciones|pasos|recommendations|actions|steps)/i.test(trimmed)) {
      inRecommendationSection = true;
      continue;
    }
    if (inRecommendationSection) {
      if (/^#+\s/.test(trimmed) && !/^#+\s*(recomendaciones|acciones|pasos|recommendations|actions|steps)/i.test(trimmed)) {
        inRecommendationSection = false;
        continue;
      }
      if (/^(\d+\.\s+|[-*]\s+)/.test(trimmed)) {
        recs.push(trimmed.replace(/^(\d+\.\s+|[-*]\s+)/, ''));
      }
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatThreadProps {
  conversationId: string;
  useCase: string;
  language: 'es' | 'en';
  onRiskAssessment?: (data: RiskAssessmentData) => void;
  onDocumentUploaded?: (doc: UploadedDocument) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[#e5e5e5]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#525252] hover:bg-[#fafafa] transition-colors"
        aria-expanded={open}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', ...NOVA_SPRING }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Progress status messages for SSE streaming */
const PROGRESS_LABELS: Record<string, { es: string; en: string }> = {
  classifying: { es: 'Clasificando su consulta...', en: 'Classifying your query...' },
  enhancing: { es: 'Mejorando su pregunta...', en: 'Enhancing your question...' },
  routing: { es: 'Consultando agentes especializados...', en: 'Consulting specialized agents...' },
  agent_working: { es: 'Investigando...', en: 'Researching...' },
  synthesizing: { es: 'Sintetizando respuesta...', en: 'Synthesizing response...' },
};

function TypingIndicator({ language, progressStatus }: { language: 'es' | 'en'; progressStatus?: string }) {
  const label = progressStatus && PROGRESS_LABELS[progressStatus]
    ? PROGRESS_LABELS[progressStatus][language]
    : (language === 'es' ? 'Analizando su consulta...' : 'Analyzing your consultation...');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', ...NOVA_SPRING }}
      className="px-6 py-4"
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="h-[2px] bg-gradient-to-r from-[#d4a017] via-[#0a0a0a] to-transparent flex-1 max-w-[200px] rounded-full"
          animate={{ opacity: [0.3, 1, 0.3], scaleX: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: 'left' }}
        />
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
          {label}
        </span>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Message components
// ---------------------------------------------------------------------------

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...NOVA_SPRING }}
      className="border-t border-[#e5e5e5] px-6 py-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[#525252]">You</span>
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
          {formatTime(message.timestamp)}
        </span>
      </div>
      <p className="text-sm text-[#0a0a0a] leading-relaxed whitespace-pre-wrap">{message.content}</p>
    </motion.div>
  );
}

function AssistantMessage({ message, language }: { message: ChatMessage; language: 'es' | 'en' }) {
  const legalRefs = extractLegalReferences(message.content);
  const recommendations = extractRecommendations(message.content);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...NOVA_SPRING }}
      className="bg-[#fafafa] border-t border-b border-[#e5e5e5]"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e5e5e5]">
        <span className="text-xs font-medium text-[#0a0a0a]">UtopIA</span>
        <span className="text-[#a3a3a3] text-xs">·</span>
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
          {language === 'es' ? 'Analisis' : 'Analysis'}
        </span>
        <span className="text-[#a3a3a3] text-xs">·</span>
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Web search indicator */}
      {message.webSearchUsed && (
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-[#e5e5e5] bg-white">
          <Globe className="w-3.5 h-3.5 text-[#525252]" />
          <span className="text-xs text-[#525252] font-[family-name:var(--font-geist-mono)]">
            {language === 'es' ? 'Complementado con busqueda web' : 'Enhanced with web search'}
          </span>
        </div>
      )}

      {/* Markdown body */}
      <div className="px-6 py-4 prose prose-sm max-w-none text-[#0a0a0a] prose-headings:text-[#0a0a0a] prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-[#d4a017] prose-strong:text-[#0a0a0a] prose-code:text-[#525252] prose-code:bg-white prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:border prose-code:border-[#e5e5e5] prose-code:text-xs prose-code:font-[family-name:var(--font-geist-mono)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {message.content}
        </ReactMarkdown>
      </div>

      {/* Risk Assessment section */}
      {message.riskAssessment && (
        <div className="border-t border-[#e5e5e5] px-6 py-4">
          <div className="flex items-start gap-4 flex-col sm:flex-row">
            <div className="shrink-0">
              <RiskGauge
                level={message.riskAssessment.level}
                score={message.riskAssessment.score}
                label={
                  language === 'es'
                    ? message.riskAssessment.level.toUpperCase()
                    : { bajo: 'LOW', medio: 'MEDIUM', alto: 'HIGH', critico: 'CRITICAL' }[message.riskAssessment.level]
                }
                className="scale-[0.8] origin-top-left"
              />
            </div>
            <div className="flex-1 min-w-0">
              {message.riskAssessment.factors.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-xs font-medium text-[#525252] mb-1.5 uppercase tracking-wide">
                    {language === 'es' ? 'Factores de Riesgo' : 'Risk Factors'}
                  </h4>
                  <ul className="space-y-1">
                    {message.riskAssessment.factors.map((f, i) => (
                      <li key={i} className="text-xs text-[#525252] flex items-start gap-1.5">
                        <span className={cn(
                          'mt-1 w-1.5 h-1.5 rounded-full shrink-0',
                          f.severity === 'alto' || f.severity === 'high' ? 'bg-[#ef4444]' :
                          f.severity === 'medio' || f.severity === 'medium' ? 'bg-[#eab308]' : 'bg-[#22c55e]'
                        )} />
                        {f.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {message.riskAssessment.recommendations.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-[#525252] mb-1.5 uppercase tracking-wide">
                    {language === 'es' ? 'Recomendaciones' : 'Recommendations'}
                  </h4>
                  <ul className="space-y-1">
                    {message.riskAssessment.recommendations.map((r, i) => (
                      <li key={i} className="text-xs text-[#525252] pl-4 relative before:content-['-'] before:absolute before:left-0 before:text-[#a3a3a3]">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sanction calculation section */}
      {message.sanctionCalculation && (
        <CollapsibleSection
          title={language === 'es' ? 'Calculo de Sancion' : 'Sanction Calculation'}
          icon={Calculator}
          defaultOpen
        >
          <div className="bg-white border border-[#e5e5e5] rounded-sm p-3">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                {message.sanctionCalculation.article}
              </span>
              <span className="text-lg font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
                ${message.sanctionCalculation.amount.toLocaleString('es-CO')}
              </span>
            </div>
            <p className="text-xs text-[#525252] font-[family-name:var(--font-geist-mono)] mb-1">
              {message.sanctionCalculation.formula}
            </p>
            <p className="text-xs text-[#a3a3a3]">{message.sanctionCalculation.explanation}</p>
          </div>
        </CollapsibleSection>
      )}

      {/* Legal References section */}
      {legalRefs.length > 0 && (
        <CollapsibleSection
          title={language === 'es' ? 'Referencias Legales' : 'Legal References'}
          icon={Scale}
        >
          <ul className="space-y-1.5">
            {legalRefs.map((ref, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <BookOpen className="w-3 h-3 mt-0.5 text-[#a3a3a3] shrink-0" />
                <span>
                  <span className="font-medium text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{ref.article}</span>
                  {ref.description && <span className="text-[#525252]"> — {ref.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Extracted recommendations section */}
      {recommendations.length > 0 && (
        <CollapsibleSection
          title={language === 'es' ? 'Acciones Recomendadas' : 'Recommended Actions'}
          icon={CheckSquare}
        >
          <ol className="space-y-1.5">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[#525252]">
                <span className="font-medium text-[#0a0a0a] font-[family-name:var(--font-geist-mono)] shrink-0 w-4 text-right">{i + 1}.</span>
                <span>{rec}</span>
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main ChatThread Component
// ---------------------------------------------------------------------------

export function ChatThread({
  conversationId: externalConversationId,
  useCase,
  language: propLanguage,
  onRiskAssessment,
  onDocumentUploaded,
}: ChatThreadProps) {
  const { t } = useLanguage();
  const language = propLanguage;

  // State
  const [conversationId] = useState(() => externalConversationId || generateConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Try to load an existing conversation
    const saved = loadConversation(externalConversationId);
    if (saved && saved.messages.length > 0) {
      return saved.messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: '', // Not stored in saved format
        webSearchUsed: m.webSearchUsed,
      }));
    }
    // New conversation: start with welcome message
    return [
      {
        id: '1',
        role: 'assistant' as const,
        content: INITIAL_MSG[language],
        timestamp: new Date().toISOString(),
      },
    ];
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>([]);
  const [documentContext, setDocumentContext] = useState('');
  const [progressStatus, setProgressStatus] = useState<string | undefined>(undefined);

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice
  const {
    isConnecting,
    isConnected,
    error: voiceError,
    volume,
    startSession,
    stopSession,
    messageLog,
  } = useRealtimeAPI();

  // Update initial message on language change
  useEffect(() => {
    if (messages.length === 1 && messages[0].id === '1') {
      setMessages([
        {
          id: '1',
          role: 'assistant',
          content: INITIAL_MSG[language],
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // ---------------------------------------------------------------------------
  // API call
  // ---------------------------------------------------------------------------

  /**
   * Parse SSE stream from the orchestrated chat endpoint.
   * Falls back to JSON parsing for legacy (non-streaming) responses.
   */
  const sendMessage = async (allMessages: ChatMessage[]) => {
    setIsTyping(true);
    setProgressStatus(undefined);
    try {
      const payload = {
        messages: allMessages.map(m => ({ id: m.id, role: m.role, content: m.content })),
        language,
        useCase,
        ...(documentContext ? { documentContext } : {}),
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stream': 'true',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const contentType = response.headers.get('Content-Type') || '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;

      if (contentType.includes('text/event-stream') && response.body) {
        // ---- SSE streaming mode (orchestrated) ----
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from the buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6);
              try {
                const eventData = JSON.parse(jsonStr);
                if (currentEvent === 'progress') {
                  setProgressStatus(eventData.type);
                } else if (currentEvent === 'result') {
                  data = eventData;
                } else if (currentEvent === 'error') {
                  throw new Error(eventData.error || 'Stream error');
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue; // skip malformed JSON
                throw e;
              }
            }
          }
        }
      } else {
        // ---- JSON mode (legacy) ----
        data = await response.json();
      }

      if (!data) throw new Error('No response data received');

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.content,
        timestamp: new Date().toISOString(),
        webSearchUsed: data.webSearchUsed || false,
        riskAssessment: data.riskAssessment ?? undefined,
        sanctionCalculation: data.sanctionCalculation ?? undefined,
      };

      if (data.riskAssessment) {
        onRiskAssessment?.(data.riskAssessment);
      }

      setMessages(prev => {
        const updated = [...prev, assistantMsg];
        saveConversation({
          id: conversationId,
          title: inferTitle(updated.map(m => ({ id: m.id, role: m.role, content: m.content }))),
          useCase,
          messages: updated.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            webSearchUsed: m.webSearchUsed,
          })),
          createdAt: updated[0]?.timestamp || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          riskLevel: data.riskAssessment?.level ?? 'bajo',
        });
        return updated;
      });
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: t.chatAi.errorMsg,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsTyping(false);
      setProgressStatus(undefined);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    sendMessage(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const toggleVoice = () => {
    if (voiceMode) {
      stopSession();
      setVoiceMode(false);
    } else {
      startSession();
      setVoiceMode(true);
    }
  };

  // File upload via input
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // File upload shared logic
  const uploadFile = async (file: File) => {
    setIsUploading(true);
    const newDoc: UploadedDocument = {
      filename: file.name,
      size: file.size,
      chunks: 0,
      uploadedAt: new Date().toISOString(),
    };
    setUploadedDocs(prev => [...prev, newDoc]);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('context', file.name);

    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Upload failed');

      const fullText = data.extractedText || '';
      const finishedDoc: UploadedDocument = {
        ...newDoc,
        chunks: data.chunks || 0,
        textPreview: fullText.slice(0, 2000),
        extractedText: fullText,
      };
      setUploadedDocs(prev => {
        const updated = prev.map(d =>
          d.filename === file.name && d.uploadedAt === newDoc.uploadedAt ? finishedDoc : d,
        );
        // Rebuild documentContext from all documents with extracted text
        setDocumentContext(
          updated
            .filter(d => d.extractedText)
            .map(d => d.extractedText)
            .join('\n\n'),
        );
        return updated;
      });
      onDocumentUploaded?.(finishedDoc);

      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content:
            language === 'es'
              ? `He procesado su documento **"${file.name}"** (${data.chunks} fragmentos). Ahora puedo responder preguntas basadas en su contenido. ¿Que desea consultar?`
              : `I've processed your document **"${file.name}"** (${data.chunks} chunks). I can now answer questions based on its content. What would you like to know?`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (uploadError) {
      setUploadedDocs(prev => prev.filter(d => d.uploadedAt !== newDoc.uploadedAt));
      const errorMsg = uploadError instanceof Error ? uploadError.message : '';
      const isScannedPdf = errorMsg.includes('SCANNED_PDF');
      const isOldFormat = errorMsg.includes('DOC_FORMAT') || errorMsg.includes('XLS_FORMAT');
      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: isScannedPdf
            ? (language === 'es'
              ? 'Este PDF parece ser una **imagen escaneada** y no fue posible extraer el texto automaticamente. Intente subir capturas de cada pagina como imagenes (`.jpg` o `.png`) para que UtopIA las procese con OCR.'
              : 'This PDF appears to be a **scanned image** and automatic text extraction failed. Try uploading screenshots of each page as images (`.jpg` or `.png`) so UtopIA can process them with OCR.')
            : isOldFormat
            ? (language === 'es'
              ? 'Este archivo usa un **formato antiguo** (`.doc` o `.xls`). Por favor guárdelo como **`.docx`** o **`.xlsx`** (formato moderno) e inténtelo de nuevo.'
              : 'This file uses an **old format** (`.doc` or `.xls`). Please save it as **`.docx`** or **`.xlsx`** (modern format) and try again.')
            : (language === 'es'
              ? `No pude procesar el archivo${errorMsg ? ': ' + errorMsg : ''}. Verifique el formato e intente de nuevo.`
              : `Could not process the file${errorMsg ? ': ' + errorMsg : ''}. Please check the format and try again.`),
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsUploading(false);
    }
  };

  const removeDocument = (filename: string) => {
    setUploadedDocs(prev => {
      const remaining = prev.filter(d => d.filename !== filename);
      // Rebuild documentContext from remaining documents
      setDocumentContext(
        remaining
          .filter(d => d.extractedText)
          .map(d => d.extractedText)
          .join('\n\n'),
      );
      return remaining;
    });
  };

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm border-2 border-dashed border-[#d4a017] rounded-sm flex flex-col items-center justify-center gap-3"
          >
            <Upload className="w-8 h-8 text-[#d4a017]" />
            <p className="text-sm font-medium text-[#0a0a0a]">
              {language === 'es' ? 'Suelte su documento aqui' : 'Drop your document here'}
            </p>
            <p className="text-xs text-[#a3a3a3]">PDF, Excel, CSV, TXT, JSON, XML</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        data-lenis-prevent
        className="flex-1 min-h-0 overflow-y-auto styled-scrollbar bg-white"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="flex flex-col w-full">
          {messages.map(msg =>
            msg.role === 'user' ? (
              <UserMessage key={msg.id} message={msg} />
            ) : (
              <AssistantMessage key={msg.id} message={msg} language={language} />
            ),
          )}

          <AnimatePresence>
            {isTyping && <TypingIndicator language={language} progressStatus={progressStatus} />}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Voice orb overlay */}
      <AnimatePresence>
        {voiceMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', ...NOVA_SPRING }}
            className="absolute bottom-24 right-4 z-40"
          >
            <div className="w-[120px] h-[120px] rounded-sm overflow-hidden bg-[#0a0a0a] border border-[#e5e5e5] shadow-lg relative">
              {/* Simplified orb indicator without Three.js canvas for performance */}
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                  className="rounded-full"
                  style={{
                    width: 48,
                    height: 48,
                    background: `radial-gradient(circle, #ffffff 0%, #d4a017 50%, transparent 100%)`,
                  }}
                  animate={{
                    scale: isConnecting ? [1, 1.2, 1] : [1 + volume * 0.5, 1 + volume * 0.8, 1 + volume * 0.5],
                    opacity: isConnecting ? [0.5, 1, 0.5] : 0.9,
                  }}
                  transition={{
                    duration: isConnecting ? 1 : 0.3,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              </div>
              <button
                onClick={toggleVoice}
                className="absolute bottom-1 right-1 p-1 rounded-sm bg-[#ef4444]/90 text-white hover:bg-[#ef4444] transition-colors"
                aria-label={language === 'es' ? 'Detener voz' : 'Stop voice'}
              >
                <MicOff className="w-3 h-3" />
              </button>
            </div>
            {/* Voice log */}
            <div className="mt-1 max-w-[120px]">
              <AnimatePresence>
                {messageLog.slice(-1).map((log, i) => (
                  <motion.p
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)] truncate"
                  >
                    {log}
                  </motion.p>
                ))}
              </AnimatePresence>
            </div>
            {voiceError && (
              <p className="text-[10px] text-[#ef4444] mt-0.5 max-w-[120px] truncate">{voiceError}</p>
            )}
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
            transition={{ type: 'spring', ...NOVA_SPRING }}
            className="overflow-hidden border-t border-[#e5e5e5] bg-[#fafafa]"
          >
            <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto styled-scrollbar">
              {uploadedDocs.map((doc, i) => (
                <div
                  key={`${doc.filename}-${i}`}
                  className="flex items-center gap-1.5 bg-white border border-[#e5e5e5] rounded-sm px-2 py-1 shrink-0"
                >
                  <FileText className="w-3 h-3 text-[#525252]" />
                  <span className="text-xs text-[#0a0a0a] max-w-[120px] truncate">{doc.filename}</span>
                  <button
                    onClick={() => removeDocument(doc.filename)}
                    className="p-0.5 text-[#a3a3a3] hover:text-[#ef4444] transition-colors"
                    aria-label={`Remove ${doc.filename}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', ...NOVA_SPRING }}
        className="p-4 bg-white border-t border-[#e5e5e5] relative z-20"
      >
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 bg-white border border-[#e5e5e5] rounded-sm p-1.5 focus-within:border-[#0a0a0a] transition-colors"
        >
          {/* Voice toggle */}
          <button
            type="button"
            onClick={toggleVoice}
            className={cn(
              'p-2.5 rounded-sm flex items-center justify-center shrink-0 transition-colors',
              voiceMode
                ? 'text-[#ef4444] bg-[#fef2f2]'
                : 'text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa]',
            )}
            aria-label={voiceMode ? (language === 'es' ? 'Detener voz' : 'Stop voice') : t.chatAi.voiceButtonTitle}
          >
            {voiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* File upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.csv,.json,.xml,.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.tiff,.tif,.bmp,.heic"
            onChange={handleFileSelect}
            className="hidden"
            aria-label={language === 'es' ? 'Subir documento' : 'Upload document'}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-2.5 rounded-sm flex items-center justify-center shrink-0 transition-colors text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] disabled:opacity-50"
            aria-label={language === 'es' ? 'Subir documento' : 'Upload document'}
          >
            {isUploading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Upload className="w-4 h-4" />
              </motion.div>
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.chat.inputPlaceholder}
            disabled={isTyping}
            className="flex-1 bg-transparent border-none focus:ring-0 text-[#0a0a0a] text-sm resize-none py-2.5 px-2 outline-none min-h-[40px] max-h-[120px] placeholder:text-[#a3a3a3] disabled:opacity-50"
            aria-label={language === 'es' ? 'Escribir mensaje' : 'Type message'}
          />

          {/* Send */}
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="p-2.5 rounded-sm bg-[#0a0a0a] text-white shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#262626] transition-colors"
            aria-label={language === 'es' ? 'Enviar mensaje' : 'Send message'}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-xs text-[#a3a3a3] mt-3 font-[family-name:var(--font-geist-mono)]">
          {t.chat.disclaimer}
        </p>
      </motion.div>
    </div>
  );
}

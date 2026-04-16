'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
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
  Zap,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRealtimeAPI } from '@/hooks/useRealtimeAPI';
import { AgentPipelineViz } from '@/design-system/components/AgentPipelineViz';
import { DSBadge } from '@/design-system/components/Badge';
import { CitationBadge } from '@/design-system/components/CitationBadge';
import { RiskMeter } from '@/design-system/components/RiskMeter';
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
import type { AgentNode, AgentTier } from '@/types/platform';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPRING = { stiffness: 400, damping: 25 };

const INITIAL_MSG: Record<string, Record<string, string>> = {
  general: {
    es: 'Bienvenido a UtopIA. Soy su asistente especializado en consultoria contable, tributaria y financiera colombiana.\n\nPuede:\n- **Hacer cualquier pregunta** sobre contabilidad, NIIF, impuestos o finanzas\n- **Subir documentos** (PDF, Excel, Word, imagenes) usando el boton 📎 o arrastrando al chat\n- **Analizar extractos bancarios**, facturas, balances de prueba y mas\n\n¿En que puedo ayudarle?',
    en: 'Welcome to UtopIA. I am your assistant specialized in Colombian accounting, tax and financial consulting.\n\nYou can:\n- **Ask any question** about accounting, IFRS, taxes or finance\n- **Upload documents** (PDF, Excel, Word, images) using the 📎 button or dragging to the chat\n- **Analyze bank statements**, invoices, trial balances and more\n\nHow can I help you?',
  },
  default: {
    es: 'Bienvenido a UtopIA. Soy su asistente especializado en consultoria contable y tributaria colombiana. ¿En que puedo ayudarle hoy?',
    en: 'Welcome to UtopIA. I am your assistant specialized in Colombian accounting and tax consulting. How can I help you today?',
  },
};

function generateId(): string {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch { /* fallback */ }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function extractLegalReferences(content: string): LegalReference[] {
  const refs: LegalReference[] = [];
  const seen = new Set<string>();
  const regex = /(?:Art(?:\.|iculo)\s+(\d+(?:\s*[-–]\d+)?))\s*(?:(?:del\s+)?(?:E\.?\s*T\.?|Estatuto\s+Tributario))?(?:\s*[-–—]\s*(.+?))?(?:\.|,|;|\n|$)/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const article = `Art. ${match[1].trim()} E.T.`;
    if (seen.has(article)) continue;
    seen.add(article);
    refs.push({ article, description: match[2]?.trim() || '' });
  }
  return refs;
}

// ─── Agent Pipeline State ─────────────────────────────────────────────────────

interface PipelineVizState {
  visible: boolean;
  collapsed: boolean;
  tier: AgentTier;
  nodes: AgentNode[];
  toolLog: string[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
            transition={{ type: 'spring', ...SPRING }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CaseHeader({
  useCase,
  caseId,
  language,
}: {
  useCase: string;
  caseId: string;
  language: 'es' | 'en';
}) {
  const labels: Record<string, string> = {
    'general': 'Chat General',
    'dian-defense': 'Defensa DIAN',
    'tax-refund': 'Devoluciones',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Inteligencia Financiera',
    'tax-planning': 'Planeacion Tributaria',
    'transfer-pricing': 'Precios de Transferencia',
    'business-valuation': 'Valoracion Empresarial',
    'fiscal-audit-opinion': 'Dictamen Rev. Fiscal',
    'tax-reconciliation': 'Conciliacion Fiscal',
    'feasibility-study': 'Estudio de Factibilidad',
  };
  const icons: Record<string, string> = {
    'general': '\uD83D\uDCAC',
    'dian-defense': '\u2696\uFE0F',
    'tax-refund': '\uD83D\uDD04',
    'due-diligence': '\uD83D\uDD0D',
    'financial-intelligence': '\uD83D\uDCCA',
    'tax-planning': '\uD83E\uDDEE',
    'transfer-pricing': '\uD83C\uDF10',
    'business-valuation': '\uD83D\uDCB0',
    'fiscal-audit-opinion': '\uD83D\uDCCB',
    'tax-reconciliation': '\uD83D\uDD00',
    'feasibility-study': '\uD83D\uDCA1',
  };

  return (
    <div className="px-6 py-3 border-b border-[#e5e5e5] bg-[#fafafa] flex items-center gap-3 sticky top-0 z-10">
      <span className="text-lg">{icons[useCase] ?? '\uD83D\uDCCB'}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold text-[#0a0a0a]">
          {labels[useCase] ?? useCase}
        </span>
      </div>
      <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
        TC-{caseId.slice(5, 13)}
      </span>
    </div>
  );
}

function PipelineBanner({
  vizState,
  onToggle,
}: {
  vizState: PipelineVizState;
  onToggle: () => void;
}) {
  if (!vizState.visible) return null;

  if (vizState.collapsed) {
    return (
      <button
        onClick={onToggle}
        className="w-full px-6 py-2 border-b border-[#e5e5e5] bg-[#fafafa] flex items-center gap-2 text-xs text-[#525252] hover:bg-[#f5f5f5] transition-colors"
      >
        <Zap className="w-3 h-3 text-[#D4A017]" />
        <span>
          Analizado por: {vizState.nodes.filter(n => n.status === 'complete').map(n => n.label).join(' + ')}
        </span>
        <DSBadge variant="tier" tier={vizState.tier} label="" size="sm" />
        <span className="text-[10px] text-[#a3a3a3] ml-auto">
          {vizState.toolLog.length} herramientas · ver detalle
        </span>
      </button>
    );
  }

  return (
    <div className="border-b border-[#e5e5e5] bg-[#fafafa] px-6 py-3">
      <AgentPipelineViz nodes={vizState.nodes} tier={vizState.tier} compact />
      {vizState.toolLog.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {vizState.toolLog.slice(-3).map((log, i) => (
            <p key={i} className="text-[10px] text-[#737373] font-[family-name:var(--font-geist-mono)] truncate">
              {log}
            </p>
          ))}
        </div>
      )}
      <button
        onClick={onToggle}
        className="text-[10px] text-[#a3a3a3] hover:text-[#525252] mt-1"
      >
        Colapsar
      </button>
    </div>
  );
}

function TypingIndicator({ language, progressStatus }: { language: 'es' | 'en'; progressStatus?: string }) {
  const labels: Record<string, Record<string, string>> = {
    classifying: { es: 'Clasificando su consulta...', en: 'Classifying your query...' },
    enhancing: { es: 'Mejorando su pregunta...', en: 'Enhancing your question...' },
    routing: { es: 'Consultando agentes especializados...', en: 'Consulting specialized agents...' },
    agent_working: { es: 'Investigando...', en: 'Researching...' },
    synthesizing: { es: 'Sintetizando respuesta...', en: 'Synthesizing response...' },
  };

  const label = progressStatus && labels[progressStatus]
    ? labels[progressStatus][language]
    : (language === 'es' ? 'Analizando su consulta...' : 'Analyzing your consultation...');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', ...SPRING }}
      className="px-6 py-4"
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="h-[2px] bg-gradient-to-r from-[#d4a017] via-[#0a0a0a] to-transparent flex-1 max-w-[200px] rounded-full"
          animate={{ opacity: [0.3, 1, 0.3], scaleX: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: 'left' }}
        />
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">{label}</span>
      </div>
    </motion.div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...SPRING }}
      className="border-t border-[#e5e5e5] px-6 py-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[#525252]">Usted</span>
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...SPRING }}
      className="bg-[#fafafa] border-t border-b border-[#e5e5e5]"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e5e5e5]">
        <span className="text-xs font-medium text-[#0a0a0a]">UtopIA</span>
        <span className="text-[#a3a3a3] text-xs">\u00B7</span>
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
          {language === 'es' ? 'Analisis' : 'Analysis'}
        </span>
        {message.tier && (
          <>
            <span className="text-[#a3a3a3] text-xs">\u00B7</span>
            <DSBadge variant="tier" tier={message.tier as AgentTier} label="" size="sm" />
          </>
        )}
        <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)] ml-auto">
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

      {/* Risk Assessment */}
      {message.riskAssessment && (
        <div className="border-t border-[#e5e5e5] px-6 py-4">
          <RiskMeter
            score={message.riskAssessment.score}
            level={
              ({ bajo: 'low', medio: 'medium', alto: 'high', critico: 'critical' } as const)[message.riskAssessment.level]
            }
          />
          {message.riskAssessment.factors.length > 0 && (
            <div className="mt-3">
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
        </div>
      )}

      {/* Sanction Calculation */}
      {message.sanctionCalculation && (
        <CollapsibleSection
          title={language === 'es' ? 'Calculo de Sancion' : 'Sanction Calculation'}
          icon={Calculator}
          defaultOpen
        >
          <div className="bg-white border border-[#e5e5e5] rounded-lg p-4">
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

      {/* Legal References */}
      {legalRefs.length > 0 && (
        <CollapsibleSection
          title={language === 'es' ? 'Referencias Legales' : 'Legal References'}
          icon={Scale}
        >
          <div className="flex flex-wrap gap-1.5">
            {legalRefs.map((ref, i) => (
              <CitationBadge
                key={i}
                article={ref.article}
                source="Estatuto Tributario"
                normText={ref.description}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
  const language = propLanguage;

  // State
  const [conversationId] = useState(() => externalConversationId || generateConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadConversation(externalConversationId);
    if (saved && saved.messages.length > 0) {
      return saved.messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: '',
        webSearchUsed: m.webSearchUsed,
      }));
    }
    return [{
      id: '1',
      role: 'assistant' as const,
      content: (INITIAL_MSG[useCase === 'general' ? 'general' : 'default'] ?? INITIAL_MSG.default)[language],
      timestamp: new Date().toISOString(),
    }];
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>([]);
  const [documentContext, setDocumentContext] = useState('');
  const [progressStatus, setProgressStatus] = useState<string | undefined>(undefined);

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

  // ─── API Call (SSE) ─────────────────────────────────────────────────────────

  const sendMessage = async (allMessages: ChatMessage[]) => {
    setIsTyping(true);
    setProgressStatus(undefined);
    setVizState({ visible: false, collapsed: false, tier: 'T1', nodes: [], toolLog: [] });

    try {
      const payload = {
        messages: allMessages.map(m => ({ id: m.id, role: m.role, content: m.content })),
        language, useCase,
        ...(documentContext ? { documentContext } : {}),
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const contentType = response.headers.get('Content-Type') || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;

      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

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

                  // Build pipeline visualization from SSE events
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
                    const agentNodes: AgentNode[] = (eventData.agents ?? []).map((a: string) => ({
                      id: a,
                      label: a === 'tax' ? 'Ag. Tributario' : a === 'accounting' ? 'Ag. Contable' : a === 'documents' ? 'Ag. Documentos' : 'Ag. Estrategia',
                      status: 'pending' as const,
                      branch: a as AgentNode['branch'],
                    }));
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

      if (!data) throw new Error('No response data received');

      // Mark all nodes complete
      setVizState(prev => ({
        ...prev,
        collapsed: true,
        nodes: prev.nodes.map(n => ({ ...n, status: 'complete' as const })),
      }));

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.content,
        timestamp: new Date().toISOString(),
        webSearchUsed: data.webSearchUsed || false,
        riskAssessment: data.riskAssessment ?? undefined,
        sanctionCalculation: data.sanctionCalculation ?? undefined,
        tier: data.tier,
        agentsUsed: data.agentsUsed,
        enhancedQuery: data.enhancedQuery,
      };

      // Update intelligence panel
      if (data.riskAssessment) {
        onRiskAssessment?.(data.riskAssessment);
        setIntelligencePanelData(prev => ({
          ...prev,
          riskLevel: ({ bajo: 'low', medio: 'medium', alto: 'high', critico: 'critical' } as const)[data.riskAssessment.level as 'bajo' | 'medio' | 'alto' | 'critico'],
          riskScore: data.riskAssessment.score,
        }));
      }

      // Extract citations for intelligence panel
      const legalRefs = extractLegalReferences(data.content);
      if (legalRefs.length > 0) {
        setIntelligencePanelData(prev => ({
          ...prev,
          citations: legalRefs.map(r => ({ article: r.article, source: 'Estatuto Tributario' })),
        }));
      }

      setMessages(prev => {
        const updated = [...prev, assistantMsg];
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
    } catch {
      setMessages(prev => [
        ...prev,
        { id: generateId(), role: 'assistant', content: t.chatAi.errorMsg, timestamp: new Date().toISOString() },
      ]);
    } finally {
      setIsTyping(false);
      setProgressStatus(undefined);
    }
  };

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: input.trim(), timestamp: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    sendMessage(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

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
    setUploadedDocs(prev => [...prev, newDoc]);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('context', file.name);
    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed');
      const fullText = data.extractedText || '';
      const finishedDoc: UploadedDocument = { ...newDoc, chunks: data.chunks || 0, textPreview: fullText.slice(0, 2000), extractedText: fullText };
      setUploadedDocs(prev => {
        const updated = prev.map(d => d.filename === file.name && d.uploadedAt === newDoc.uploadedAt ? finishedDoc : d);
        setDocumentContext(updated.filter(d => d.extractedText).map(d => d.extractedText).join('\n\n'));
        return updated;
      });
      onDocumentUploaded?.(finishedDoc);
      setMessages(prev => [...prev, {
        id: generateId(), role: 'assistant',
        content: language === 'es'
          ? `He procesado su documento **"${file.name}"** (${data.chunks} fragmentos). Ahora puedo responder preguntas basadas en su contenido.`
          : `I've processed your document **"${file.name}"** (${data.chunks} chunks). I can now answer questions based on its content.`,
        timestamp: new Date().toISOString(),
      }]);
    } catch (err) {
      setUploadedDocs(prev => prev.filter(d => d.uploadedAt !== newDoc.uploadedAt));
      setMessages(prev => [...prev, {
        id: generateId(), role: 'assistant',
        content: language === 'es'
          ? `No pude procesar el archivo. Verifique el formato e intente de nuevo.`
          : `Could not process the file. Please check the format and try again.`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  const removeDocument = (filename: string) => {
    setUploadedDocs(prev => {
      const remaining = prev.filter(d => d.filename !== filename);
      setDocumentContext(remaining.filter(d => d.extractedText).map(d => d.extractedText).join('\n\n'));
      return remaining;
    });
  };

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
            className="absolute inset-0 z-50 bg-white/90 border-2 border-dashed border-[#d4a017] rounded-sm flex flex-col items-center justify-center gap-3"
          >
            <Upload className="w-8 h-8 text-[#d4a017]" />
            <p className="text-sm font-medium text-[#0a0a0a]">
              {language === 'es' ? 'Suelte su documento aqui' : 'Drop your document here'}
            </p>
            <p className="text-xs text-[#a3a3a3]">
              PDF, Excel, Word, CSV, imagenes
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
        className="flex-1 min-h-0 overflow-y-auto styled-scrollbar bg-white"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="flex flex-col w-full">
          {messages.map(msg =>
            msg.role === 'user'
              ? <UserMessage key={msg.id} message={msg} />
              : <AssistantMessage key={msg.id} message={msg} language={language} />
          )}
          <AnimatePresence>
            {isTyping && <TypingIndicator language={language} progressStatus={progressStatus} />}
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
            <div className="w-[120px] h-[120px] rounded-lg overflow-hidden bg-[#0a0a0a] border border-[#e5e5e5] shadow-lg relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                  className="rounded-full"
                  style={{ width: 48, height: 48, background: 'radial-gradient(circle, #ffffff 0%, #d4a017 50%, transparent 100%)' }}
                  animate={{ scale: isConnecting ? [1, 1.2, 1] : [1 + volume * 0.5, 1 + volume * 0.8, 1 + volume * 0.5], opacity: isConnecting ? [0.5, 1, 0.5] : 0.9 }}
                  transition={{ duration: isConnecting ? 1 : 0.3, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
              <button onClick={toggleVoice} className="absolute bottom-1 right-1 p-1 rounded bg-[#ef4444]/90 text-white hover:bg-[#ef4444] transition-colors" aria-label="Detener voz">
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
            className="overflow-hidden border-t border-[#e5e5e5] bg-[#fafafa]"
          >
            <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto styled-scrollbar">
              {uploadedDocs.map((doc, i) => (
                <div key={`${doc.filename}-${i}`} className="flex items-center gap-1.5 bg-white border border-[#e5e5e5] rounded px-2 py-1 shrink-0">
                  <FileText className="w-3 h-3 text-[#525252]" />
                  <span className="text-xs text-[#0a0a0a] max-w-[120px] truncate">{doc.filename}</span>
                  <button onClick={() => removeDocument(doc.filename)} className="p-0.5 text-[#a3a3a3] hover:text-[#ef4444] transition-colors" aria-label={`Remover ${doc.filename}`}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="p-4 bg-white border-t border-[#e5e5e5] relative z-20">
        <form onSubmit={handleSubmit} className="flex items-end gap-2 bg-white border border-[#e5e5e5] rounded-lg p-1.5 focus-within:border-[#0a0a0a] transition-colors">
          <button type="button" onClick={toggleVoice} className={cn('p-2.5 rounded flex items-center justify-center shrink-0 transition-colors', voiceMode ? 'text-[#ef4444] bg-[#fef2f2]' : 'text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa]')} aria-label={voiceMode ? 'Detener voz' : 'Voz'}>
            {voiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.xml,.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.tiff,.tif,.bmp,.heic" onChange={handleFileSelect} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="p-2.5 rounded flex items-center justify-center shrink-0 transition-colors text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] disabled:opacity-50" aria-label="Subir documento">
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
            className="flex-1 bg-transparent border-none focus:ring-0 text-[#0a0a0a] text-sm resize-none py-2.5 px-2 outline-none min-h-[40px] max-h-[120px] placeholder:text-[#a3a3a3] disabled:opacity-50"
          />
          <button type="submit" disabled={!input.trim() || isTyping} className="p-2.5 rounded bg-[#0a0a0a] text-white shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#262626] transition-colors" aria-label="Enviar">
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-center text-xs text-[#a3a3a3] mt-3 font-[family-name:var(--font-geist-mono)]">
          {t.chat.disclaimer}
        </p>
      </div>
    </div>
  );
}

'use client';

/**
 * ChatSidebar — Barra lateral IZQUIERDA persistente, global en /workspace/*.
 *
 * "Mantener el Chat General como una barra lateral persistente (como un
 *  asistente que siempre está ahí)". — visión del documento.
 *
 * Responsabilidades:
 *   - Mini-chat siempre accesible, independiente del área/página activa.
 *   - Conversación persistida en localStorage bajo `utopia_conversations`
 *     (misma key que ChatWorkspace para continuidad cruzada).
 *   - Expandido ~320px · Collapsed ~56px (icon rail) — colapsable con hotkey `C`
 *     o botón dedicado.
 *   - SSE streaming contra `/api/chat` con el mismo patrón que ChatWorkspace.
 *   - En mobile (<md), se convierte en drawer (overlay) — colapsado por defecto.
 *
 * Decisiones clave:
 *   - NO reutiliza `ChatWorkspace.tsx` (chat full-screen) — ese componente
 *     sigue vivo e invocable desde páginas (p.ej. workspace/page.tsx). Aquí
 *     creamos una versión compacta y adaptada al sidebar.
 *   - NO toca `WorkspaceContext` — para no romper contratos con otros agentes.
 *     Estado local de collapse persiste en localStorage con key propia.
 *   - `useCase = 'general'` siempre — este es el Chat General transversal.
 *     Si el usuario quiere un caso específico, usa el panel central.
 *
 * Referencias:
 *   - Patrón SSE: ChatWorkspace.tsx líneas 1090-1195
 *   - Storage: src/lib/storage/conversation-history.ts
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  History,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  generateConversationId,
  listConversations,
  loadConversation,
  saveConversation,
  inferTitle,
  type Conversation,
  type ConversationMessage,
} from '@/lib/storage/conversation-history';
import { cn } from '@/lib/utils';
import { SkeletonText } from '@/components/ui/SkeletonText';

// ─── Constants ───────────────────────────────────────────────────────────────

const SIDEBAR_EXPANDED_WIDTH = 320;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const COLLAPSE_STORAGE_KEY = 'utopia.chatSidebar.collapsed';
const ACTIVE_CONV_STORAGE_KEY = 'utopia.chatSidebar.activeConvId';
const SPRING = { type: 'spring', stiffness: 400, damping: 30 } as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  error?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch { /* fallback */ }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function toConvMessages(msgs: ChatMessage[]): ConversationMessage[] {
  return msgs.map((m) => ({ id: m.id, role: m.role, content: m.content }));
}

function fromConvMessages(msgs: ConversationMessage[]): ChatMessage[] {
  return msgs
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      id: m.id || generateId(),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: '',
    }));
}

// ─── Date grouping for history ───────────────────────────────────────────────
// Groups conversations into buckets by their updatedAt timestamp so the
// history panel reads like modern chat apps (Hoy / Ayer / Esta semana / etc).

type DateBucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

interface GroupedConversations {
  bucket: DateBucket;
  label: string;
  items: Conversation[];
}

function bucketForDate(iso: string, now: Date): DateBucket {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'older';
  const diffMs = now.getTime() - d.getTime();
  const day = 86400000;
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - day);
  if (d >= startOfToday) return 'today';
  if (d >= startOfYesterday) return 'yesterday';
  if (diffMs < 7 * day) return 'thisWeek';
  if (diffMs < 30 * day) return 'thisMonth';
  return 'older';
}

function groupConversationsByDate(
  convos: Conversation[],
  language: 'es' | 'en',
): GroupedConversations[] {
  const now = new Date();
  const labels: Record<DateBucket, Record<'es' | 'en', string>> = {
    today:     { es: 'Hoy',          en: 'Today' },
    yesterday: { es: 'Ayer',         en: 'Yesterday' },
    thisWeek:  { es: 'Esta semana',  en: 'This week' },
    thisMonth: { es: 'Este mes',     en: 'This month' },
    older:     { es: 'Anterior',     en: 'Older' },
  };
  const order: DateBucket[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];
  const groups = new Map<DateBucket, Conversation[]>();
  for (const c of convos) {
    const b = bucketForDate(c.updatedAt || c.createdAt, now);
    const arr = groups.get(b);
    if (arr) arr.push(c); else groups.set(b, [c]);
  }
  const result: GroupedConversations[] = [];
  for (const b of order) {
    const items = groups.get(b);
    if (items && items.length > 0) {
      result.push({ bucket: b, label: labels[b][language], items });
    }
  }
  return result;
}

function initialWelcome(language: 'es' | 'en'): ChatMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content:
      language === 'es'
        ? 'Soy su asistente 1+1. Pregúnteme lo que necesite — contabilidad, impuestos, NIIF, estrategia. Estoy siempre aquí, a la izquierda.'
        : 'I am your 1+1 assistant. Ask me anything — accounting, tax, IFRS, strategy. I am always here on the left.',
    timestamp: new Date().toISOString(),
  };
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function CollapsedRail({
  onExpand,
  onNewChat,
  messageCount,
  language,
}: {
  onExpand: () => void;
  onNewChat: () => void;
  messageCount: number;
  language: 'es' | 'en';
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <button
        type="button"
        onClick={onExpand}
        className={cn(
          'w-10 h-10 rounded-md flex items-center justify-center',
          'text-gold-500 hover:bg-gold-500/10 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
        )}
        aria-label={language === 'es' ? 'Expandir asistente' : 'Expand assistant'}
        title={language === 'es' ? 'Expandir (C)' : 'Expand (C)'}
      >
        <Bot className="w-5 h-5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onNewChat}
        className={cn(
          'w-10 h-10 rounded-md flex items-center justify-center',
          'text-n-500 hover:text-n-900 hover:bg-gold-500/10 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
        )}
        aria-label={language === 'es' ? 'Nuevo chat' : 'New chat'}
        title={language === 'es' ? 'Nuevo chat' : 'New chat'}
      >
        <Plus className="w-4 h-4" />
      </button>
      {messageCount > 1 && (
        <span
          className="text-2xs font-mono text-n-500 mt-1"
          aria-label={`${messageCount} ${language === 'es' ? 'mensajes' : 'messages'}`}
        >
          {messageCount}
        </span>
      )}
      <div className="mt-auto flex flex-col items-center gap-1.5 opacity-60">
        <MessageSquare className="w-4 h-4 text-n-400" />
      </div>
    </div>
  );
}

function HistoryPanel({
  conversations,
  activeId,
  onSelect,
  onNew,
  searchQuery,
  onSearchChange,
  language,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  language: 'es' | 'en';
}) {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const groups = useMemo(
    () => groupConversationsByDate(filtered, language),
    [filtered, language],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gold-500/15 shrink-0 space-y-2">
        <button
          type="button"
          onClick={onNew}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md',
            'bg-gold-500/10 border border-gold-500/30',
            'text-n-900 text-xs font-medium uppercase tracking-wider',
            'hover:bg-gold-500/20 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          )}
        >
          <Plus className="w-3.5 h-3.5 text-gold-500" />
          {language === 'es' ? 'Nuevo chat' : 'New chat'}
        </button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-n-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={language === 'es' ? 'Buscar…' : 'Search…'}
            aria-label={language === 'es' ? 'Buscar conversaciones' : 'Search conversations'}
            className={cn(
              'w-full pl-8 pr-2 py-1.5 rounded-md text-xs',
              'bg-n-0/60 border border-gold-500/15',
              'text-n-900 placeholder-n-400',
              'focus:outline-none focus:border-gold-500/40',
            )}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-n-400 py-6 px-3">
            {language === 'es'
              ? searchQuery.trim()
                ? 'Sin resultados'
                : 'Aún no hay conversaciones.'
              : searchQuery.trim()
                ? 'No matches'
                : 'No conversations yet.'}
          </p>
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <section key={group.bucket} aria-label={group.label}>
                <h3 className="text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium px-4 py-2">
                  {group.label}
                </h3>
                <ul>
                  {group.items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        aria-current={activeId === c.id ? 'page' : undefined}
                        className={cn(
                          'w-full px-3 py-2 text-left flex items-start gap-2',
                          'hover:bg-gold-500/6 transition-colors',
                          activeId === c.id ? 'bg-gold-500/10' : '',
                        )}
                      >
                        <MessageSquare
                          className={cn(
                            'w-3.5 h-3.5 mt-0.5 shrink-0',
                            activeId === c.id ? 'text-gold-500' : 'text-n-500',
                          )}
                        />
                        <span className="flex-1 min-w-0">
                          <span
                            className={cn(
                              'block text-xs font-medium truncate',
                              activeId === c.id ? 'text-n-900' : 'text-n-800',
                            )}
                          >
                            {c.title || (language === 'es' ? 'Sin título' : 'Untitled')}
                          </span>
                          <span className="block text-2xs text-n-500 truncate mt-0.5 num">
                            {c.messages.length}{' '}
                            {language === 'es' ? 'mensajes' : 'messages'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots({ language }: { language: 'es' | 'en' }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <motion.span
        className="w-1.5 h-1.5 rounded-full bg-gold-500"
        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="w-1.5 h-1.5 rounded-full bg-gold-500"
        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.span
        className="w-1.5 h-1.5 rounded-full bg-gold-500"
        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
      />
      <span className="text-2xs text-n-500 uppercase tracking-wider ml-1">
        {language === 'es' ? 'Pensando…' : 'Thinking…'}
      </span>
    </div>
  );
}

function MessageBubble({ msg, language }: { msg: ChatMessage; language: 'es' | 'en' }) {
  const isUser = msg.role === 'user';
  const hasContent = msg.content.trim().length > 0;
  return (
    <div
      className={cn(
        'px-3 py-2',
        isUser ? 'bg-gold-500/6' : 'bg-transparent',
        'border-b border-gold-500/10',
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            'text-2xs font-medium uppercase tracking-wider',
            isUser ? 'text-gold-600' : 'text-n-700',
          )}
        >
          {isUser ? (language === 'es' ? 'Usted' : 'You') : '1+1'}
        </span>
        {msg.error && (
          <span className="text-2xs text-danger uppercase tracking-wider">
            · {language === 'es' ? 'error' : 'error'}
          </span>
        )}
      </div>
      <div
        className={cn(
          'text-sm leading-relaxed',
          isUser ? 'text-n-900' : 'text-n-800',
          msg.error ? 'text-danger' : '',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : hasContent ? (
          // Why: no tailwindcss/typography plugin is installed; we style
          // each markdown element explicitly via component overrides so
          // the dark theme reads correctly.
          <div className="chat-sidebar-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={{
                p: ({ children }) => (
                  <p className="leading-relaxed my-1.5 text-n-800">{children}</p>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-n-900">{children}</strong>
                ),
                em: ({ children }) => <em className="italic text-n-800">{children}</em>,
                ul: ({ children }) => (
                  <ul className="list-disc pl-4 space-y-0.5 my-1.5 text-n-800">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal pl-4 space-y-0.5 my-1.5 text-n-800">{children}</ol>
                ),
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-500 hover:text-gold-600 underline underline-offset-2"
                  >
                    {children}
                  </a>
                ),
                code: ({ className, children }) => {
                  const isBlock = className?.includes('language-');
                  if (isBlock) {
                    return (
                      <code className="block bg-n-50 border border-gold-500/15 rounded px-2 py-2 my-1.5 overflow-x-auto text-xs-mono text-gold-600 font-mono">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className="bg-n-0/70 text-gold-600 px-1 py-0.5 rounded text-xs-mono font-mono">
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-n-50 border border-gold-500/15 rounded px-2 py-2 my-1.5 overflow-x-auto text-xs-mono text-gold-600 font-mono">
                    {children}
                  </pre>
                ),
                h1: ({ children }) => (
                  <h3 className="text-sm font-semibold text-n-900 mt-2 mb-1">{children}</h3>
                ),
                h2: ({ children }) => (
                  <h4 className="text-xs font-semibold text-n-900 mt-1.5 mb-1">{children}</h4>
                ),
                h3: ({ children }) => (
                  <h5 className="text-xs font-medium text-n-900 mt-1.5 mb-0.5">{children}</h5>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-gold-500/30 pl-2 my-1.5 text-n-500 italic">
                    {children}
                  </blockquote>
                ),
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface ChatSidebarProps {
  className?: string;
}

export function ChatSidebar({ className }: ChatSidebarProps) {
  const { language } = useLanguage();
  const workspace = useWorkspace();
  const prefersReduced = useReducedMotion();
  const pathname = usePathname();

  const resolvedUseCase = useMemo(() => {
    if (pathname?.startsWith('/workspace/escudo')) return 'dian-defense' as const;
    if (pathname?.startsWith('/workspace/valor')) return 'financial-intelligence' as const;
    if (pathname?.startsWith('/workspace/verdad')) return 'due-diligence' as const;
    if (pathname?.startsWith('/workspace/futuro')) return 'feasibility-study' as const;
    return 'general' as const;
  }, [pathname]);

  const contextLabel = useMemo(() => {
    const map: Record<typeof resolvedUseCase, string> = {
      'dian-defense': 'Escudo',
      'financial-intelligence': 'Valor',
      'due-diligence': 'Verdad',
      'feasibility-study': 'Futuro',
      'general': language === 'es' ? 'General' : 'General',
    };
    return map[resolvedUseCase];
  }, [resolvedUseCase, language]);

  // ─── Collapse state (local, persisted) ─────────────────────────────────────
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
    } catch { return false; }
  });

  // Mobile auto-collapse
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const handle = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) setCollapsed(true);
    };
    handle(mql);
    mql.addEventListener('change', handle);
    return () => mql.removeEventListener('change', handle);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
    } catch { /* noop */ }
  }, [collapsed]);

  // Hotkey: `c` toggles collapse (while not typing in inputs)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;
      if (e.key === 'c' || e.key === 'C') {
        // Don't steal the C from legacy Sidebar which used d/r/u/i/n shortcuts
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Tab state: 'chat' | 'history' ─────────────────────────────────────────
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [searchQuery, setSearchQuery] = useState('');

  // ─── Conversation state ────────────────────────────────────────────────────
  const [conversationId, setConversationId] = useState<string>(() => {
    if (typeof window === 'undefined') return generateConversationId();
    try {
      const saved = window.localStorage.getItem(ACTIVE_CONV_STORAGE_KEY);
      if (saved) return saved;
    } catch { /* noop */ }
    return generateConversationId();
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return [initialWelcome('es')];
    try {
      const saved = window.localStorage.getItem(ACTIVE_CONV_STORAGE_KEY);
      if (saved) {
        const conv = loadConversation(saved);
        if (conv && Array.isArray(conv.messages) && conv.messages.length > 0) {
          return fromConvMessages(conv.messages);
        }
      }
    } catch { /* noop */ }
    return [initialWelcome('es')];
  });

  // Persist active conversation id
  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_CONV_STORAGE_KEY, conversationId);
    } catch { /* noop */ }
  }, [conversationId]);

  // Refresh welcome message when language changes (only if still default)
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === 'welcome') {
        return [initialWelcome(language)];
      }
      return prev;
    });
  }, [language]);

  // ─── Conversations list ────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationListVersion = workspace.conversationListVersion;
  useEffect(() => {
    setConversations(listConversations());
  }, [conversationListVersion, conversationId]);

  // ─── Streaming state ───────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const userAbortedRef = useRef(false);

  // Scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    if (!collapsed && tab === 'chat') scrollToBottom();
  }, [messages, collapsed, tab, scrollToBottom]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  }, [input]);

  // Abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ─── Seed bus: consume `pendingChatSeed` from area strips (E/F/G/H) ──────
  // Cuando una ventana de área envía un seed, lo colocamos en el input,
  // abrimos la sidebar (si estaba colapsada), activamos el tab chat, y
  // limpiamos el seed del contexto. Un solo consumer, cero buffering.
  const pendingChatSeed = workspace.pendingChatSeed;
  const setPendingChatSeed = workspace.setPendingChatSeed;
  useEffect(() => {
    if (!pendingChatSeed) return;
    setInput(pendingChatSeed);
    setCollapsed(false);
    setTab('chat');
    setPendingChatSeed(null);
    // Auto-focus textarea so el usuario solo necesita Enter para enviar
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        // Cursor al final — más friendly que seleccionar todo
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }, [pendingChatSeed, setPendingChatSeed]);

  // ─── Actions ───────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    // Cancel any in-flight stream
    abortRef.current?.abort();
    const newId = generateConversationId();
    setConversationId(newId);
    setMessages([initialWelcome(language)]);
    setInput('');
    setTab('chat');
    workspace.refreshConversationList();
  }, [language, workspace]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      const conv = loadConversation(id);
      if (!conv) return;
      setConversationId(id);
      const loaded = fromConvMessages(conv.messages);
      setMessages(loaded.length > 0 ? loaded : [initialWelcome(language)]);
      setTab('chat');
    },
    [language],
  );

  const handleStop = useCallback(() => {
    userAbortedRef.current = true;
    abortRef.current?.abort();
  }, []);

  // ─── SSE send (condensed from ChatWorkspace.tsx) ───────────────────────────
  const sendMessage = useCallback(
    async (history: ChatMessage[]) => {
      setIsStreaming(true);
      const streamId = generateId();
      setStreamingId(streamId);
      setMessages((prev) => [
        ...prev,
        { id: streamId, role: 'assistant', content: '', timestamp: new Date().toISOString() },
      ]);

      let streamed = '';
      const controller = new AbortController();
      abortRef.current = controller;
      userAbortedRef.current = false;

      try {
        let erpConnections: Array<{ provider: string; credentials: Record<string, string> }> = [];
        try {
          const raw = typeof window !== 'undefined' ? window.localStorage.getItem('utopia_erp_connections') : null;
          if (raw) {
            const decoded = JSON.parse(decodeURIComponent(atob(raw)));
            erpConnections = (Array.isArray(decoded) ? decoded : [])
              .filter((c: { provider?: string; credentials?: unknown }) => c && c.provider && c.credentials)
              .map((c: { provider: string; credentials: Record<string, string> }) => ({
                provider: c.provider,
                credentials: c.credentials,
              }));
          }
        } catch { erpConnections = []; }

        const payload = {
          messages: history.map((m) => ({ id: m.id, role: m.role, content: m.content })),
          language,
          useCase: resolvedUseCase,
          ...(erpConnections.length > 0 ? { erpConnections } : {}),
        };

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get('Content-Type') || '';
        let finalData: { content?: string } | null = null;

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
                const json = line.slice(6);
                try {
                  const data = JSON.parse(json);
                  if (currentEvent === 'content' && typeof data.delta === 'string') {
                    if (data.delta) {
                      streamed += data.delta;
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === streamId ? { ...m, content: streamed } : m,
                        ),
                      );
                    }
                  } else if (currentEvent === 'result') {
                    finalData = data;
                  } else if (currentEvent === 'error') {
                    throw new Error(data.error || 'Stream error');
                  }
                } catch (e) {
                  if (e instanceof SyntaxError) continue;
                  throw e;
                }
              }
            }
          }
        } else {
          finalData = await response.json();
        }

        const finalContent =
          (finalData && typeof finalData.content === 'string' && finalData.content) ||
          streamed ||
          '';

        if (!finalContent) throw new Error('No response data received');

        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === streamId ? { ...m, content: finalContent } : m,
          );
          // Persist to shared conversation store
          try {
            saveConversation({
              id: conversationId,
              title: inferTitle(updated.map((m) => ({ id: m.id, role: m.role, content: m.content }))),
              useCase: resolvedUseCase,
              messages: toConvMessages(updated),
              createdAt: updated[0]?.timestamp || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              riskLevel: 'bajo',
            });
            workspace.refreshConversationList();
          } catch { /* ignore persist errors */ }
          return updated;
        });
      } catch (err) {
        const aborted = userAbortedRef.current;
        if (aborted) {
          // User hit Stop — keep partial content
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId ? { ...m, content: streamed || m.content } : m,
            ),
          );
        } else {
          const msg =
            language === 'es'
              ? 'No pude completar la consulta. Verifique su conexión e intente de nuevo.'
              : 'Could not complete the query. Check your connection and try again.';
          // Replace the in-flight placeholder with an error message
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId
                ? { ...m, content: msg, error: true }
                : m,
            ),
          );
          // Log for debugging (not fatal)
          console.error('ChatSidebar SSE error:', err);
        }
      } finally {
        setIsStreaming(false);
        setStreamingId(null);
        abortRef.current = null;
        userAbortedRef.current = false;
      }
    },
    [conversationId, language, workspace],
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isStreaming) return;
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setInput('');
      void sendMessage(updated);
    },
    [input, isStreaming, messages, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // File upload — reuses /api/upload and injects document as assistant notice.
  // Kept minimal here; heavy OCR/analysis stays in ChatWorkspace for case-specific flows.
  const [isUploading, setIsUploading] = useState(false);
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('context', file.name);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content:
              language === 'es'
                ? `He procesado **"${file.name}"** (${data.chunks ?? 0} fragmentos). ¿Qué le gustaría saber sobre este documento?`
                : `I processed **"${file.name}"** (${data.chunks ?? 0} chunks). What would you like to know about this document?`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content:
              language === 'es'
                ? 'No pude procesar el archivo. Intente de nuevo.'
                : 'Could not process the file. Please try again.',
            timestamp: new Date().toISOString(),
            error: true,
          },
        ]);
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [language],
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  // Why: `window.innerWidth` is client-only. Guard with `typeof window` so SSR
  // (even if Next never server-renders this subtree in practice) doesn't
  // throw. On mobile we cap the drawer width to viewport - 32px padding.
  const viewportWidth =
    typeof window !== 'undefined' ? window.innerWidth : SIDEBAR_EXPANDED_WIDTH;
  const width = collapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : isMobile
      ? Math.min(viewportWidth - 32, SIDEBAR_EXPANDED_WIDTH)
      : SIDEBAR_EXPANDED_WIDTH;

  const isExpanded = !collapsed;

  const labels = {
    assistant: language === 'es' ? 'Asistente 1+1' : '1+1 Assistant',
    tagline: language === 'es' ? 'Siempre contigo' : 'Always with you',
    placeholder:
      language === 'es'
        ? 'Pregúnteme lo que necesite…'
        : 'Ask me anything…',
    collapse: language === 'es' ? 'Colapsar (C)' : 'Collapse (C)',
    send: language === 'es' ? 'Enviar' : 'Send',
    stop: language === 'es' ? 'Detener' : 'Stop',
    attach: language === 'es' ? 'Adjuntar archivo' : 'Attach file',
    new: language === 'es' ? 'Nuevo chat' : 'New chat',
    clear: language === 'es' ? 'Limpiar' : 'Clear',
    chatTab: language === 'es' ? 'Chat' : 'Chat',
    historyTab: language === 'es' ? 'Historial' : 'History',
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobile && !collapsed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setCollapsed(true)}
          aria-hidden="true"
        />
      )}

      <motion.aside
        id="chat-sidebar"
        aria-label={labels.assistant}
        initial={false}
        animate={{ width }}
        transition={prefersReduced ? { duration: 0 } : SPRING}
        className={cn(
          'relative shrink-0 h-[calc(100vh-64px)] sticky top-16 z-40',
          'glass-elite-elevated',
          'border-r border-gold-500/20',
          'flex flex-col overflow-hidden',
          isMobile && !collapsed ? 'fixed top-16 left-0 shadow-2xl' : '',
          className,
        )}
        style={{ width }}
      >
        {/* Collapsed rail */}
        {!isExpanded && (
          <CollapsedRail
            onExpand={() => setCollapsed(false)}
            onNewChat={handleNewChat}
            messageCount={messages.length}
            language={language}
          />
        )}

        {/* Expanded view */}
        {isExpanded && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 h-14 border-b border-gold-500/15 shrink-0">
              <span
                className={cn(
                  'inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0',
                  'bg-gradient-to-br from-gold-500 to-danger',
                )}
                aria-hidden="true"
              >
                <Bot className="w-4 h-4 text-n-0" strokeWidth={2.2} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-n-900 leading-tight truncate">
                  {labels.assistant}
                </p>
                <p className="text-2xs text-n-500 leading-tight truncate uppercase tracking-wider">
                  {labels.tagline}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className={cn(
                  'p-1.5 rounded-md text-n-500 hover:text-n-900',
                  'hover:bg-gold-500/10 transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                )}
                aria-label={labels.collapse}
                title={labels.collapse}
              >
                {isMobile ? <X className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            </div>

            {/* Tab bar */}
            <div
              role="tablist"
              aria-label={labels.assistant}
              className="flex border-b border-gold-500/15 shrink-0"
            >
              <button
                role="tab"
                type="button"
                aria-selected={tab === 'chat'}
                onClick={() => setTab('chat')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs-mono font-medium uppercase tracking-wider',
                  'transition-colors relative',
                  tab === 'chat'
                    ? 'text-n-900'
                    : 'text-n-500 hover:text-n-900',
                )}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {labels.chatTab}
                {tab === 'chat' && (
                  <motion.span
                    layoutId="chat-sidebar-tab-underline"
                    className="absolute bottom-0 left-2 right-2 h-[2px] bg-gold-500 rounded-full"
                    transition={prefersReduced ? { duration: 0 } : SPRING}
                  />
                )}
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={tab === 'history'}
                onClick={() => setTab('history')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs-mono font-medium uppercase tracking-wider',
                  'transition-colors relative',
                  tab === 'history'
                    ? 'text-n-900'
                    : 'text-n-500 hover:text-n-900',
                )}
              >
                <History className="w-3.5 h-3.5" />
                {labels.historyTab}
                {conversations.length > 0 && (
                  <span className="text-2xs bg-gold-500/15 text-gold-500 px-1 rounded">
                    {conversations.length}
                  </span>
                )}
                {tab === 'history' && (
                  <motion.span
                    layoutId="chat-sidebar-tab-underline"
                    className="absolute bottom-0 left-2 right-2 h-[2px] bg-gold-500 rounded-full"
                    transition={prefersReduced ? { duration: 0 } : SPRING}
                  />
                )}
              </button>
            </div>

            {/* Body */}
            {tab === 'history' ? (
              <HistoryPanel
                conversations={conversations}
                activeId={conversationId}
                onSelect={handleSelectConversation}
                onNew={handleNewChat}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                language={language}
              />
            ) : (
              <>
                {/* Actions strip */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gold-500/10 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs-mono shrink-0',
                        'text-n-500 hover:text-n-900 hover:bg-gold-500/6',
                        'transition-colors',
                      )}
                      title={labels.new}
                    >
                      <Plus className="w-3 h-3 text-gold-500" />
                      <span className="hidden sm:inline">{labels.new}</span>
                    </button>
                    <span
                      className="shrink-0 text-[10px] font-mono uppercase tracking-eyebrow text-n-500 px-2 py-0.5 rounded-full border border-gold-500/15 truncate"
                      aria-label={`Contexto ${contextLabel}`}
                      title={contextLabel}
                    >
                      {contextLabel}
                    </span>
                  </div>
                  {messages.length > 1 && (
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded text-xs-mono',
                        'text-n-400 hover:text-n-900 hover:bg-gold-500/6',
                        'transition-colors',
                      )}
                      title={labels.clear}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Messages */}
                <div
                  ref={scrollRef}
                  data-lenis-prevent
                  className="flex-1 min-h-0 overflow-y-auto styled-scrollbar"
                  style={{ overscrollBehavior: 'contain' }}
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions"
                >
                  {messages.map((m) => (
                    <MessageBubble key={m.id} msg={m} language={language} />
                  ))}
                  <AnimatePresence>
                    {isStreaming && streamingId && messages.find((m) => m.id === streamingId)?.content.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col gap-2"
                      >
                        <TypingDots language={language} />
                        {/* Skeleton body hint while the SSE pipeline is still handshaking. */}
                        <div className="mr-auto max-w-[80%] rounded-2xl rounded-tl-sm border border-gold-500/15 bg-n-50/60 px-3 py-2">
                          <SkeletonText lines={2} size="sm" />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Composer */}
                <form
                  onSubmit={handleSubmit}
                  className={cn(
                    'p-3 border-t border-gold-500/15 shrink-0',
                    'bg-n-0/50',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-end gap-1.5 rounded-lg p-1',
                      'bg-n-50/90 border border-gold-500/20',
                      'focus-within:border-gold-500/45 transition-colors',
                    )}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.csv,.json,.xml,.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading || isStreaming}
                      className={cn(
                        'p-1.5 rounded text-n-500 hover:text-gold-500 shrink-0',
                        'hover:bg-gold-500/6 transition-colors',
                        'disabled:opacity-40 disabled:cursor-not-allowed',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                      )}
                      aria-label={labels.attach}
                      title={labels.attach}
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={labels.placeholder}
                      disabled={isStreaming}
                      aria-label={labels.placeholder}
                      className={cn(
                        'flex-1 bg-transparent border-none focus:ring-0 outline-none',
                        'text-xs text-n-900 placeholder:text-n-400',
                        'resize-none py-2 px-1 max-h-[100px] min-h-[36px] leading-relaxed',
                        'disabled:opacity-50',
                      )}
                    />
                    {isStreaming ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        className={cn(
                          'p-1.5 rounded bg-gold-500 text-n-0 shrink-0',
                          'hover:bg-gold-600 transition-colors',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
                        )}
                        aria-label={labels.stop}
                        title={labels.stop}
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!input.trim()}
                        className={cn(
                          'p-1.5 rounded shrink-0 transition-colors',
                          'bg-gold-500 text-n-0',
                          'hover:bg-gold-600',
                          'disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-gold-500/20 disabled:text-n-400',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
                        )}
                        aria-label={labels.send}
                        title={labels.send}
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </motion.aside>

      {/* Mobile expand trigger — floats above content when collapsed on mobile */}
      {isMobile && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className={cn(
            'fixed bottom-4 left-4 z-40 w-12 h-12 rounded-full',
            'flex items-center justify-center',
            'bg-gradient-to-br from-gold-500 to-danger text-n-0',
            'shadow-lg glow-gold-soft',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
          )}
          aria-label={language === 'es' ? 'Abrir asistente' : 'Open assistant'}
        >
          <Bot className="w-5 h-5" strokeWidth={2.2} />
        </button>
      )}
    </>
  );
}

export default ChatSidebar;

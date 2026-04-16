'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Search,
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Calculator,
  Globe,
  DollarSign,
  ClipboardCheck,
  GitCompareArrows,
  Lightbulb,
  Settings,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  listConversations,
  type Conversation,
  type RiskLevel,
} from '@/lib/storage/conversation-history';
import type { CaseType } from '@/types/platform';

// ─── Constants ───────────────────────────────────────────────────────────────

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const RISK_DOT_COLORS: Record<RiskLevel, string> = {
  bajo: '#22c55e',
  medio: '#eab308',
  alto: '#f97316',
  critico: '#ef4444',
};

interface CaseTypeItem {
  key: CaseType;
  icon: React.ComponentType<{ className?: string }>;
  label: Record<string, string>;
  shortcut: string;
  elite?: boolean;
}

const CASE_TYPE_ITEMS: CaseTypeItem[] = [
  {
    key: 'dian_defense',
    icon: Shield,
    label: { es: 'Defensa DIAN', en: 'DIAN Defense' },
    shortcut: 'D',
  },
  {
    key: 'tax_refund',
    icon: TrendingUp,
    label: { es: 'Devoluciones', en: 'Tax Refunds' },
    shortcut: 'R',
  },
  {
    key: 'due_diligence',
    icon: FileSearch,
    label: { es: 'Due Diligence', en: 'Due Diligence' },
    shortcut: 'U',
  },
  {
    key: 'financial_intel',
    icon: BarChart3,
    label: { es: 'Inteligencia Fin.', en: 'Financial Intel.' },
    shortcut: 'I',
  },
  {
    key: 'tax_planning',
    icon: Calculator,
    label: { es: 'Planeación Tributaria', en: 'Tax Planning' },
    shortcut: 'P',
  },
  {
    key: 'transfer_pricing',
    icon: Globe,
    label: { es: 'Precios Transferencia', en: 'Transfer Pricing' },
    shortcut: 'T',
  },
  {
    key: 'business_valuation',
    icon: DollarSign,
    label: { es: 'Valoración Empresarial', en: 'Business Valuation' },
    shortcut: 'V',
  },
  {
    key: 'fiscal_audit_opinion',
    icon: ClipboardCheck,
    label: { es: 'Dictamen Rev. Fiscal', en: 'Fiscal Audit Opinion' },
    shortcut: 'F',
  },
  {
    key: 'tax_reconciliation',
    icon: GitCompareArrows,
    label: { es: 'Conciliación Fiscal', en: 'Tax Reconciliation' },
    shortcut: 'C',
  },
  {
    key: 'feasibility_study',
    icon: Lightbulb,
    label: { es: 'Estudio Factibilidad', en: 'Feasibility Study' },
    shortcut: 'E',
  },
];

const ELITE_ITEM: CaseTypeItem = {
  key: 'niif_report',
  icon: Sparkles,
  label: { es: 'Reporte NIIF Elite', en: 'NIIF Elite Report' },
  shortcut: 'N',
  elite: true,
};

const USE_CASE_LABELS: Record<string, Record<string, string>> = {
  es: {
    'general': 'General',
    'dian-defense': 'DIAN',
    'tax-refund': 'Devoluciones',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Inteligencia',
    'financial-report': 'NIIF',
    'tax-planning': 'Plan. Tributaria',
    'transfer-pricing': 'Precios Transfer.',
    'business-valuation': 'Valoración',
    'fiscal-audit-opinion': 'Revisoría',
    'tax-reconciliation': 'Conciliación',
    'feasibility-study': 'Factibilidad',
  },
  en: {
    'general': 'General',
    'dian-defense': 'DIAN',
    'tax-refund': 'Refunds',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Intelligence',
    'financial-report': 'NIIF',
    'tax-planning': 'Tax Plan.',
    'transfer-pricing': 'Transfer Pr.',
    'business-valuation': 'Valuation',
    'fiscal-audit-opinion': 'Fiscal Audit',
    'tax-reconciliation': 'Reconciliation',
    'feasibility-study': 'Feasibility',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByDate(
  conversations: Conversation[],
  language: string,
): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const today: Conversation[] = [];
  const thisWeek: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conv of conversations) {
    const d = new Date(conv.updatedAt);
    if (d >= todayStart) {
      today.push(conv);
    } else if (d >= weekStart) {
      thisWeek.push(conv);
    } else {
      older.push(conv);
    }
  }

  const groups: { label: string; items: Conversation[] }[] = [];
  if (today.length > 0) {
    groups.push({
      label: language === 'es' ? 'Hoy' : 'Today',
      items: today,
    });
  }
  if (thisWeek.length > 0) {
    groups.push({
      label: language === 'es' ? 'Esta Semana' : 'This Week',
      items: thisWeek,
    });
  }
  if (older.length > 0) {
    groups.push({
      label: language === 'es' ? 'Anteriores' : 'Earlier',
      items: older,
    });
  }
  return groups;
}

function formatRelativeTime(dateStr: string, language: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return language === 'es' ? 'ahora' : 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return language === 'es' ? 'ayer' : 'yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Sidebar() {
  const { language, t } = useLanguage();
  const {
    sidebarOpen,
    toggleSidebar,
    activeCase,
    setActiveCase,
    conversationListVersion,
    activeCaseType,
    setIntakeModalOpen,
    openIntakeForType,
    startNewConsultation,
    setActiveCaseType,
  } = useWorkspace();

  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setConversations(listConversations());
  }, [conversationListVersion]);

  // Refresh conversation list periodically while a conversation is active
  useEffect(() => {
    if (!activeCase) return;
    const interval = setInterval(() => {
      setConversations(listConversations());
    }, 3000);
    return () => clearInterval(interval);
  }, [activeCase]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const groupedConversations = useMemo(
    () => groupByDate(filteredConversations, language),
    [filteredConversations, language],
  );

  // Keyboard shortcuts for case types
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const shortcutMap: Record<string, CaseType> = {
        d: 'dian_defense',
        r: 'tax_refund',
        u: 'due_diligence',
        i: 'financial_intel',
        n: 'niif_report',
      };
      const ct = shortcutMap[e.key.toLowerCase()];
      if (ct) {
        e.preventDefault();
        openIntakeForType(ct);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openIntakeForType]);

  const handleNewConsultation = useCallback(() => {
    setIntakeModalOpen(true);
  }, [setIntakeModalOpen]);

  const wt = t.workspace;
  const isExpanded = sidebarOpen;

  return (
    <motion.aside
      id="workspace-sidebar"
      initial={false}
      animate={{ width: isExpanded ? 272 : 48 }}
      transition={{ type: 'spring', ...NOVA_SPRING }}
      className={cn(
        'h-full flex flex-col border-r border-[#e5e5e5] bg-white shrink-0 overflow-hidden',
        'relative z-[var(--z-glass)]',
      )}
      aria-label={language === 'es' ? 'Navegador de casos' : 'Case navigator'}
    >
      {/* ── Section 1: Brand Header ─────────────────────────────────────────── */}
      <div className="shrink-0">
        {/* Wordmark */}
        <div className="h-12 border-b border-[#e5e5e5] flex items-center px-3 shrink-0">
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <motion.div
                key="full-logo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="flex items-center gap-2"
              >
                <img
                  src="/logo-modern.png"
                  alt="UtopIA Logo"
                  className="w-6 h-6 rounded-sm object-cover invert hue-rotate-180 shrink-0"
                />
                <span className="text-sm font-bold tracking-tight text-[#0a0a0a]">
                  UtopIA.
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="dot-logo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="w-full flex items-center justify-center p-1"
              >
                <img
                  src="/logo-modern.png"
                  alt="UtopIA Logo"
                  className="w-6 h-6 rounded-sm object-cover invert hue-rotate-180"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nueva Consulta button */}
        <div className="px-2 pt-3 pb-2">
          <button
            type="button"
            onClick={handleNewConsultation}
            className={cn(
              'w-full flex items-center gap-2 rounded-sm text-sm font-medium transition-colors',
              'bg-[#D4A017] hover:bg-[#b8901a] text-white',
              isExpanded ? 'px-3 py-2 justify-start' : 'p-2 justify-center',
            )}
            aria-label={
              language === 'es' ? 'Nueva Consulta' : 'New Consultation'
            }
            title={
              !isExpanded
                ? language === 'es'
                  ? 'Nueva Consulta'
                  : 'New Consultation'
                : undefined
            }
          >
            <Plus className="w-4 h-4 shrink-0" />
            {isExpanded && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.05 }}
                className="truncate"
              >
                {language === 'es' ? 'Nueva Consulta' : 'New Consultation'}
              </motion.span>
            )}
          </button>

          {/* Chat General — skip intake, go straight to chat */}
          <button
            type="button"
            onClick={() => {
              setActiveCaseType('general_chat');
              startNewConsultation('general');
            }}
            className={cn(
              'w-full flex items-center gap-2 rounded-sm text-sm font-medium transition-colors mt-1.5',
              activeCaseType === 'general_chat'
                ? 'bg-[#0a0a0a] text-white'
                : 'bg-[#fafafa] border border-[#e5e5e5] text-[#525252] hover:bg-[#f5f5f5]',
              isExpanded ? 'px-3 py-2 justify-start' : 'p-2 justify-center',
            )}
            aria-label="Chat General"
            aria-current={activeCaseType === 'general_chat' ? 'page' : undefined}
            title={!isExpanded ? 'Chat General' : undefined}
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            {isExpanded && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.05 }}
                className="truncate"
              >
                Chat General
              </motion.span>
            )}
          </button>
        </div>
      </div>

      {/* ── Section 2: Case Type Selector ───────────────────────────────────── */}
      <div className="px-2 pb-2 shrink-0">
        <nav aria-label={language === 'es' ? 'Tipos de caso' : 'Case types'}>
          <ul className="flex flex-col gap-0.5">
            {CASE_TYPE_ITEMS.map((item) => {
              const isActive = activeCaseType === item.key;
              const Icon = item.icon;
              const label = item.label[language] || item.label.es;

              const fullLabel =
                item.key === 'financial_intel'
                  ? language === 'es'
                    ? 'Inteligencia Financiera'
                    : 'Financial Intelligence'
                  : label;

              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => openIntakeForType(item.key)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-sm text-[13px] transition-colors relative',
                      isExpanded ? 'px-3 py-1.5' : 'p-2 justify-center',
                      isActive
                        ? 'bg-[#FEF9EC] border-l-2 border-l-[#D4A017]'
                        : 'hover:bg-[#fafafa] border-l-2 border-l-transparent',
                    )}
                    aria-label={fullLabel}
                    aria-current={isActive ? 'page' : undefined}
                    title={
                      item.key === 'financial_intel'
                        ? fullLabel
                        : !isExpanded
                          ? label
                          : undefined
                    }
                  >
                    <Icon
                      className={cn(
                        'w-4 h-4 shrink-0',
                        isActive ? 'text-[#D4A017]' : 'text-[#525252]',
                      )}
                    />
                    {isExpanded && (
                      <>
                        <span
                          className={cn(
                            'flex-1 text-left truncate',
                            isActive
                              ? 'text-[#0a0a0a] font-medium'
                              : 'text-[#525252]',
                          )}
                        >
                          {label}
                        </span>
                        <kbd
                          aria-hidden="true"
                          className={cn(
                            'text-[10px] font-[family-name:var(--font-geist-mono)] px-1.5 py-0.5 rounded',
                            'bg-[#f5f5f5] text-[#a3a3a3] border border-[#e5e5e5]',
                          )}
                        >
                          {item.shortcut}
                        </kbd>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Separator */}
          <div className="h-px bg-[#e5e5e5] mx-1 my-1.5" />

          {/* NIIF Elite item */}
          {(() => {
            const isActive = activeCaseType === ELITE_ITEM.key;
            const Icon = ELITE_ITEM.icon;
            const label =
              ELITE_ITEM.label[language] || ELITE_ITEM.label.es;

            return (
              <button
                type="button"
                onClick={() => openIntakeForType(ELITE_ITEM.key)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-sm text-[13px] transition-colors relative',
                  isExpanded ? 'px-3 py-1.5' : 'p-2 justify-center',
                  isActive
                    ? 'bg-[#FEF9EC] border-l-2 border-l-[#D4A017]'
                    : 'bg-gradient-to-r from-[#FEF9EC] to-[#FDF0C4]/30 hover:from-[#FDF0C4]/50 hover:to-[#FDF0C4]/40 border-l-2 border-l-transparent',
                )}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                title={!isExpanded ? label : undefined}
              >
                <Icon
                  className={cn(
                    'w-4 h-4 shrink-0',
                    isActive ? 'text-[#D4A017]' : 'text-[#b8901a]',
                  )}
                />
                {isExpanded && (
                  <>
                    <span
                      className={cn(
                        'flex-1 text-left truncate',
                        isActive
                          ? 'text-[#0a0a0a] font-medium'
                          : 'text-[#525252]',
                      )}
                    >
                      {label}
                    </span>
                    <span className="text-[9px] font-semibold tracking-wider text-[#D4A017] bg-[#D4A017]/10 px-1.5 py-0.5 rounded">
                      ELITE
                    </span>
                    <kbd
                      aria-hidden="true"
                      className={cn(
                        'text-[10px] font-[family-name:var(--font-geist-mono)] px-1.5 py-0.5 rounded',
                        'bg-[#f5f5f5] text-[#a3a3a3] border border-[#e5e5e5]',
                      )}
                    >
                      {ELITE_ITEM.shortcut}
                    </kbd>
                  </>
                )}
              </button>
            );
          })()}
        </nav>
      </div>

      {/* Divider */}
      <div className="h-px bg-[#e5e5e5] mx-2 shrink-0" />

      {/* ── Section 3: Case List ─────────────────────────────────────────────── */}

      {/* Search */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="px-2 pt-2 pb-1 shrink-0"
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#a3a3a3]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                language === 'es' ? 'Buscar casos...' : 'Search cases...'
              }
              aria-label={language === 'es' ? 'Buscar casos' : 'Search cases'}
              className="w-full bg-[#fafafa] border border-[#e5e5e5] rounded-sm pl-8 pr-3 py-1.5 text-xs text-[#0a0a0a] placeholder:text-[#a3a3a3] outline-none focus:border-[#0a0a0a] transition-colors"
            />
          </div>
        </motion.div>
      )}

      {/* Grouped case list */}
      <div className="flex-1 overflow-y-auto styled-scrollbar px-1 py-1">
        {groupedConversations.length === 0 ? (
          <div className="px-2 py-8 text-center">
            {isExpanded ? (
              <div className="flex flex-col items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#d4d4d4]" />
                <p className="text-xs text-[#a3a3a3]">{wt.noCases}</p>
              </div>
            ) : (
              <MessageSquare
                className="w-4 h-4 text-[#d4d4d4] mx-auto"
                aria-label={wt.noCases}
              />
            )}
          </div>
        ) : (
          groupedConversations.map((group) => (
            <div key={group.label} className="mb-2">
              {isExpanded && (
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#a3a3a3]">
                  {group.label}
                </p>
              )}
              <AnimatePresence>
                {group.items.map((conv, i) => {
                  const isActiveCaseItem = activeCase === conv.id;
                  const useCaseLabel =
                    USE_CASE_LABELS[language]?.[conv.useCase] ??
                    conv.useCase;

                  return (
                    <motion.button
                      key={conv.id}
                      type="button"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{
                        type: 'spring',
                        ...NOVA_SPRING,
                        delay: i * 0.02,
                      }}
                      onClick={() => setActiveCase(conv.id)}
                      className={cn(
                        'w-full flex items-center gap-2 rounded-sm transition-all mb-0.5',
                        isExpanded
                          ? 'px-2.5 py-2 text-left'
                          : 'p-2 justify-center',
                        isActiveCaseItem
                          ? 'bg-white shadow-sm border-l-2 border-l-[#D4A017] border border-[#e5e5e5]'
                          : 'hover:bg-[#fafafa] border-l-2 border-l-transparent border border-transparent',
                      )}
                      aria-current={isActiveCaseItem ? 'page' : undefined}
                      title={conv.title}
                    >
                      {isExpanded ? (
                        <>
                          {/* Risk dot */}
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                            style={{
                              backgroundColor:
                                RISK_DOT_COLORS[conv.riskLevel],
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[#0a0a0a] truncate leading-tight">
                              {conv.title}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                                {formatRelativeTime(
                                  conv.updatedAt,
                                  language,
                                )}
                              </span>
                              <span className="text-[9px] text-[#a3a3a3] bg-[#f5f5f5] px-1.5 py-0.5 rounded truncate">
                                {useCaseLabel}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div
                          className="relative"
                          title={conv.title}
                        >
                          <MessageSquare className="w-4 h-4 text-[#525252]" />
                          <div
                            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                RISK_DOT_COLORS[conv.riskLevel],
                            }}
                          />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* ── Section 4: Bottom ────────────────────────────────────────────────── */}
      <div className="border-t border-[#e5e5e5] p-2 shrink-0 space-y-0.5">
        <button
          type="button"
          onClick={() => router.push('/workspace/settings')}
          className={cn(
            'w-full flex items-center gap-2 rounded-sm text-xs text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors',
            isExpanded ? 'px-2.5 py-2 justify-start' : 'p-2 justify-center',
          )}
          aria-label={language === 'es' ? 'Configuración' : 'Settings'}
          title={!isExpanded ? (language === 'es' ? 'Configuración' : 'Settings') : undefined}
        >
          {isExpanded ? (
            <>
              <Settings className="w-4 h-4 shrink-0" />
              <span>{language === 'es' ? 'Configuración' : 'Settings'}</span>
            </>
          ) : (
            <Settings className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            'w-full flex items-center gap-2 rounded-sm text-xs text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors',
            isExpanded ? 'px-2.5 py-2 justify-start' : 'p-2 justify-center',
          )}
          aria-label={isExpanded ? wt.collapse : wt.expand}
          title={!isExpanded ? wt.expand : undefined}
        >
          {isExpanded ? (
            <>
              <PanelLeftClose className="w-4 h-4 shrink-0" />
              <span>{wt.collapse}</span>
            </>
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </button>
      </div>
    </motion.aside>
  );
}

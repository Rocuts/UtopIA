'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Search,
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  listConversations,
  type Conversation,
  type RiskLevel,
} from '@/lib/storage/conversation-history';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const RISK_DOT_COLORS: Record<RiskLevel, string> = {
  bajo: '#22c55e',
  medio: '#eab308',
  alto: '#f97316',
  critico: '#ef4444',
};

const USE_CASE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'dian-defense': Shield,
  'tax-refund': TrendingUp,
  'due-diligence': FileSearch,
  'financial-intelligence': BarChart3,
};

const USE_CASE_LABELS: Record<string, Record<string, string>> = {
  es: {
    'dian-defense': 'Defensa DIAN',
    'tax-refund': 'Devoluciones',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Inteligencia',
  },
  en: {
    'dian-defense': 'DIAN Defense',
    'tax-refund': 'Tax Refund',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Intelligence',
  },
};

export function Sidebar() {
  const { language, t } = useLanguage();
  const { sidebarOpen, toggleSidebar, activeCase, setActiveCase } = useWorkspace();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterUseCase, setFilterUseCase] = useState<string | null>(null);

  useEffect(() => {
    setConversations(listConversations());
  }, []);

  const filteredConversations = useMemo(() => {
    let result = conversations;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.title.toLowerCase().includes(q));
    }
    if (filterUseCase) {
      result = result.filter(c => c.useCase === filterUseCase);
    }
    return result;
  }, [conversations, searchQuery, filterUseCase]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString(language === 'es' ? 'es-CO' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    if (diffDays === 1) return language === 'es' ? 'Ayer' : 'Yesterday';
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const useCaseKeys = ['dian-defense', 'tax-refund', 'due-diligence', 'financial-intelligence'];
  const wt = t.workspace;

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarOpen ? 260 : 48 }}
      transition={{ type: 'spring', ...NOVA_SPRING }}
      className={cn(
        'h-full flex flex-col border-r border-[#e5e5e5] bg-white shrink-0 overflow-hidden',
        'relative z-[var(--z-glass)]'
      )}
      aria-label={language === 'es' ? 'Barra lateral de navegacion' : 'Navigation sidebar'}
    >
      {/* Logo area */}
      <div className="h-12 border-b border-[#e5e5e5] flex items-center px-3 shrink-0">
        <AnimatePresence mode="wait">
          {sidebarOpen ? (
            <motion.div
              key="full-logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="flex items-center gap-2"
            >
              <div className="w-2 h-2 rounded-full bg-[#0a0a0a] shrink-0" />
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
              className="w-full flex items-center justify-center"
            >
              <div className="w-2 h-2 rounded-full bg-[#0a0a0a]" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* New Consultation Button */}
      <div className="px-2 pt-3 pb-2 shrink-0">
        <button
          onClick={() => setActiveCase(null)}
          className={cn(
            'w-full flex items-center gap-2 rounded-sm text-sm font-medium transition-colors',
            'bg-[#d4a017] hover:bg-[#b8901a] text-white',
            sidebarOpen ? 'px-3 py-2 justify-start' : 'p-2 justify-center'
          )}
          aria-label={wt.newConsultation}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {sidebarOpen && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="truncate"
            >
              {wt.newConsultation}
            </motion.span>
          )}
        </button>
      </div>

      {/* Search */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="px-2 pb-2 shrink-0"
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#a3a3a3]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={wt.searchCases}
              className="w-full bg-[#fafafa] border border-[#e5e5e5] rounded-sm pl-8 pr-3 py-1.5 text-xs text-[#0a0a0a] placeholder:text-[#a3a3a3] outline-none focus:border-[#0a0a0a] transition-colors"
            />
          </div>
        </motion.div>
      )}

      {/* Use Case Filters */}
      <div className={cn('px-2 pb-2 shrink-0', sidebarOpen ? 'flex flex-wrap gap-1' : 'flex flex-col items-center gap-1')}>
        {useCaseKeys.map(uc => {
          const Icon = USE_CASE_ICONS[uc];
          const isActive = filterUseCase === uc;
          return (
            <button
              key={uc}
              onClick={() => setFilterUseCase(isActive ? null : uc)}
              className={cn(
                'flex items-center gap-1.5 rounded-sm text-[10px] font-medium transition-colors',
                sidebarOpen ? 'px-2 py-1' : 'p-2',
                isActive
                  ? 'bg-[#0a0a0a] text-white'
                  : 'text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa]'
              )}
              title={USE_CASE_LABELS[language]?.[uc] ?? uc}
              aria-pressed={isActive}
              aria-label={USE_CASE_LABELS[language]?.[uc] ?? uc}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {sidebarOpen && (
                <span className="truncate">{USE_CASE_LABELS[language]?.[uc] ?? uc}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-px bg-[#e5e5e5] mx-2 shrink-0" />

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto styled-scrollbar px-1 py-2">
        {filteredConversations.length === 0 ? (
          <div className="px-2 py-8 text-center">
            {sidebarOpen ? (
              <div className="flex flex-col items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#d4d4d4]" />
                <p className="text-xs text-[#a3a3a3]">{wt.noCases}</p>
              </div>
            ) : (
              <MessageSquare className="w-4 h-4 text-[#d4d4d4] mx-auto" />
            )}
          </div>
        ) : (
          <AnimatePresence>
            {filteredConversations.map((conv, i) => {
              const Icon = USE_CASE_ICONS[conv.useCase] ?? MessageSquare;
              const isActive = activeCase === conv.id;

              return (
                <motion.button
                  key={conv.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ type: 'spring', ...NOVA_SPRING, delay: i * 0.02 }}
                  onClick={() => setActiveCase(conv.id)}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-sm transition-colors mb-0.5',
                    sidebarOpen ? 'px-2.5 py-2 text-left' : 'p-2 justify-center',
                    isActive
                      ? 'bg-[#fafafa] border border-[#e5e5e5]'
                      : 'hover:bg-[#fafafa] border border-transparent'
                  )}
                  aria-current={isActive ? 'true' : undefined}
                  title={conv.title}
                >
                  {sidebarOpen ? (
                    <>
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: RISK_DOT_COLORS[conv.riskLevel] }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#0a0a0a] truncate">
                          {conv.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Icon className="w-3 h-3 text-[#a3a3a3]" />
                          <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                            {formatDate(conv.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="relative">
                      <Icon className="w-4 h-4 text-[#525252]" />
                      <div
                        className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: RISK_DOT_COLORS[conv.riskLevel] }}
                      />
                    </div>
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Collapse Toggle */}
      <div className="border-t border-[#e5e5e5] p-2 shrink-0">
        <button
          onClick={toggleSidebar}
          className={cn(
            'w-full flex items-center gap-2 rounded-sm text-xs text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors',
            sidebarOpen ? 'px-2.5 py-2 justify-start' : 'p-2 justify-center'
          )}
          aria-label={sidebarOpen ? wt.collapse : wt.expand}
        >
          {sidebarOpen ? (
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

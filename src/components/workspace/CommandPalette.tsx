'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  MessageSquarePlus,
  FileDown,
  Trash2,
  Mic,
  Shield,
  Receipt,
  Scale,
  Brain,
  Clock,
  Command,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listConversations, type Conversation } from '@/lib/storage/conversation-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'es' | 'en';
  onAction?: (actionId: string) => void;
}

interface CommandItem {
  id: string;
  icon: typeof Search;
  title: string;
  subtitle?: string;
  shortcut?: string;
  section: 'actions' | 'usecases' | 'recent';
}

// ---------------------------------------------------------------------------
// i18n labels
// ---------------------------------------------------------------------------

const LABELS = {
  es: {
    placeholder: 'Buscar comandos, casos de uso...',
    actions: 'Acciones rápidas',
    usecases: 'Casos de uso',
    recent: 'Casos recientes',
    noResults: 'Sin resultados',
    newConsultation: 'Nueva consulta',
    newConsultationSub: 'Iniciar una conversación nueva',
    exportPdf: 'Exportar PDF',
    exportPdfSub: 'Descargar el análisis actual',
    clearChat: 'Limpiar chat',
    clearChatSub: 'Borrar la conversación actual',
    toggleVoice: 'Activar voz',
    toggleVoiceSub: 'Entrada por micrófono',
    dianDefense: 'Defensa DIAN',
    dianDefenseSub: 'Requerimientos y recursos tributarios',
    taxRefund: 'Devolución de impuestos',
    taxRefundSub: 'Solicitudes de saldo a favor',
    dueDiligence: 'Due Diligence',
    dueDiligenceSub: 'Revisión de cumplimiento fiscal',
    financialIntel: 'Inteligencia financiera',
    financialIntelSub: 'Análisis de riesgos SAGRILAFT',
  },
  en: {
    placeholder: 'Search commands, use cases...',
    actions: 'Quick actions',
    usecases: 'Use cases',
    recent: 'Recent cases',
    noResults: 'No results',
    newConsultation: 'New consultation',
    newConsultationSub: 'Start a new conversation',
    exportPdf: 'Export PDF',
    exportPdfSub: 'Download the current analysis',
    clearChat: 'Clear chat',
    clearChatSub: 'Clear the current conversation',
    toggleVoice: 'Toggle voice',
    toggleVoiceSub: 'Microphone input',
    dianDefense: 'DIAN Defense',
    dianDefenseSub: 'Tax requirements and appeals',
    taxRefund: 'Tax refund',
    taxRefundSub: 'Credit balance requests',
    dueDiligence: 'Due Diligence',
    dueDiligenceSub: 'Tax compliance review',
    financialIntel: 'Financial Intelligence',
    financialIntelSub: 'SAGRILAFT risk analysis',
  },
} as const;

// ---------------------------------------------------------------------------
// Fuzzy match helper
// ---------------------------------------------------------------------------

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette({ isOpen, onClose, language, onAction }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = LABELS[language];

  // Build static items -------------------------------------------------------

  const staticItems = useMemo<CommandItem[]>(() => [
    // Quick Actions
    { id: 'new-consultation', icon: MessageSquarePlus, title: t.newConsultation, subtitle: t.newConsultationSub, shortcut: 'N', section: 'actions' },
    { id: 'export-pdf',       icon: FileDown,          title: t.exportPdf,       subtitle: t.exportPdfSub,       shortcut: 'E', section: 'actions' },
    { id: 'clear-chat',       icon: Trash2,            title: t.clearChat,       subtitle: t.clearChatSub,       shortcut: 'D', section: 'actions' },
    { id: 'toggle-voice',     icon: Mic,               title: t.toggleVoice,     subtitle: t.toggleVoiceSub,     shortcut: 'V', section: 'actions' },
    // Use Cases
    { id: 'dian-defense',     icon: Shield,  title: t.dianDefense,   subtitle: t.dianDefenseSub,   section: 'usecases' },
    { id: 'tax-refund',       icon: Receipt, title: t.taxRefund,     subtitle: t.taxRefundSub,     section: 'usecases' },
    { id: 'due-diligence',    icon: Scale,   title: t.dueDiligence,  subtitle: t.dueDiligenceSub,  section: 'usecases' },
    { id: 'financial-intel',  icon: Brain,   title: t.financialIntel, subtitle: t.financialIntelSub, section: 'usecases' },
  ], [t]);

  // Load recent conversations ------------------------------------------------

  const [recentItems, setRecentItems] = useState<CommandItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const conversations = listConversations().slice(0, 5);
    setRecentItems(
      conversations.map((c: Conversation) => ({
        id: `recent-${c.id}`,
        icon: Clock,
        title: c.title,
        subtitle: c.useCase,
        section: 'recent' as const,
      }))
    );
  }, [isOpen]);

  // Filtered items ------------------------------------------------------------

  const allItems = useMemo(() => [...staticItems, ...recentItems], [staticItems, recentItems]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    return allItems.filter(
      (item) =>
        fuzzyMatch(query, item.title) ||
        (item.subtitle && fuzzyMatch(query, item.subtitle))
    );
  }, [query, allItems]);

  // Group by section ----------------------------------------------------------

  const grouped = useMemo(() => {
    const sections: { key: string; label: string; items: CommandItem[] }[] = [];
    const sectionOrder: { key: CommandItem['section']; label: string }[] = [
      { key: 'actions',  label: t.actions },
      { key: 'usecases', label: t.usecases },
      { key: 'recent',   label: t.recent },
    ];
    for (const s of sectionOrder) {
      const items = filteredItems.filter((i) => i.section === s.key);
      if (items.length > 0) sections.push({ key: s.key, label: s.label, items });
    }
    return sections;
  }, [filteredItems, t]);

  // Flat list for keyboard navigation -----------------------------------------

  const flatItems = useMemo(() => grouped.flatMap((s) => s.items), [grouped]);

  // Reset state on open/close -------------------------------------------------

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Auto-focus with a small delay to let the animation begin
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Clamp selectedIndex when items change -------------------------------------

  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, selectedIndex]);

  // Scroll selected item into view --------------------------------------------

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Action handler ------------------------------------------------------------

  const handleSelect = useCallback(
    (item: CommandItem) => {
      onAction?.(item.id);
      onClose();
    },
    [onAction, onClose]
  );

  // Keyboard handler ----------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(1, flatItems.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + flatItems.length) % Math.max(1, flatItems.length));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatItems[selectedIndex]) handleSelect(flatItems[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatItems, selectedIndex, handleSelect, onClose]
  );

  // Global Cmd+K / Ctrl+K listener is expected to live in a parent that
  // toggles `isOpen`. We only handle Escape here via the onKeyDown above.

  // Track flat index across sections ------------------------------------------

  let flatIndex = -1;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Palette */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={language === 'es' ? 'Paleta de comandos' : 'Command palette'}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[min(20vh,160px)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="w-full max-w-[560px] mx-4 bg-white border border-[#e5e5e5] rounded-sm shadow-lg overflow-hidden"
              initial={{ scale: 0.96, y: -8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: -8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              onKeyDown={handleKeyDown}
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 border-b border-[#e5e5e5]">
                <Search className="w-4 h-4 text-[#a3a3a3] shrink-0" aria-hidden="true" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  placeholder={t.placeholder}
                  className="flex-1 h-12 bg-transparent text-sm font-[family-name:var(--font-geist-mono)] text-[#0a0a0a] placeholder:text-[#a3a3a3] outline-none"
                  aria-label={t.placeholder}
                  aria-activedescendant={flatItems[selectedIndex] ? `cmd-item-${flatItems[selectedIndex].id}` : undefined}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="command-palette-list"
                  aria-autocomplete="list"
                />
                <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                  <span className="bg-[#fafafa] border border-[#e5e5e5] px-1.5 py-0.5 rounded-sm">esc</span>
                </kbd>
              </div>

              {/* Results list */}
              <div
                ref={listRef}
                id="command-palette-list"
                role="listbox"
                className="max-h-[min(50vh,400px)] overflow-y-auto analysis-scroll"
              >
                {flatItems.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[#a3a3a3]">
                    {t.noResults}
                  </div>
                ) : (
                  grouped.map((section) => (
                    <div key={section.key} className="py-2">
                      {/* Section header */}
                      <div className="px-4 pb-1.5 pt-1 text-[10px] uppercase tracking-widest text-[#a3a3a3] font-[family-name:var(--font-geist-mono)] select-none">
                        {section.label}
                      </div>

                      {/* Items */}
                      {section.items.map((item) => {
                        flatIndex++;
                        const isSelected = flatIndex === selectedIndex;
                        const Icon = item.icon;
                        const currentIndex = flatIndex; // capture for click handler

                        return (
                          <button
                            key={item.id}
                            id={`cmd-item-${item.id}`}
                            role="option"
                            aria-selected={isSelected}
                            data-selected={isSelected}
                            onClick={() => handleSelect(item)}
                            onMouseEnter={() => setSelectedIndex(currentIndex)}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-75 outline-none',
                              isSelected
                                ? 'bg-[#f5f5f5] border-l-2 border-l-[#d4a017]'
                                : 'bg-transparent border-l-2 border-l-transparent hover:bg-[#fafafa]'
                            )}
                          >
                            <div className={cn(
                              'w-8 h-8 rounded-sm flex items-center justify-center shrink-0',
                              isSelected ? 'bg-white border border-[#e5e5e5]' : 'bg-[#fafafa]'
                            )}>
                              <Icon className="w-4 h-4 text-[#525252]" aria-hidden="true" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#0a0a0a] truncate">
                                {item.title}
                              </p>
                              {item.subtitle && (
                                <p className="text-xs text-[#a3a3a3] truncate">
                                  {item.subtitle}
                                </p>
                              )}
                            </div>

                            {item.shortcut && (
                              <kbd className="hidden sm:inline-flex items-center shrink-0 bg-[#fafafa] border border-[#e5e5e5] text-[10px] text-[#a3a3a3] px-1.5 py-0.5 rounded-sm font-[family-name:var(--font-geist-mono)]">
                                {item.shortcut}
                              </kbd>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer hints */}
              <div className="flex items-center gap-4 px-4 py-2 border-t border-[#e5e5e5] text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                <span className="inline-flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" aria-hidden="true" />
                  <ArrowDown className="w-3 h-3" aria-hidden="true" />
                  <span>{language === 'es' ? 'navegar' : 'navigate'}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
                  <span>{language === 'es' ? 'seleccionar' : 'select'}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Command className="w-3 h-3" aria-hidden="true" />
                  <span>K</span>
                  <span>{language === 'es' ? 'cerrar' : 'close'}</span>
                </span>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

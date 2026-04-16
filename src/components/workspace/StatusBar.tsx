'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import {
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  FileText,
  Globe,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import type { RiskLevel } from '@/lib/storage/conversation-history';
import { USE_CASE_LABELS } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const RISK_DOT_COLORS: Record<RiskLevel, string> = {
  bajo: '#22c55e',
  medio: '#eab308',
  alto: '#f97316',
  critico: '#ef4444',
};

const RISK_LABELS: Record<'es' | 'en', Record<RiskLevel, string>> = {
  es: { bajo: 'BAJO', medio: 'MEDIO', alto: 'ALTO', critico: 'CRITICO' },
  en: { bajo: 'LOW', medio: 'MEDIUM', alto: 'HIGH', critico: 'CRITICAL' },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatusBarProps {
  caseId: string | null;
  useCase: string;
  riskLevel: RiskLevel | null;
  documentCount: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  analysisPanelOpen: boolean;
  onToggleAnalysisPanel: () => void;
  language: 'es' | 'en';
}

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

export function StatusBar({
  caseId,
  useCase,
  riskLevel,
  documentCount,
  sidebarOpen,
  onToggleSidebar,
  analysisPanelOpen,
  onToggleAnalysisPanel,
  language,
}: StatusBarProps) {
  const { setLanguage } = useLanguage();

  const useCaseLabel =
    USE_CASE_LABELS[language]?.[useCase as keyof (typeof USE_CASE_LABELS)['es']] || useCase;

  return (
    <motion.header
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...NOVA_SPRING }}
      className="h-12 bg-white border-b border-[#e5e5e5] flex items-center px-3 shrink-0 z-30"
      role="banner"
    >
      {/* Left: back button + sidebar toggle + logo */}
      <div className="flex items-center gap-1 shrink-0">
        <Link
          href="/"
          className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
          aria-label={language === 'es' ? 'Volver al inicio' : 'Back to home'}
          title={language === 'es' ? 'Volver al inicio' : 'Back to home'}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-px h-4 bg-[#e5e5e5] mx-0.5" />
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
          aria-label={sidebarOpen ? (language === 'es' ? 'Cerrar sidebar' : 'Close sidebar') : (language === 'es' ? 'Abrir sidebar' : 'Open sidebar')}
          aria-expanded={sidebarOpen}
          aria-controls="workspace-sidebar"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </button>
        <span className="text-sm font-bold text-[#0a0a0a] tracking-tight hidden sm:inline">
          UtopIA<span className="text-[#d4a017]">.</span>
        </span>
      </div>

      {/* Center: case info */}
      <div className="flex-1 flex items-center justify-center gap-2 min-w-0 px-2">
        {caseId && (
          <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)] hidden md:inline truncate">
            {caseId}
          </span>
        )}
        {caseId && <span className="text-[#e5e5e5] hidden md:inline">|</span>}
        <span className="text-xs text-[#525252] font-[family-name:var(--font-geist-mono)] truncate">
          {useCaseLabel}
        </span>

        {riskLevel && (
          <>
            <span className="text-[#e5e5e5]">|</span>
            <span className="flex items-center gap-1.5 shrink-0">
              <motion.span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: RISK_DOT_COLORS[riskLevel] }}
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <span
                className="text-xs font-medium font-[family-name:var(--font-geist-mono)]"
                style={{ color: RISK_DOT_COLORS[riskLevel] }}
              >
                {RISK_LABELS[language][riskLevel]}
              </span>
            </span>
          </>
        )}
      </div>

      {/* Right: document count + analysis panel toggle + language toggle */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Document count */}
        {documentCount > 0 && (
          <button
            type="button"
            onClick={onToggleAnalysisPanel}
            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[#525252] hover:bg-[#fafafa] transition-colors"
            aria-label={`${documentCount} ${language === 'es' ? 'documentos' : 'documents'}`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="text-xs font-[family-name:var(--font-geist-mono)]">{documentCount}</span>
          </button>
        )}

        {/* Analysis panel toggle */}
        <button
          type="button"
          onClick={onToggleAnalysisPanel}
          className={cn(
            'p-1.5 rounded-sm transition-colors',
            analysisPanelOpen
              ? 'text-[#d4a017] bg-[#fafafa]'
              : 'text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa]',
          )}
          aria-label={
            analysisPanelOpen
              ? language === 'es'
                ? 'Cerrar panel de análisis'
                : 'Close analysis panel'
              : language === 'es'
                ? 'Abrir panel de análisis'
                : 'Open analysis panel'
          }
          aria-pressed={analysisPanelOpen}
          aria-expanded={analysisPanelOpen}
          aria-controls="analysis-panel"
        >
          {analysisPanelOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4" />
          )}
        </button>

        {/* Language toggle */}
        <button
          type="button"
          onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
          className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors flex items-center gap-1"
          aria-label={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase">
            {language === 'es' ? 'EN' : 'ES'}
          </span>
        </button>
      </div>
    </motion.header>
  );
}

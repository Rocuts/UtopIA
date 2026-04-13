'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronDown,
  ChevronUp,
  FileDown,
  Trash2,
  Scale,
  FileText,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { RiskGauge } from '@/components/ui/RiskGauge';
import { DocumentPreview, type DocStatus } from '@/components/ui/DocumentPreview';
import { cn } from '@/lib/utils';
import type { RiskAssessmentData, UploadedDocument, LegalReference } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOVA_SPRING = { stiffness: 400, damping: 25 };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AnalysisPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  riskAssessment: RiskAssessmentData | null;
  uploadedDocuments: UploadedDocument[];
  onRemoveDocument?: (filename: string) => void;
  onExportPDF?: () => void;
  onClearConversation?: () => void;
  language: 'es' | 'en';
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function PanelSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  count,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[#e5e5e5]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-xs font-medium text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
        aria-expanded={open}
      >
        <Icon className="w-3.5 h-3.5 text-[#525252] shrink-0" />
        <span className="flex-1 text-left uppercase tracking-wide">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] bg-[#fafafa] border border-[#e5e5e5] text-[#525252] rounded-sm px-1.5 py-0.5 font-[family-name:var(--font-geist-mono)]">
            {count}
          </span>
        )}
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-[#a3a3a3]" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-[#a3a3a3]" />
        )}
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
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnalysisPanel
// ---------------------------------------------------------------------------

export function AnalysisPanel({
  isOpen,
  onToggle,
  riskAssessment,
  uploadedDocuments,
  onRemoveDocument,
  onExportPDF,
  onClearConversation,
  language,
}: AnalysisPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onToggle]);

  // Trap focus on mobile overlay
  useEffect(() => {
    if (!isOpen) return;
    const el = panelRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [isOpen]);

  function getDocStatus(doc: UploadedDocument): DocStatus {
    if (doc.chunks > 0) return 'ready';
    return 'processing';
  }

  const riskLevelLabel = riskAssessment
    ? language === 'es'
      ? riskAssessment.level.toUpperCase()
      : { bajo: 'LOW', medio: 'MEDIUM', alto: 'HIGH', critico: 'CRITICAL' }[riskAssessment.level]
    : null;

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40 lg:hidden"
            onClick={onToggle}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', ...NOVA_SPRING }}
            className={cn(
              'fixed right-0 top-0 bottom-0 w-full sm:w-[360px] z-50',
              'lg:static lg:w-[320px] lg:z-auto lg:shrink-0',
              'bg-white border-l border-[#e5e5e5] flex flex-col overflow-hidden',
            )}
            role="complementary"
            aria-label={language === 'es' ? 'Panel de analisis' : 'Analysis panel'}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5] shrink-0">
              <h2 className="text-sm font-medium text-[#0a0a0a] uppercase tracking-wide">
                {language === 'es' ? 'Analisis' : 'Analysis'}
              </h2>
              <button
                onClick={onToggle}
                className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
                aria-label={language === 'es' ? 'Cerrar panel' : 'Close panel'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
              {/* Risk Overview */}
              <PanelSection
                title={language === 'es' ? 'Riesgo' : 'Risk'}
                icon={BarChart3}
                defaultOpen
              >
                {riskAssessment ? (
                  <div className="flex flex-col items-center gap-3">
                    <RiskGauge
                      level={riskAssessment.level}
                      score={riskAssessment.score}
                      label={riskLevelLabel || undefined}
                      className="scale-[0.85]"
                    />

                    {riskAssessment.factors.length > 0 && (
                      <div className="w-full">
                        <h4 className="text-[10px] font-medium text-[#a3a3a3] mb-1.5 uppercase tracking-widest">
                          {language === 'es' ? 'Factores' : 'Factors'}
                        </h4>
                        <ul className="space-y-1">
                          {riskAssessment.factors.map((f, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-[#525252]">
                              <span
                                className={cn(
                                  'mt-1 w-1.5 h-1.5 rounded-full shrink-0',
                                  f.severity === 'alto' || f.severity === 'high'
                                    ? 'bg-[#ef4444]'
                                    : f.severity === 'medio' || f.severity === 'medium'
                                      ? 'bg-[#eab308]'
                                      : 'bg-[#22c55e]',
                                )}
                              />
                              {f.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {riskAssessment.recommendations.length > 0 && (
                      <div className="w-full">
                        <h4 className="text-[10px] font-medium text-[#a3a3a3] mb-1.5 uppercase tracking-widest">
                          {language === 'es' ? 'Recomendaciones' : 'Recommendations'}
                        </h4>
                        <ul className="space-y-1">
                          {riskAssessment.recommendations.map((r, i) => (
                            <li
                              key={i}
                              className="text-xs text-[#525252] pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[6px] before:w-1 before:h-1 before:rounded-full before:bg-[#d4a017]"
                            >
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#a3a3a3] italic">
                    {language === 'es'
                      ? 'El nivel de riesgo aparecera al analizar su consulta.'
                      : 'Risk level will appear after analyzing your consultation.'}
                  </p>
                )}
              </PanelSection>

              {/* Documents */}
              <PanelSection
                title={language === 'es' ? 'Documentos' : 'Documents'}
                icon={FileText}
                count={uploadedDocuments.length}
              >
                {uploadedDocuments.length > 0 ? (
                  <div className="space-y-2">
                    {uploadedDocuments.map((doc, i) => (
                      <DocumentPreview
                        key={`${doc.filename}-${i}`}
                        filename={doc.filename}
                        size={doc.size}
                        status={getDocStatus(doc)}
                        textPreview={doc.textPreview}
                        onRemove={onRemoveDocument ? () => onRemoveDocument(doc.filename) : undefined}
                        className="!p-3"
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#a3a3a3] italic">
                    {language === 'es'
                      ? 'Arrastre documentos al chat para analizarlos.'
                      : 'Drag documents to the chat to analyze them.'}
                  </p>
                )}
              </PanelSection>

              {/* Legal References (placeholder) */}
              <PanelSection
                title={language === 'es' ? 'Referencias Legales' : 'Legal References'}
                icon={Scale}
                defaultOpen={false}
              >
                <p className="text-xs text-[#a3a3a3] italic">
                  {language === 'es'
                    ? 'Las referencias legales citadas en la conversacion apareceran aqui.'
                    : 'Legal references cited in the conversation will appear here.'}
                </p>
              </PanelSection>
            </div>

            {/* Export actions */}
            <div className="px-4 py-3 border-t border-[#e5e5e5] shrink-0 space-y-2">
              <Button
                onClick={onExportPDF}
                variant="secondary"
                size="sm"
                className="w-full justify-center gap-1.5"
              >
                <FileDown className="w-3.5 h-3.5" />
                {language === 'es' ? 'Exportar PDF' : 'Export PDF'}
              </Button>
              <Button
                onClick={onClearConversation}
                variant="ghost"
                size="sm"
                className="w-full justify-center gap-1.5 text-[#ef4444] hover:text-[#ef4444] hover:bg-[#fef2f2]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {language === 'es' ? 'Limpiar conversacion' : 'Clear conversation'}
              </Button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

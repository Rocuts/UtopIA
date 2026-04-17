'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Download,
  FileText,
  Copy,
  RotateCcw,
  ChevronRight,
  Clock,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Check,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import { StreamingText } from '@/design-system/components/StreamingText';
import { DSBadge } from '@/design-system/components/Badge';
import { ProgressRing } from '@/design-system/components/ProgressRing';
import { ReportFollowUpChat } from './ReportFollowUpChat';
import type { PipelineState, FinancialReport, ReportSection, QualityGrade } from '@/types/platform';
import type {
  FinancialReport as BackendFinancialReport,
  FinancialProgressEvent,
  CompanyInfo,
} from '@/lib/agents/financial/types';
import type {
  AuditReport as BackendAuditReport,
  AuditProgressEvent,
  AuditDomain,
} from '@/lib/agents/financial/audit/types';
import type { ReportIterationTurn } from './types';

const SPRING = { stiffness: 400, damping: 25 };

const STAGE_LABELS = [
  { label: 'Analista NIIF', sublabel: 'Estados financieros y notas' },
  { label: 'Director de Estrategia', sublabel: 'KPIs y proyecciones' },
  { label: 'Gobierno Corporativo', sublabel: 'Acta y cumplimiento' },
];

const AUDITOR_LABELS: Record<string, string> = {
  niif: 'NIIF/Contable',
  tributario: 'Tributario',
  legal: 'Legal/Societario',
  revisoria: 'Rev. Fiscal',
};

interface SSEHandlers {
  progress?: (event: unknown) => void;
  result?: (event: unknown) => void;
  error?: (event: unknown) => void;
}

async function consumeSSE(response: Response, signal: AbortSignal, handlers: SSEHandlers) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';

  try {
    while (true) {
      if (signal.aborted) {
        reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);

        if (line === '') {
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData);
              const handler = handlers[currentEvent as keyof SSEHandlers];
              handler?.(parsed);
            } catch {
              // Skip malformed event
            }
          }
          currentEvent = 'message';
          currentData = '';
        } else if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData = line.slice(5).trim();
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') throw err;
  }
}

function splitReportIntoSections(markdown: string): ReportSection[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const sections: ReportSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];
  let order = 0;

  const pushCurrent = () => {
    if (currentTitle !== null) {
      sections.push({
        id: `sec-${order}`,
        title: currentTitle || `Sección ${order + 1}`,
        content: currentLines.join('\n').trim(),
        order,
      });
      order += 1;
    }
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const heading = h1?.[1] ?? h2?.[1];
    if (heading) {
      pushCurrent();
      currentTitle = heading.trim();
      currentLines = [line];
    } else {
      if (currentTitle === null) {
        currentTitle = '';
        currentLines = [];
      }
      currentLines.push(line);
    }
  }
  pushCurrent();
  return sections.filter((s) => s.content.length > 0);
}

function StageNode({ index, state, label, sublabel }: {
  index: number;
  state: PipelineState;
  label: string;
  sublabel: string;
}) {
  const prefersReduced = useReducedMotion();
  const stageNum = (index + 1) as 1 | 2 | 3;
  const isComplete = state.completedStages.includes(stageNum);
  const isActive = state.currentStage === stageNum && state.mode === 'running';
  const isPending = !isComplete && !isActive;

  return (
    <div className={cn(
      'rounded-xl border-2 px-5 py-4 min-w-[150px] text-center transition-colors',
      isComplete && 'bg-[#F0FDF4] border-[#22C55E]',
      isActive && 'bg-[#FEF9EC] border-[#D4A017]',
      isPending && 'bg-[#fafafa] border-[#e5e5e5]',
    )}>
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {isComplete && <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />}
        {isActive && (
          <motion.div
            animate={prefersReduced ? {} : { rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="w-3.5 h-3.5 text-[#D4A017]" />
          </motion.div>
        )}
        {isPending && <div className="w-3.5 h-3.5 rounded-full border border-[#d4d4d4]" />}
        <span className={cn(
          'text-[10px] font-bold font-[family-name:var(--font-geist-mono)] uppercase',
          isComplete && 'text-[#16A34A]',
          isActive && 'text-[#D4A017]',
          isPending && 'text-[#a3a3a3]',
        )}>
          Agente {stageNum}
        </span>
      </div>
      <p className={cn(
        'text-xs font-semibold',
        isComplete && 'text-[#16A34A]',
        isActive && 'text-[#7D5B0C]',
        isPending && 'text-[#525252]',
      )}>
        {label}
      </p>
      <p className="text-[10px] text-[#a3a3a3] mt-0.5">{sublabel}</p>
    </div>
  );
}

function PipelineMonitor({ state }: { state: PipelineState }) {
  const elapsed = state.startedAt
    ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000)
    : 0;
  const [elapsedDisplay, setElapsedDisplay] = useState(elapsed);

  useEffect(() => {
    if (state.mode === 'complete') return;
    const interval = setInterval(() => {
      if (state.startedAt) {
        setElapsedDisplay(Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [state.mode, state.startedAt]);

  const minutes = Math.floor(elapsedDisplay / 60);
  const seconds = elapsedDisplay % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const overallProgress = (() => {
    const stageProgress = state.completedStages.length * 20;
    const auditProgress = state.auditorsComplete.length * 7.5;
    const qualityProgress = state.qualityGrade ? 10 : 0;
    return Math.min(stageProgress + auditProgress + qualityProgress, 100);
  })();

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5]">
        <div>
          <h2 className="text-sm font-bold text-[#0a0a0a] flex items-center gap-2">
            <Loader2 className={cn('w-4 h-4', state.mode !== 'complete' && 'animate-spin')} />
            {state.mode === 'complete' ? 'REPORTE COMPLETO' : 'GENERANDO REPORTE NIIF ELITE'}
          </h2>
          <p className="text-xs text-[#a3a3a3] mt-0.5 font-[family-name:var(--font-geist-mono)]">
            <Clock className="w-3 h-3 inline mr-1" />
            {timeStr} · Tiempo estimado: 3-5 min
          </p>
        </div>
        <ProgressRing progress={overallProgress} size={48} strokeWidth={4} />
      </div>

      {/* Phase 1: Agents */}
      <div className="px-6 py-4">
        <h3 className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider mb-3 font-[family-name:var(--font-geist-mono)]">
          Fase 1 — Generacion de Reporte
        </h3>
        <div className="flex items-center gap-2 overflow-x-auto styled-scrollbar pb-2">
          {STAGE_LABELS.map((s, i) => (
            <div key={i} className="flex items-center">
              <StageNode index={i} state={state} label={s.label} sublabel={s.sublabel} />
              {i < STAGE_LABELS.length - 1 && (
                <ChevronRight className="w-5 h-5 text-[#d4d4d4] mx-1 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Phase 2: Auditors */}
      <div className="px-6 py-4 border-t border-[#f5f5f5]">
        <h3 className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider mb-3 font-[family-name:var(--font-geist-mono)]">
          Fase 2 — Auditoria (4 en paralelo)
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(AUDITOR_LABELS).map(([key, label]) => {
            const started = state.auditorsStarted.includes(key);
            const complete = state.auditorsComplete.includes(key);
            const findingCount = state.auditFindings[key];
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
                  complete && 'bg-[#F0FDF4] border-[#BBF7D0] text-[#16A34A]',
                  started && !complete && 'bg-[#FEF9EC] border-[#FDE68A] text-[#D97706]',
                  !started && 'bg-[#fafafa] border-[#e5e5e5] text-[#a3a3a3]',
                )}
              >
                {complete ? <CheckCircle className="w-3 h-3" /> : started ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-3 h-3 rounded-full border border-current" />}
                {label}
                {findingCount !== undefined && (
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)]">
                    ({findingCount})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase 3: Quality */}
      <div className="px-6 py-4 border-t border-[#f5f5f5]">
        <h3 className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider mb-2 font-[family-name:var(--font-geist-mono)]">
          Fase 3 — Meta-Auditoria de Calidad
        </h3>
        {state.qualityGrade ? (
          <div className="flex items-center gap-2">
            <DSBadge variant="grade" grade={state.qualityGrade} label={state.qualityGrade} size="md" />
            <span className="text-xs text-[#525252] font-[family-name:var(--font-geist-mono)]">
              {state.qualityScore}/100
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-[#a3a3a3]">
            <div className="w-3 h-3 rounded-full border border-[#d4d4d4]" />
            {state.mode === 'quality' ? 'Evaluando calidad...' : 'Esperando auditoria completa'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ReportViewer ───────────────────────────────────────────────────────────
// Props:
// - content / sections: prosa renderizable (existente).
// - report / rawData / company: reporte backend + data cruda para Excel
//   export y chat de seguimiento.
// - conversationId: id estable del reporte (persistencia).
// - onReset: resetea el estado del pipeline al padre (Nuevo Reporte).
// - onPatchReport: mutador del markdown consolidado + sections viewer.
// - initialTurns / onTurnsChange: persistencia del chat de seguimiento.

interface ReportViewerProps {
  content: string;
  sections: ReportSection[];
  report?: BackendFinancialReport;
  rawData?: string;
  company?: CompanyInfo;
  language: 'es' | 'en';
  conversationId?: string;
  initialTurns?: ReportIterationTurn[];
  onReset?: () => void;
  onPatchReport?: (newConsolidatedMarkdown: string) => void;
  onTurnsChange?: (turns: ReportIterationTurn[]) => void;
}

function ReportViewer({
  content,
  sections,
  report,
  rawData,
  company,
  language,
  conversationId,
  initialTurns,
  onReset,
  onPatchReport,
  onTurnsChange,
}: ReportViewerProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  const contentRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(`report-section-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ─── Descargar Excel ─────────────────────────────────────────────────────
  // POST /api/financial-report/export con { report, rawData } — el endpoint
  // responde con un .xlsx binario (Content-Disposition: attachment).
  const handleDownloadExcel = useCallback(async () => {
    if (!report || isExportingExcel) return;
    setIsExportingExcel(true);
    setExportError(null);
    try {
      const res = await fetch('/api/financial-report/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report, rawData }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }

      // Extraer nombre sugerido del header (si existe).
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `Reporte_Financiero_UtopIA_${Date.now()}.xlsx`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setExportError(
        language === 'es'
          ? `No se pudo generar el Excel: ${msg}`
          : `Could not generate Excel: ${msg}`,
      );
    } finally {
      setIsExportingExcel(false);
    }
  }, [report, rawData, isExportingExcel, language]);

  // ─── Exportar PDF ────────────────────────────────────────────────────────
  // MVP: window.print() + hoja de estilos @media print inyectada abajo.
  const handlePrintPdf = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }, []);

  // ─── Copiar Markdown ─────────────────────────────────────────────────────
  // Preferimos navigator.clipboard; fallback a textarea + execCommand.
  const handleCopy = useCallback(async () => {
    const markdown =
      report?.consolidatedReport ||
      (sections.length > 0 ? sections.map((s) => s.content).join('\n\n') : content);
    if (!markdown) return;

    const showDone = () => {
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1500);
    };

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
        showDone();
        return;
      }
    } catch {
      // fallback abajo
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = markdown;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showDone();
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1500);
    }
  }, [report, sections, content]);

  // ─── Nuevo reporte ────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    onReset?.();
  }, [onReset]);

  const copyLabel =
    copyState === 'done'
      ? language === 'es' ? 'Copiado' : 'Copied'
      : copyState === 'error'
        ? language === 'es' ? 'No se pudo copiar' : 'Copy failed'
        : language === 'es' ? 'Copiar' : 'Copy';

  return (
    <div className="flex h-full report-viewer-root">
      {/* Print stylesheet — oculta cromos (sidebar, statusbar, nav, action bar,
          follow-up panel) y deja solo la prosa del reporte al imprimir/PDF. */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          html,
          body {
            background: #ffffff !important;
          }
          #workspace-sidebar,
          #analysis-panel,
          .statusbar,
          [data-role='statusbar'],
          .report-action-bar,
          .report-toc,
          .report-followup,
          .no-print {
            display: none !important;
          }
          .report-viewer-root {
            height: auto !important;
            display: block !important;
          }
          .report-prose-root {
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
          }
          .report-prose-root .prose {
            color: #000 !important;
            font-size: 11pt !important;
          }
        }
      `}</style>

      {/* Document navigation */}
      {sections.length > 0 && (
        <nav className="report-toc w-[200px] shrink-0 border-r border-[#e5e5e5] overflow-y-auto styled-scrollbar py-4 hidden lg:block">
          <h3 className="px-4 text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider mb-2 font-[family-name:var(--font-geist-mono)]">
            {language === 'es' ? 'Contenido' : 'Contents'}
          </h3>
          <ul className="space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  className={cn(
                    'w-full text-left px-4 py-1.5 text-xs transition-colors',
                    activeSection === s.id
                      ? 'text-[#D4A017] bg-[#FEF9EC] font-medium border-l-2 border-[#D4A017]'
                      : 'text-[#525252] hover:bg-[#fafafa]',
                  )}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Document content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto styled-scrollbar">
        {/* Action bar */}
        <div className="report-action-bar sticky top-0 z-10 bg-white border-b border-[#e5e5e5] px-6 py-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={isExportingExcel || !report}
            aria-label={language === 'es' ? 'Descargar Excel' : 'Download Excel'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              isExportingExcel || !report
                ? 'bg-[#f5f5f5] text-[#a3a3a3] cursor-not-allowed'
                : 'bg-[#D4A017] text-white hover:bg-[#A87C10]',
            )}
          >
            {isExportingExcel ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {isExportingExcel
              ? language === 'es' ? 'Generando...' : 'Generating...'
              : language === 'es' ? 'Descargar Excel .xlsx' : 'Download Excel .xlsx'}
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            aria-label={language === 'es' ? 'Exportar a PDF (Imprimir)' : 'Export to PDF (Print)'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#e5e5e5] text-[#525252] text-xs font-medium hover:bg-[#fafafa] transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            {language === 'es' ? 'Exportar PDF' : 'Export PDF'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={language === 'es' ? 'Copiar reporte como Markdown' : 'Copy report as Markdown'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
              copyState === 'done'
                ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]'
                : copyState === 'error'
                  ? 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                  : 'border-[#e5e5e5] text-[#525252] hover:bg-[#fafafa]',
            )}
          >
            {copyState === 'done' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={!onReset}
            aria-label={language === 'es' ? 'Crear un nuevo reporte' : 'Create a new report'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#e5e5e5] text-[#525252] text-xs font-medium hover:bg-[#fafafa] transition-colors ml-auto disabled:text-[#a3a3a3] disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {language === 'es' ? 'Nuevo Reporte' : 'New Report'}
          </button>
        </div>

        {exportError && (
          <div className="mx-6 my-3 rounded border border-[#EF4444] bg-[#FEF2F2] px-3 py-2 flex items-start gap-2 text-xs text-[#DC2626]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-words">{exportError}</span>
          </div>
        )}

        {/* Report content */}
        <div className="report-prose-root px-8 py-6 max-w-4xl mx-auto">
          <div className="prose prose-sm max-w-none text-[#0a0a0a] prose-headings:text-[#0a0a0a] prose-headings:font-semibold prose-p:leading-relaxed prose-a:text-[#D4A017] prose-strong:text-[#0a0a0a] prose-table:border prose-table:border-[#e5e5e5] prose-th:bg-[#fafafa] prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:font-medium prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:border-t prose-td:border-[#f5f5f5]">
            {sections.length > 0 ? (
              sections.map((s) => (
                <div key={s.id} id={`report-section-${s.id}`} className="mb-8">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {s.content}
                  </ReactMarkdown>
                </div>
              ))
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {content}
              </ReactMarkdown>
            )}
          </div>
        </div>

        {/* Chat de seguimiento — solo si tenemos el reporte backend + data cruda + empresa. */}
        {report && rawData !== undefined && company && (
          <div className="report-followup">
            <ReportFollowUpChat
              report={report}
              rawData={rawData}
              company={company}
              language={language}
              conversationId={conversationId}
              initialTurns={initialTurns}
              onTurnsChange={onTurnsChange}
              onPatchReport={onPatchReport}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function PipelineWorkspace() {
  const {
    pipelineState,
    setPipelineState,
    pipelineInput,
    setPipelineInput,
    lastCompletedReport,
    setLastCompletedReport,
    updateReportTurns,
  } = useWorkspace();
  const [streamedContent, setStreamedContent] = useState('');
  const [report, setReport] = useState<FinancialReport | null>(null);
  // Backend report + data cruda + info empresa: necesario para Excel export
  // y para el chat de seguimiento. Se hidrata desde `lastCompletedReport`
  // al montar para preservar el viewer tras refresh.
  const [backendReport, setBackendReport] = useState<BackendFinancialReport | null>(
    lastCompletedReport?.report ?? null,
  );
  const [rawData, setRawData] = useState<string>(lastCompletedReport?.rawData ?? '');
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(
    lastCompletedReport?.company ?? null,
  );
  const [conversationId, setConversationId] = useState<string>(
    lastCompletedReport?.conversationId ?? '',
  );
  const [initialTurns, setInitialTurns] = useState<ReportIterationTurn[]>(
    lastCompletedReport?.turns ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const { language } = useLanguage();
  const lastProcessedInputRef = useRef<typeof pipelineInput>(null);

  // Si al montar existe un reporte completado pero el pipelineState no marca
  // 'complete' (p.ej. primera carga tras hidratar desde storage), lo forzamos.
  const hydratedPipelineRef = useRef(false);
  useEffect(() => {
    if (hydratedPipelineRef.current) return;
    hydratedPipelineRef.current = true;
    if (lastCompletedReport && !report) {
      const consolidated = lastCompletedReport.report.consolidatedReport;
      setReport({
        content: consolidated,
        sections: splitReportIntoSections(consolidated),
      });
      setPipelineState((prev) => ({ ...prev, mode: 'complete' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pipelineInput || lastProcessedInputRef.current === pipelineInput) return;
    lastProcessedInputRef.current = pipelineInput;
    setError(null);
    setReport(null);
    setStreamedContent('');
    const controller = new AbortController();

    (async () => {
      try {
        // ─── Phase 1: Financial Report ─────────────────────────────────────
        const phase1Body = {
          rawData: pipelineInput.rawData,
          company: {
            name: pipelineInput.company.name,
            nit: pipelineInput.company.nit,
            entityType: pipelineInput.company.entityType,
            sector: pipelineInput.company.sector,
            city: pipelineInput.company.city,
            legalRepresentative: pipelineInput.company.legalRepresentative,
            fiscalAuditor: pipelineInput.company.fiscalAuditor,
            accountant: pipelineInput.company.accountant,
            niifGroup: pipelineInput.niifGroup,
            fiscalPeriod: pipelineInput.fiscalPeriod,
            comparativePeriod: pipelineInput.comparativePeriod,
          },
          language,
          instructions: pipelineInput.specialInstructions,
        };

        const phase1Res = await fetch('/api/financial-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
          body: JSON.stringify(phase1Body),
          signal: controller.signal,
        });

        if (!phase1Res.ok) {
          const errBody = await phase1Res.text().catch(() => '');
          throw new Error(`Reporte NIIF falló (HTTP ${phase1Res.status}): ${errBody.slice(0, 300)}`);
        }

        const phase1Box: { value: BackendFinancialReport | null } = { value: null };

        await consumeSSE(phase1Res, controller.signal, {
          progress: (raw) => {
            const evt = raw as FinancialProgressEvent;
            if (evt.type === 'stage_start' && evt.stage <= 3) {
              setPipelineState((prev) => ({
                ...prev,
                mode: 'running',
                currentStage: evt.stage as 1 | 2 | 3,
              }));
            } else if (evt.type === 'stage_complete' && evt.stage <= 3) {
              const stageNum = evt.stage;
              setPipelineState((prev) => ({
                ...prev,
                completedStages: prev.completedStages.includes(stageNum)
                  ? prev.completedStages
                  : [...prev.completedStages, stageNum],
              }));
            } else if (evt.type === 'stage_progress') {
              setStreamedContent((prev) => prev + (prev ? '\n\n' : '') + `**${evt.detail}**`);
            }
          },
          result: (raw) => {
            phase1Box.value = raw as BackendFinancialReport;
          },
          error: (raw) => {
            const { detail } = raw as { detail?: string };
            throw new Error(detail || 'Error en reporte financiero');
          },
        });

        const phase1Report = phase1Box.value;
        if (!phase1Report) throw new Error('El endpoint de reporte no devolvió un resultado.');

        // Ensure all 3 stages are marked complete even if events were missed
        setPipelineState((prev) => ({
          ...prev,
          completedStages: [1, 2, 3],
          currentStage: 3,
        }));

        // ─── Phase 2: Audit (if enabled) ──────────────────────────────────
        const phase2Box: { value: BackendAuditReport | null } = { value: null };
        if (pipelineInput.outputOptions.auditPipeline) {
          setPipelineState((prev) => ({ ...prev, mode: 'auditing' }));

          const phase2Res = await fetch('/api/financial-audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
            body: JSON.stringify({
              report: phase1Report,
              language,
            }),
            signal: controller.signal,
          });

          if (!phase2Res.ok) {
            const errBody = await phase2Res.text().catch(() => '');
            throw new Error(`Auditoría falló (HTTP ${phase2Res.status}): ${errBody.slice(0, 300)}`);
          }

          await consumeSSE(phase2Res, controller.signal, {
            progress: (raw) => {
              const evt = raw as AuditProgressEvent;
              if (evt.type === 'auditor_start') {
                const domain = evt.domain;
                setPipelineState((prev) => ({
                  ...prev,
                  auditorsStarted: prev.auditorsStarted.includes(domain)
                    ? prev.auditorsStarted
                    : [...prev.auditorsStarted, domain],
                }));
              } else if (evt.type === 'auditor_complete' || evt.type === 'auditor_failed') {
                const domain = evt.domain as AuditDomain;
                setPipelineState((prev) => ({
                  ...prev,
                  auditorsComplete: prev.auditorsComplete.includes(domain)
                    ? prev.auditorsComplete
                    : [...prev.auditorsComplete, domain],
                }));
              }
            },
            result: (raw) => {
              phase2Box.value = raw as BackendAuditReport;
            },
            error: (raw) => {
              const { detail } = raw as { detail?: string };
              throw new Error(detail || 'Error en auditoría');
            },
          });

          if (phase2Box.value) {
            const findingCounts: Record<string, number> = {};
            for (const r of phase2Box.value.auditorResults) {
              findingCounts[r.domain] = r.findings.length;
            }
            setPipelineState((prev) => ({
              ...prev,
              auditFindings: findingCounts,
              auditorsComplete: ['niif', 'tributario', 'legal', 'revisoria'],
            }));
          }
        }

        // ─── Phase 3: Quality Meta-Audit (if enabled) ─────────────────────
        if (pipelineInput.outputOptions.metaAudit) {
          setPipelineState((prev) => ({ ...prev, mode: 'quality' }));

          const phase3Res = await fetch('/api/financial-quality', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              report: phase1Report,
              auditReport: phase2Box.value,
              language,
            }),
            signal: controller.signal,
          });

          if (phase3Res.ok) {
            const quality = (await phase3Res.json()) as {
              grade?: QualityGrade;
              score?: number;
            };
            setPipelineState((prev) => ({
              ...prev,
              qualityGrade: quality.grade,
              qualityScore: quality.score,
            }));
          }
        }

        // ─── Finalize ─────────────────────────────────────────────────────
        const consolidated = phase1Report.consolidatedReport;
        setReport({
          content: consolidated,
          sections: splitReportIntoSections(consolidated),
        });

        // Persistencia: backend report + data cruda + empresa + conv id.
        // `phase1Report.company` es canonico (viene del endpoint); lo usamos
        // para garantizar fiscalPeriod/nit estables en el chat de seguimiento.
        const nextConvId = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setBackendReport(phase1Report);
        setRawData(pipelineInput.rawData);
        setCompanyInfo(phase1Report.company);
        setConversationId(nextConvId);
        setInitialTurns([]);
        setLastCompletedReport({
          report: phase1Report,
          rawData: pipelineInput.rawData,
          company: phase1Report.company,
          conversationId: nextConvId,
          turns: [],
        });

        setPipelineState((prev) => ({
          ...prev,
          mode: 'complete',
          completedAt: new Date(),
        }));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        setError(msg);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [pipelineInput, language, setPipelineState, setLastCompletedReport]);

  const isRunning = pipelineState.mode !== 'idle' && pipelineState.mode !== 'complete';
  const isComplete = pipelineState.mode === 'complete';

  // ─── Handlers para acciones del ReportViewer ────────────────────────────
  // "Nuevo Reporte": limpia el reporte en memoria y reabre el form.
  const handleReset = useCallback(() => {
    setReport(null);
    setBackendReport(null);
    setRawData('');
    setCompanyInfo(null);
    setConversationId('');
    setInitialTurns([]);
    setStreamedContent('');
    setError(null);
    lastProcessedInputRef.current = null;
    setPipelineInput(null);
    setPipelineState((prev) => ({
      ...prev,
      mode: 'idle',
      currentStage: 0,
      completedStages: [],
      auditorsStarted: [],
      auditorsComplete: [],
      auditFindings: {},
      qualityGrade: undefined,
      qualityScore: undefined,
      startedAt: undefined,
      completedAt: undefined,
    }));
  }, [setPipelineInput, setPipelineState]);

  // "Aplicar al reporte": muta consolidatedReport + re-splits sections + persiste.
  const handlePatchReport = useCallback(
    (newMd: string) => {
      setReport({
        content: newMd,
        sections: splitReportIntoSections(newMd),
      });
      setBackendReport((prev) => {
        if (!prev) return prev;
        const next: BackendFinancialReport = { ...prev, consolidatedReport: newMd };
        // Persistir el nuevo estado completo.
        if (companyInfo && conversationId) {
          setLastCompletedReport({
            report: next,
            rawData,
            company: companyInfo,
            conversationId,
            turns: initialTurns,
          });
        }
        return next;
      });
    },
    [companyInfo, conversationId, rawData, initialTurns, setLastCompletedReport],
  );

  // Persistencia de turnos del chat de seguimiento.
  const handleTurnsChange = useCallback(
    (turns: ReportIterationTurn[]) => {
      if (!conversationId) return;
      updateReportTurns(conversationId, turns);
    },
    [conversationId, updateReportTurns],
  );

  if (isComplete && report) {
    return (
      <ReportViewer
        content={report.content}
        sections={report.sections}
        report={backendReport ?? undefined}
        rawData={rawData || undefined}
        company={companyInfo ?? undefined}
        language={language}
        conversationId={conversationId || undefined}
        initialTurns={initialTurns}
        onReset={handleReset}
        onPatchReport={handlePatchReport}
        onTurnsChange={handleTurnsChange}
      />
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto styled-scrollbar">
      <PipelineMonitor state={pipelineState} />

      {error && (
        <div className="mx-6 my-4 rounded-lg border border-[#EF4444] bg-[#FEF2F2] px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[#DC2626]">Error en el pipeline</div>
            <p className="text-xs text-[#737373] whitespace-pre-wrap break-words">{error}</p>
          </div>
        </div>
      )}

      {!pipelineInput && !isRunning && (
        <div className="flex-1 flex items-center justify-center text-sm text-[#a3a3a3] px-6 text-center">
          No hay pipeline activo. Inicie un nuevo reporte desde &quot;Nueva Consulta&quot;.
        </div>
      )}

      {/* Live streaming preview */}
      {streamedContent && (
        <div className="flex-1 border-t border-[#e5e5e5] px-8 py-6 overflow-y-auto styled-scrollbar">
          <h3 className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider mb-3 font-[family-name:var(--font-geist-mono)]">
            Vista previa en tiempo real
          </h3>
          <StreamingText isStreaming={isRunning}>
            <div className="prose prose-sm max-w-none text-[#0a0a0a]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {streamedContent}
              </ReactMarkdown>
            </div>
          </StreamingText>
        </div>
      )}

      {!streamedContent && isRunning && !error && (
        <div className="flex-1 flex items-center justify-center text-sm text-[#a3a3a3]">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            Esperando respuesta de los agentes...
          </motion.div>
        </div>
      )}
    </div>
  );
}

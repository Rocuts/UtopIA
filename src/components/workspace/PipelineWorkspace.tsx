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
import { consumeSSE, fetchSSEWithRetry } from '@/lib/sse/consume';

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

// ─── POST-MVP NOTE ──────────────────────────────────────────────────────────
// La orquestacion del pipeline de 3 fases esta en el cliente (este useEffect).
// Es fragil: `ERR_NETWORK_CHANGED`, cambios de red, VPN, o cierre del tab
// pueden perder trabajo ya completado por el servidor. Para la version
// production-grade (post-MVP) hay que migrar a Vercel Workflow DevKit:
// cada fase se convierte en `step.do(...)` con checkpoints automaticos en
// Blob/KV, retries built-in y resume crash-safe. El cliente solo guarda un
// `runId` y se conecta para leer progreso. Ver `docs/POST_MVP_WORKFLOW_MIGRATION.md`.
// Los parches defensivos que siguen (checkpoint local tras Fase 1, fases 2/3
// no-bloqueantes, retry en Fase 3) son mitigaciones MVP, no la arquitectura
// final.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch con reintentos ante errores de red transitorios (`TypeError: Failed to
 * fetch`, p.ej. `ERR_NETWORK_CHANGED`). Solo reintenta errores de RED — los
 * HTTP no-ok y los errores de parseo NO se reintentan (probablemente son
 * deterministas). Respeta `AbortSignal` durante el backoff para no bloquear
 * unmounts del componente.
 */
async function fetchJSONWithRetry<T>(
  url: string,
  init: RequestInit,
  opts: { retries?: number; backoffMs?: number[] } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? [1000, 3000];
  const signal = init.signal ?? undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') throw err;
      const isNetwork = err instanceof TypeError;
      if (!isNetwork || attempt === retries) throw err;
      lastErr = err;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, backoff[attempt] ?? 3000);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
  throw lastErr;
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
      isComplete && 'bg-success/10 border-success',
      isActive && 'bg-gold-300/10 border-gold-500',
      isPending && 'bg-n-50 border-n-200',
    )}>
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {isComplete && <CheckCircle className="w-3.5 h-3.5 text-success" />}
        {isActive && (
          <motion.div
            animate={prefersReduced ? {} : { rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="w-3.5 h-3.5 text-gold-500" />
          </motion.div>
        )}
        {isPending && <div className="w-3.5 h-3.5 rounded-full border border-n-300" />}
        <span className={cn(
          'text-2xs font-bold font-mono uppercase',
          isComplete && 'text-success',
          isActive && 'text-gold-500',
          isPending && 'text-n-600',
        )}>
          Agente {stageNum}
        </span>
      </div>
      <p className={cn(
        'text-xs font-semibold',
        isComplete && 'text-success',
        isActive && 'text-gold-700',
        isPending && 'text-n-700',
      )}>
        {label}
      </p>
      <p className="text-2xs text-n-600 mt-0.5">{sublabel}</p>
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-n-200">
        <div>
          <h2 className="text-sm font-bold text-n-900 flex items-center gap-2">
            <Loader2 className={cn('w-4 h-4', state.mode !== 'complete' && 'animate-spin')} />
            {state.mode === 'complete' ? 'REPORTE COMPLETO' : 'GENERANDO REPORTE NIIF ELITE'}
          </h2>
          <p className="text-xs text-n-400 mt-0.5 font-mono">
            <Clock className="w-3 h-3 inline mr-1" />
            {timeStr} · Tiempo estimado: 3-5 min
          </p>
        </div>
        <ProgressRing progress={overallProgress} size={48} strokeWidth={4} />
      </div>

      {/* Phase 1: Agents */}
      <div className="px-6 py-4">
        <h3 className="text-2xs font-bold text-n-400 uppercase tracking-wider mb-3 font-mono">
          Fase 1 — Generacion de Reporte
        </h3>
        <div className="flex items-center gap-2 overflow-x-auto styled-scrollbar pb-2">
          {STAGE_LABELS.map((s, i) => (
            <div key={i} className="flex items-center">
              <StageNode index={i} state={state} label={s.label} sublabel={s.sublabel} />
              {i < STAGE_LABELS.length - 1 && (
                <ChevronRight className="w-5 h-5 text-n-300 mx-1 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Phase 2: Auditors */}
      <div className="px-6 py-4 border-t border-n-100">
        <h3 className="text-2xs font-bold text-n-400 uppercase tracking-wider mb-3 font-mono">
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
                  complete && 'bg-success/10 border-success/30 text-success',
                  started && !complete && 'bg-gold-300/10 border-warning/30 text-warning',
                  !started && 'bg-n-50 border-n-200 text-n-600',
                )}
              >
                {complete ? <CheckCircle className="w-3 h-3" /> : started ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-3 h-3 rounded-full border border-current" />}
                {label}
                {findingCount !== undefined && (
                  <span className="text-2xs font-mono">
                    ({findingCount})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase 3: Quality */}
      <div className="px-6 py-4 border-t border-n-100">
        <h3 className="text-2xs font-bold text-n-400 uppercase tracking-wider mb-2 font-mono">
          Fase 3 — Meta-Auditoria de Calidad
        </h3>
        {state.qualityGrade ? (
          <div className="flex items-center gap-2">
            <DSBadge variant="grade" grade={state.qualityGrade} label={state.qualityGrade} size="md" />
            <span className="text-xs text-n-600 font-mono">
              {state.qualityScore}/100
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-n-400">
            <div className="w-3 h-3 rounded-full border border-n-300" />
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
      const filename = match?.[1] || `Reporte_Financiero_1mas1_${Date.now()}.xlsx`;

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
          #chat-sidebar,
          header[role='banner'],
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
        <nav className="report-toc w-[200px] shrink-0 border-r border-n-200 overflow-y-auto styled-scrollbar py-4 hidden lg:block">
          <h3 className="px-4 text-2xs font-bold text-n-400 uppercase tracking-wider mb-2 font-mono">
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
                      ? 'text-gold-500 bg-gold-300/10 font-medium border-l-2 border-gold-500'
                      : 'text-n-600 hover:bg-n-50',
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
        <div className="report-action-bar sticky top-0 z-10 bg-n-0 border-b border-n-200 px-6 py-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={isExportingExcel || !report}
            aria-label={language === 'es' ? 'Descargar Excel' : 'Download Excel'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              isExportingExcel || !report
                ? 'bg-n-100 text-n-400 cursor-not-allowed'
                : 'bg-gold-500 text-n-0 hover:bg-gold-700',
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-600 text-xs font-medium hover:bg-n-50 transition-colors"
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
                ? 'border-success/30 bg-success/10 text-success'
                : copyState === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-n-200 text-n-600 hover:bg-n-50',
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-600 text-xs font-medium hover:bg-n-50 transition-colors ml-auto disabled:text-n-400 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {language === 'es' ? 'Nuevo Reporte' : 'New Report'}
          </button>
        </div>

        {exportError && (
          <div className="mx-6 my-3 rounded border border-danger bg-danger/10 px-3 py-2 flex items-start gap-2 text-xs text-danger">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-words">{exportError}</span>
          </div>
        )}

        {/* Report content */}
        <div className="report-prose-root px-8 py-6 max-w-4xl mx-auto">
          <div className="prose prose-sm max-w-none text-n-900 prose-headings:text-n-900 prose-headings:font-semibold prose-p:leading-relaxed prose-a:text-gold-500 prose-strong:text-n-900 prose-table:border prose-table:border-n-200 prose-th:bg-n-50 prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:font-medium prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:border-t prose-td:border-n-100">
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
      // ─── Phase 1: Financial Report (CRITICA) ───────────────────────────
      // Si Fase 1 falla, no hay reporte que mostrar — abortamos y mostramos
      // error fatal. Es la unica fase cuyo fallo destruye la corrida.
      let phase1Report: BackendFinancialReport | null = null;
      try {
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

        const phase1Res = await fetchSSEWithRetry('/api/financial-report', {
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

        phase1Report = phase1Box.value;
        if (!phase1Report) throw new Error('El endpoint de reporte no devolvió un resultado.');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        setError(msg);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
        return;
      }

      // ─── CHECKPOINT: persistir Fase 1 ANTES de fases opcionales ────────
      // Esta linea es el corazon del fix: a partir de aqui, aunque la red se
      // caiga y el usuario recargue, el reporte NIIF vive en localStorage via
      // `saveReport` (WorkspaceContext.setLastCompletedReport). Antes del
      // parche, el checkpoint ocurria al final de las 3 fases, asi que un
      // `Failed to fetch` en Fase 3 borraba 5+ minutos de trabajo NIIF.
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
        completedStages: [1, 2, 3],
        currentStage: 3,
        phase2Error: undefined,
        phase3Error: undefined,
      }));

      // ─── Phase 2: Audit (OPCIONAL, no-bloqueante) ──────────────────────
      // Fallos de red aqui NO destruyen el reporte. Se registra `phase2Error`
      // y el pipeline continua. El usuario vera el reporte NIIF + un aviso
      // "Auditoria no disponible" en la UI.
      let phase2Report: BackendAuditReport | null = null;
      if (pipelineInput.outputOptions.auditPipeline) {
        setPipelineState((prev) => ({ ...prev, mode: 'auditing' }));
        try {
          const phase2Res = await fetchSSEWithRetry('/api/financial-audit', {
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

          const phase2Box: { value: BackendAuditReport | null } = { value: null };
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

          phase2Report = phase2Box.value;
          if (phase2Report) {
            const findingCounts: Record<string, number> = {};
            for (const r of phase2Report.auditorResults) {
              findingCounts[r.domain] = r.findings.length;
            }
            setPipelineState((prev) => ({
              ...prev,
              auditFindings: findingCounts,
              auditorsComplete: ['niif', 'tributario', 'legal', 'revisoria'],
            }));
          }
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : 'Error desconocido';
          setPipelineState((prev) => ({ ...prev, phase2Error: msg }));
        }
      }

      // ─── Phase 3: Quality Meta-Audit (OPCIONAL, no-bloqueante, retry) ──
      // Esta es la fase mas fragil: NO hay streaming, todo llega en un unico
      // `await .json()` que puede tardar 60-180s. Es la que disparo el bug
      // original `net::ERR_NETWORK_CHANGED`. Mitigacion: retry con backoff
      // ante errores de red + aislamiento del catch.
      if (pipelineInput.outputOptions.metaAudit) {
        setPipelineState((prev) => ({ ...prev, mode: 'quality' }));
        try {
          const quality = await fetchJSONWithRetry<{
            grade?: QualityGrade;
            score?: number;
          }>(
            '/api/financial-quality',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                report: phase1Report,
                auditReport: phase2Report,
                language,
              }),
              signal: controller.signal,
            },
            { retries: 2, backoffMs: [1000, 3000] },
          );
          setPipelineState((prev) => ({
            ...prev,
            qualityGrade: quality.grade,
            qualityScore: quality.score,
          }));
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : 'Error desconocido';
          setPipelineState((prev) => ({ ...prev, phase3Error: msg }));
        }
      }

      // ─── Finalize ────────────────────────────────────────────────────
      // Independientemente de si Fase 2/3 fallaron, el reporte NIIF se
      // muestra. Los warnings se surfacean via `phase2Error` / `phase3Error`.
      const consolidated = phase1Report.consolidatedReport;
      setReport({
        content: consolidated,
        sections: splitReportIntoSections(consolidated),
      });

      setPipelineState((prev) => ({
        ...prev,
        mode: 'complete',
        completedAt: new Date(),
      }));
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
      phase2Error: undefined,
      phase3Error: undefined,
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
    const hasWarnings = Boolean(pipelineState.phase2Error || pipelineState.phase3Error);
    return (
      <div className="h-full flex flex-col">
        {hasWarnings && (
          <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-6 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs text-warning">
              <div className="font-medium mb-0.5">
                Reporte generado con advertencias
              </div>
              {pipelineState.phase2Error && (
                <p className="whitespace-pre-wrap break-words">
                  Auditoría regulatoria no disponible: {pipelineState.phase2Error}
                </p>
              )}
              {pipelineState.phase3Error && (
                <p className="whitespace-pre-wrap break-words">
                  Meta-auditoría de calidad no disponible: {pipelineState.phase3Error}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0">
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
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto styled-scrollbar">
      <PipelineMonitor state={pipelineState} />

      {error && (
        <div className="mx-6 my-4 rounded-lg border border-danger bg-danger/10 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-danger">Error en el pipeline</div>
            <p className="text-xs text-n-500 whitespace-pre-wrap break-words">{error}</p>
          </div>
        </div>
      )}

      {!pipelineInput && !isRunning && (
        <div className="flex-1 flex items-center justify-center text-sm text-n-400 px-6 text-center">
          No hay pipeline activo. Inicie un nuevo reporte desde &quot;Nueva Consulta&quot;.
        </div>
      )}

      {/* Live streaming preview */}
      {streamedContent && (
        <div className="flex-1 border-t border-n-200 px-8 py-6 overflow-y-auto styled-scrollbar">
          <h3 className="text-2xs font-bold text-n-400 uppercase tracking-wider mb-3 font-mono">
            Vista previa en tiempo real
          </h3>
          <StreamingText isStreaming={isRunning}>
            <div className="prose prose-sm max-w-none text-n-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {streamedContent}
              </ReactMarkdown>
            </div>
          </StreamingText>
        </div>
      )}

      {!streamedContent && isRunning && !error && (
        <div className="flex-1 flex items-center justify-center text-sm text-n-400">
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

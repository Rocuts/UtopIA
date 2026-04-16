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
import type { NiifReportIntake, PipelineState, FinancialReport, ReportSection } from '@/types/platform';

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

interface PipelineWorkspaceProps {
  intake?: NiifReportIntake;
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

function ReportViewer({ content, sections }: { content: string; sections: ReportSection[] }) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(`report-section-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="flex h-full">
      {/* Document navigation */}
      {sections.length > 0 && (
        <nav className="w-[200px] shrink-0 border-r border-[#e5e5e5] overflow-y-auto styled-scrollbar py-4 hidden lg:block">
          <h3 className="px-4 text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider mb-2 font-[family-name:var(--font-geist-mono)]">
            Contenido
          </h3>
          <ul className="space-y-0.5">
            {sections.map(s => (
              <li key={s.id}>
                <button
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
        <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e5] px-6 py-3 flex items-center gap-2 flex-wrap">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#D4A017] text-white text-xs font-medium hover:bg-[#A87C10] transition-colors">
            <Download className="w-3.5 h-3.5" />
            Descargar Excel .xlsx
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#e5e5e5] text-[#525252] text-xs font-medium hover:bg-[#fafafa] transition-colors">
            <FileText className="w-3.5 h-3.5" />
            Exportar PDF
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#e5e5e5] text-[#525252] text-xs font-medium hover:bg-[#fafafa] transition-colors">
            <Copy className="w-3.5 h-3.5" />
            Copiar Markdown
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#e5e5e5] text-[#525252] text-xs font-medium hover:bg-[#fafafa] transition-colors ml-auto">
            <RotateCcw className="w-3.5 h-3.5" />
            Nuevo Reporte
          </button>
        </div>

        {/* Report content */}
        <div className="px-8 py-6 max-w-4xl mx-auto">
          <div className="prose prose-sm max-w-none text-[#0a0a0a] prose-headings:text-[#0a0a0a] prose-headings:font-semibold prose-p:leading-relaxed prose-a:text-[#D4A017] prose-strong:text-[#0a0a0a] prose-table:border prose-table:border-[#e5e5e5] prose-th:bg-[#fafafa] prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:font-medium prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:border-t prose-td:border-[#f5f5f5]">
            {sections.length > 0 ? (
              sections.map(s => (
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
      </div>
    </div>
  );
}

export function PipelineWorkspace({ intake }: PipelineWorkspaceProps) {
  const { pipelineState } = useWorkspace();
  const [streamedContent, setStreamedContent] = useState('');
  const [report, setReport] = useState<FinancialReport | null>(null);
  const { language } = useLanguage();

  const isRunning = pipelineState.mode !== 'idle' && pipelineState.mode !== 'complete';
  const isComplete = pipelineState.mode === 'complete';

  if (isComplete && report) {
    return <ReportViewer content={report.content} sections={report.sections} />;
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto styled-scrollbar">
      <PipelineMonitor state={pipelineState} />

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

      {!streamedContent && isRunning && (
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

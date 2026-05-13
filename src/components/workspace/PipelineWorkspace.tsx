'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Download,
  FileText,
  Copy,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Check,
  Stethoscope,
  GitCompare,
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
import { RepairChat } from './repair/RepairChat';
import { ReportDiff } from './ReportDiff';
import type {
  ProvisionalFlag,
  Adjustment,
  AdjustmentLedger,
} from '@/lib/agents/repair/types';
import type {
  PipelineState,
  FinancialReport,
  ReportSection,
  QualityGrade,
  NiifReportIntake,
} from '@/types/platform';
import type {
  FinancialReport as BackendFinancialReport,
  FinancialProgressEvent,
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
} from '@/lib/agents/financial/types';
import type {
  AuditReport as BackendAuditReport,
  AuditProgressEvent,
  AuditDomain,
} from '@/lib/agents/financial/audit/types';
import type { QualityAssessment as BackendQualityAssessment } from '@/lib/agents/financial/quality/types';
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

// ─── Wave 3.F2 — orquestación cliente de los 3 endpoints split ────────────
// `runSSEPhase` envuelve `fetchSSEWithRetry + consumeSSE` para los 3 endpoints
// nuevos (`/niif`, `/strategy`, `/governance`). Cada endpoint emite el mismo
// canal `progress` (FinancialProgressEvent passthrough) y un evento nombrado
// específico cuyo payload acarrea el resultado. El helper centraliza el
// patrón: una sola caja `{ value }` se llena desde el handler del evento
// específico, los progress events se propagan al UI, y los errores se
// re-lanzan con un mensaje contextualizado por sub-fase (Capa 3 — diagnóstico
// por fase concreta, no genérico "Phase 1 falló").
//
// `phaseLabel` se inyecta en el wrapper de error → el usuario ve "Strategy
// Director falló: <detail backend>" en vez del legacy "Phase 1 falló".
// ────────────────────────────────────────────────────────────────────────────

interface SubPhaseHandlers {
  /** Callback para FinancialProgressEvent (stage_start, stage_progress, stage_complete). */
  onProgress?: (evt: FinancialProgressEvent) => void;
}

async function runSSEPhase<T>(
  url: string,
  body: unknown,
  eventName: string,
  signal: AbortSignal,
  phaseLabel: string,
  handlers: SubPhaseHandlers = {},
): Promise<T> {
  const res = await fetchSSEWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `${phaseLabel} falló (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
    );
  }

  const box: { value: T | null } = { value: null };

  await consumeSSE(res, signal, {
    progress: (raw) => {
      handlers.onProgress?.(raw as FinancialProgressEvent);
    },
    [eventName]: (raw) => {
      box.value = raw as T;
    },
    error: (raw) => {
      const { detail } = raw as { detail?: string };
      // Contextualizamos el error con el nombre de la sub-fase. El backend ya
      // tradujo el error técnico (`toFriendlyError`); aquí solo prepondemos
      // qué fase fue la que falló para que la UI sepa qué reintentar.
      throw new Error(`${phaseLabel} falló: ${detail || 'error desconocido del backend'}`);
    },
  });

  if (box.value === null) {
    throw new Error(
      `${phaseLabel} no devolvió el evento '${eventName}' antes de cerrar el stream.`,
    );
  }

  return box.value;
}

// Reproduce el `buildConsolidatedReport` del orchestrator backend para que el
// cliente pueda ensamblar el Markdown final tras correr las 3 sub-fases. No es
// 100% idéntico al server-side: este cliente NO ejecuta `validateConsolidatedReport`,
// `provisionalWatermark`, ni `buildAdjustmentsAuditSection`. Esos validators viven
// solo en el endpoint legacy `/api/financial-report` (mantenido por compat con
// `/export`). Wave 4 los moverá a un endpoint `/consolidate` dedicado si el
// audit team detecta regresiones medibles.
function buildClientConsolidatedReport(
  company: CompanyInfo,
  niifContent: string,
  strategyContent: string,
  governanceContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'CONSOLIDATED FINANCIAL REPORT'
      : 'REPORTE FINANCIERO CONSOLIDADO';
  const subtitle =
    language === 'en'
      ? 'NIIF Elite Corporate Analysis'
      : 'Analisis Corporativo Elite NIIF';
  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Financial Orchestrator (3 Agentes Especializados) |

---

# PARTE I: ESTADOS FINANCIEROS NIIF
*Preparado por: Agente Analista Contable NIIF*

${niifContent}

---

# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES
*Preparado por: Agente Director de Estrategia Financiera*

${strategyContent}

---

# PARTE III: GOBIERNO CORPORATIVO Y DOCUMENTOS LEGALES
*Preparado por: Agente Especialista en Gobierno Corporativo*

${governanceContent}

---

> **Nota Legal:** Este reporte fue generado por 1+1, un sistema de inteligencia artificial. Las cifras, analisis y documentos legales deben ser validados por un Contador Publico certificado y un abogado antes de su uso oficial. 1+1 no reemplaza la asesoria profesional.
`;
}

// Stubs vacíos para `strategicAnalysis` y `governance` cuando se construye el
// checkpoint parcial post-NIIF. El tipo `BackendFinancialReport` exige ambos
// campos; los stubs permiten que el localStorage roundtrip funcione sin
// cambiar el contrato. La UI sabe que el reporte está incompleto vía
// `pipelineState.phase2Error` / banner explícito.
function emptyStrategy(): StrategicAnalysisResult {
  return {
    kpiDashboard: '',
    breakEvenAnalysis: '',
    projectedCashFlow: '',
    strategicRecommendations: '',
    fullContent: '',
  };
}
function emptyGovernance(): GovernanceResult {
  return {
    financialNotes: '',
    shareholderMinutes: '',
    fullContent: '',
  };
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
          <p className="text-xs text-n-600 mt-0.5 font-mono">
            <Clock className="w-3 h-3 inline mr-1" />
            {timeStr} · Tiempo estimado: 3-5 min
          </p>
        </div>
        <ProgressRing progress={overallProgress} size={48} strokeWidth={4} />
      </div>

      {/* Phase 1: Agents */}
      <div className="px-6 py-4">
        <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-3 font-mono">
          Fase 1 — Generacion de Reporte
        </h3>
        <div className="flex items-center gap-2 overflow-x-auto styled-scrollbar pb-2">
          {STAGE_LABELS.map((s, i) => (
            <div key={i} className="flex items-center">
              <StageNode index={i} state={state} label={s.label} sublabel={s.sublabel} />
              {i < STAGE_LABELS.length - 1 && (
                <ChevronRight className="w-5 h-5 text-n-500 mx-1 shrink-0" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Phase 2: Auditors */}
      <div className="px-6 py-4 border-t border-n-100">
        <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-3 font-mono">
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
        <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-2 font-mono">
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
          <div className="flex items-center gap-1.5 text-xs text-n-600">
            <div className="w-3 h-3 rounded-full border border-n-400" />
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
  /**
   * Reporte completo de auditoría (4 auditores) si el usuario activó la
   * Fase 2. Reenviado al endpoint /api/financial-report/export para que
   * el PDF editorial incluya AuditFindingsPage.
   */
  auditReport?: BackendAuditReport | null;
  /**
   * Reporte completo de meta-auditoría de calidad si el usuario activó la
   * Fase 3. Habilita QualityMetaAuditPage en el PDF editorial.
   */
  qualityReport?: BackendQualityAssessment | null;
  /**
   * Toggle del intake (10 entregables destildables). Se reenvía al export
   * endpoint para que EditorialReportDoc omita las páginas correspondientes.
   * Si null/undefined → el PDF incluye TODO (default histórico).
   */
  outputOptions?: NiifReportIntake['outputOptions'] | null;
  onReset?: () => void;
  onPatchReport?: (newConsolidatedMarkdown: string) => void;
  onTurnsChange?: (turns: ReportIterationTurn[]) => void;
  /**
   * Markdown del reporte ORIGINAL — capturado por el host antes de regenerar
   * con adjustments. Si esta presente, el viewer muestra un toggle "Ver
   * cambios" que abre `<ReportDiff>` comparando original vs `content`.
   */
  originalContent?: string | null;
  /**
   * Codigos PUC afectados por adjustments (vienen del adjustment ledger).
   * Se pasan al `<ReportDiff>` para subrayar las lineas que los mencionan.
   */
  affectedAccounts?: string[];
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
  auditReport,
  qualityReport,
  outputOptions,
  onReset,
  onPatchReport,
  onTurnsChange,
  originalContent,
  affectedAccounts,
}: ReportViewerProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  const [showDiff, setShowDiff] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Solo se ofrece el diff si el host capturo un reporte original distinto
  // del actual. Trim guard cubre el caso de tabs en blanco / saltos triviales.
  const hasDiff =
    typeof originalContent === 'string' &&
    originalContent.trim().length > 0 &&
    originalContent !== content;

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
  // POST /api/financial-report/export con { report, rawData, company,
  // language, format:'pdf-elite' } — el endpoint reutiliza el reporte que el
  // cliente ya tiene en estado (fast-path: sin re-correr los 3 agentes) y
  // responde con un .pdf editorial multipágina.
  //
  // Antes este botón llamaba window.print() y solo imprimía la primera página
  // porque el contenedor `flex-1 overflow-y-auto` ancestro hijacka el viewport
  // de impresión. Renderizar server-side con @react-pdf/renderer elimina ese
  // problema porque las páginas las define el documento, no el browser.
  const handleExportPdf = useCallback(async () => {
    if (!report || isExportingPdf) return;
    setIsExportingPdf(true);
    setExportError(null);
    try {
      const res = await fetch('/api/financial-report/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report,
          rawData,
          company,
          language,
          // Fase 2/3 — solo se envían si el usuario los activó. El endpoint
          // tolera null/undefined (las páginas se omiten en el render).
          auditReport: auditReport ?? null,
          qualityReport: qualityReport ?? null,
          // Toggle de los 10 entregables del intake. Si undefined el PDF
          // incluye todo (default). Si presente, EditorialReportDoc gatea
          // cada página según el flag correspondiente.
          outputOptions: outputOptions ?? null,
          format: 'pdf-elite',
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }

      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `Reporte_Editorial_${Date.now()}.pdf`;

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
          ? `No se pudo generar el PDF: ${msg}`
          : `Could not generate PDF: ${msg}`,
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [report, rawData, company, language, auditReport, qualityReport, outputOptions, isExportingPdf]);

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
          <h3 className="px-4 text-2xs font-bold text-n-700 uppercase tracking-wider mb-2 font-mono">
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
            onClick={handleExportPdf}
            disabled={isExportingPdf || !report}
            aria-label={language === 'es' ? 'Exportar a PDF editorial' : 'Export to editorial PDF'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
              isExportingPdf || !report
                ? 'border-n-200 text-n-400 cursor-not-allowed'
                : 'border-n-200 text-n-700 hover:bg-n-50 hover:text-n-1000',
            )}
          >
            {isExportingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {isExportingPdf
              ? language === 'es' ? 'Generando PDF...' : 'Generating PDF...'
              : language === 'es' ? 'Exportar PDF' : 'Export PDF'}
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
          {hasDiff && (
            <button
              type="button"
              onClick={() => setShowDiff((s) => !s)}
              aria-expanded={showDiff}
              aria-controls="report-diff-panel"
              aria-label={
                language === 'es'
                  ? 'Ver cambios respecto al reporte original'
                  : 'View changes from original report'
              }
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
                showDiff
                  ? 'border-gold-500 bg-gold-300/10 text-gold-700'
                  : 'border-n-200 text-n-600 hover:bg-n-50',
              )}
            >
              <GitCompare className="w-3.5 h-3.5" />
              {showDiff
                ? language === 'es' ? 'Ocultar cambios' : 'Hide changes'
                : language === 'es' ? 'Ver cambios' : 'View changes'}
            </button>
          )}
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

        {/* Diff panel — visible solo cuando el host capturo un reporte
            original (regen post-adjustments) y el usuario abre el toggle.
            Va inmediatamente debajo del action bar para que el contraste
            antes/cambios/despues sea inmediato visualmente. */}
        {hasDiff && showDiff && (
          <div id="report-diff-panel" className="mx-6 mt-3 mb-2 no-print">
            <ReportDiff
              before={originalContent ?? ''}
              after={content}
              affectedAccounts={affectedAccounts}
              language={language}
            />
          </div>
        )}

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
  // Fase 2/3 — reportes completos del audit y meta-auditor. Se llenan tras
  // las fases 2 y 3 si el usuario los activó. Antes solo guardábamos resumen
  // (findingCounts, grade, score), perdiendo el detalle que el PDF editorial
  // necesita para AuditFindingsPage + QualityMetaAuditPage.
  const [auditReport, setAuditReport] = useState<BackendAuditReport | null>(null);
  const [qualityReport, setQualityReport] = useState<BackendQualityAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRepair, setShowRepair] = useState(false);
  const [repairSeed, setRepairSeed] = useState<string | null>(null);
  // ─── Phase 3 (hook 3): diff visual antes/despues ──────────────────────────
  // Cuando el usuario regenera con adjustments via el Doctor, capturamos el
  // markdown del reporte ANTES del regen aqui. El ReportViewer expone un
  // toggle "Ver cambios" si este state esta poblado y difiere del actual.
  // Reseteado en handleReset.
  const [originalReport, setOriginalReport] = useState<string | null>(null);
  // Cuentas afectadas por los adjustments aplicados — pasadas al diff para
  // resaltar las lineas del reporte que las mencionan.
  const [diffAffectedAccounts, setDiffAffectedAccounts] = useState<string[]>([]);
  // Stable id for the repair chat session — regenerated each time a new error
  // surfaces so server-side telemetry can group attempts by error occurrence.
  const [repairConvId, setRepairConvId] = useState<string>('');
  const { language } = useLanguage();
  const lastProcessedInputRef = useRef<typeof pipelineInput>(null);

  // Repair chat lifecycle: tied to the presence of an error in the UI.
  // - new error  -> mint conv id, ensure chat starts collapsed
  // - error gone -> clear conv id and collapse chat
  useEffect(() => {
    if (error) {
      setRepairConvId((prev) =>
        prev || `repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
    } else {
      setRepairConvId('');
      setShowRepair(false);
    }
  }, [error]);

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
    const isRerun = lastProcessedInputRef.current !== null;
    lastProcessedInputRef.current = pipelineInput;
    setError(null);
    setReport(null);
    setStreamedContent('');
    // ITEM 4 ORDEN DE CIERRE — Reparación Fase 3 reconnection.
    // En re-runs (regenerateWithAdjustments / markProvisional / reintento), las
    // Fases 2 y 3 vuelven a correr — pero las fases anteriores dejaban estado
    // residual: `auditFindings`, `qualityGrade`, `qualityScore`, `auditReport`,
    // `qualityReport` seguían apuntando a la corrida ANTERIOR. El usuario veía
    // el "Score 95/100" estancado hasta que la nueva corrida terminaba 3 min
    // después. Aquí limpiamos TODO el estado audit + quality al inicio del
    // re-run para que la UI refleje el progreso correctamente.
    if (isRerun) {
      setAuditReport(null);
      setQualityReport(null);
      setPipelineState((prev) => ({
        ...prev,
        mode: 'running',
        currentStage: 1,
        completedStages: [],
        auditorsStarted: [],
        auditorsComplete: [],
        auditFindings: {},
        qualityGrade: undefined,
        qualityScore: undefined,
        phase2Error: undefined,
        phase3Error: undefined,
      }));
    }
    const controller = new AbortController();

    (async () => {
      // ─── Phase 1: Financial Report (CRÍTICA, ahora 3 sub-fases) ───────
      // Wave 3.F2: en lugar de UNA llamada monolítica a /api/financial-report
      // (que acumulaba 5-15 min y disparaba "network error" mid-stream en
      // producción), orquestamos 3 sub-fases secuenciales contra los endpoints
      // split por F1. Cada endpoint tiene su propio maxDuration=800s — los
      // timeouts ya no se suman.
      //
      // Checkpoint progresivo: tras NIIF persistimos un reporte parcial en
      // localStorage. Si /strategy o /governance fallan, el NIIF NO se pierde
      // y el usuario puede ver/exportar lo que tiene + reintentar la sub-fase
      // fallida. Diagnóstico por sub-fase: el mensaje de error indica
      // exactamente qué agente reventó (no genérico "Phase 1 falló").
      let phase1Report: BackendFinancialReport | null = null;
      let niifResult: NiifAnalysisResult | null = null;
      let strategyResult: StrategicAnalysisResult | null = null;
      let governanceResult: GovernanceResult | null = null;
      let niifContext: {
        bindingTotals: string;
        preprocessed: unknown;
        company: CompanyInfo;
      } | null = null;
      // Conv id estable para todo el ciclo: minted antes de la primera sub-fase
      // para que el checkpoint progresivo no rote ids entre updates.
      const nextConvId = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // The provisional flag may have been attached locally by the repair chat
      // (handleMarkProvisional) — it is not on the NiifReportIntake type yet
      // so we read it via a narrow lookup. The Backend agent extends the
      // /api/financial-report/niif request schema to accept it.
      // Phase 2: same pattern for `adjustmentLedger`, attached locally by
      // handleRegenerateWithAdjustments. Backend route accepts it as
      // optional and applies adjustments post-preprocessing.
      const intakeWithExtras = pipelineInput as NiifReportIntake & {
        provisional?: ProvisionalFlag;
        adjustmentLedger?: AdjustmentLedger;
      };
      const provisional = intakeWithExtras.provisional;
      const adjustmentLedger = intakeWithExtras.adjustmentLedger;

      // ITEM 5 ORDEN DE CIERRE — propagar T.P. + C.C. al backend si están
      // presentes en el intake. `companyExt` lookup defensivo: el shape del
      // intake del workspace todavía puede no declararlos (campos nuevos).
      const companyExt = pipelineInput.company as typeof pipelineInput.company & {
        legalRepresentativeId?: string;
        fiscalAuditorTp?: string;
        accountantTp?: string;
      };
      const companyBody = {
        name: pipelineInput.company.name,
        nit: pipelineInput.company.nit,
        entityType: pipelineInput.company.entityType,
        sector: pipelineInput.company.sector,
        city: pipelineInput.company.city,
        legalRepresentative: pipelineInput.company.legalRepresentative,
        legalRepresentativeId: companyExt.legalRepresentativeId,
        fiscalAuditor: pipelineInput.company.fiscalAuditor,
        fiscalAuditorTp: companyExt.fiscalAuditorTp,
        accountant: pipelineInput.company.accountant,
        accountantTp: companyExt.accountantTp,
        niifGroup: pipelineInput.niifGroup,
        fiscalPeriod: pipelineInput.fiscalPeriod,
        comparativePeriod: pipelineInput.comparativePeriod,
      };

      // Handler común de progress events para las 3 sub-fases — mantiene la
      // misma semántica que el legacy: stage_start/complete actualizan el
      // indicador del PipelineMonitor (1=NIIF, 2=Strategy, 3=Governance),
      // stage_progress alimenta la vista en vivo de streamedContent.
      const onSubPhaseProgress = (evt: FinancialProgressEvent) => {
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
      };

      // ─── Sub-fase 1.1: Analista NIIF ───────────────────────────────────
      // Si esta falla, no hay reporte que mostrar — abortamos y mostramos
      // error fatal. Las sub-fases 1.2/1.3 son recuperables vía checkpoint;
      // 1.1 no.
      try {
        const niifBody: Record<string, unknown> = {
          rawData: pipelineInput.rawData,
          company: companyBody,
          language,
          instructions: pipelineInput.specialInstructions,
          ...(provisional ? { provisional } : {}),
        };
        if (adjustmentLedger?.adjustments?.length) {
          niifBody.adjustmentLedger = adjustmentLedger;
        }

        const niifPayload = await runSSEPhase<{
          niif: NiifAnalysisResult;
          context: { bindingTotals: string; preprocessed: unknown; company: CompanyInfo };
        }>(
          '/api/financial-report/niif',
          niifBody,
          'niif_phase',
          controller.signal,
          'Analista NIIF',
          { onProgress: onSubPhaseProgress },
        );

        niifResult = niifPayload.niif;
        niifContext = niifPayload.context;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        setError(msg);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
        return;
      }

      // ─── CHECKPOINT 1: persistir NIIF parcial ANTES de strategy/governance ─
      // A partir de aquí, aunque la red se caiga y el usuario recargue, el
      // reporte NIIF vive en localStorage. Los stubs vacíos para
      // strategicAnalysis/governance permiten que el contrato BackendFinancialReport
      // se mantenga sin opcional-explosion; la UI muestra el reporte parcial
      // con un banner "Strategy/Governance pendiente — reintenta".
      const partialConsolidated = buildClientConsolidatedReport(
        niifContext.company,
        niifResult.fullContent,
        '',
        '',
        language,
      );
      const partialReport: BackendFinancialReport = {
        company: niifContext.company,
        niifAnalysis: niifResult,
        strategicAnalysis: emptyStrategy(),
        governance: emptyGovernance(),
        consolidatedReport: partialConsolidated,
        generatedAt: new Date().toISOString(),
      };
      setBackendReport(partialReport);
      setRawData(pipelineInput.rawData);
      setCompanyInfo(niifContext.company);
      setConversationId(nextConvId);
      setInitialTurns([]);
      setLastCompletedReport({
        report: partialReport,
        rawData: pipelineInput.rawData,
        company: niifContext.company,
        conversationId: nextConvId,
        turns: [],
      });

      // ─── Sub-fase 1.2: Director de Estrategia ──────────────────────────
      // Si esta falla, persiste el checkpoint NIIF y el pipeline continúa
      // hasta que el usuario decida reintentar. Marcamos `phase2Error` con
      // el mensaje específico de la sub-fase para que el banner lo muestre.
      try {
        const strategyBody = {
          niifResult,
          bindingTotals: niifContext.bindingTotals,
          preprocessed: niifContext.preprocessed,
          company: niifContext.company,
          language,
          instructions: pipelineInput.specialInstructions,
        };

        const strategyPayload = await runSSEPhase<{ strategy: StrategicAnalysisResult }>(
          '/api/financial-report/strategy',
          strategyBody,
          'strategy_phase',
          controller.signal,
          'Director de Estrategia',
          { onProgress: onSubPhaseProgress },
        );

        strategyResult = strategyPayload.strategy;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        // Sub-fase 1.2 falló — el NIIF parcial sigue persistido. Mostramos el
        // error como fatal de Fase 1 (no quedó reporte completo) pero NO
        // borramos el checkpoint NIIF: el usuario verá el reporte parcial al
        // recargar y podrá reintentar.
        setError(msg);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
        return;
      }

      // ─── Sub-fase 1.3: Gobierno Corporativo ────────────────────────────
      try {
        const governanceBody = {
          niifResult,
          strategyResult,
          bindingTotals: niifContext.bindingTotals,
          preprocessed: niifContext.preprocessed,
          company: niifContext.company,
          language,
          instructions: pipelineInput.specialInstructions,
        };

        const governancePayload = await runSSEPhase<{ governance: GovernanceResult }>(
          '/api/financial-report/governance',
          governanceBody,
          'governance_phase',
          controller.signal,
          'Gobierno Corporativo',
          { onProgress: onSubPhaseProgress },
        );

        governanceResult = governancePayload.governance;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        setError(msg);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
        return;
      }

      // ─── Ensamblaje final: construir BackendFinancialReport completo ────
      // Las 3 sub-fases corrieron OK. Reemplazamos los stubs del checkpoint
      // parcial con los resultados reales y reconstruimos el consolidatedReport
      // canónico (concatenación de los 3 fullContent — mismo formato que el
      // orchestrator legacy en `buildConsolidatedReport`).
      const fullConsolidated = buildClientConsolidatedReport(
        niifContext.company,
        niifResult.fullContent,
        strategyResult.fullContent,
        governanceResult.fullContent,
        language,
      );
      phase1Report = {
        company: niifContext.company,
        niifAnalysis: niifResult,
        strategicAnalysis: strategyResult,
        governance: governanceResult,
        consolidatedReport: fullConsolidated,
        generatedAt: new Date().toISOString(),
      };

      // ─── CHECKPOINT 2: actualizar reporte completo en localStorage ──────
      setBackendReport(phase1Report);
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
            // Conservar el reporte completo para que el botón Exportar PDF
            // pueda incluir AuditFindingsPage con los 4 auditores + hallazgos.
            setAuditReport(phase2Report);
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
          // Tipamos como QualityAssessment completo — antes solo extraíamos
          // {grade, score}, descartando dimensiones / IFRS18 / ISO 25012 /
          // ISO 42001. Ese detalle es necesario para QualityMetaAuditPage.
          const quality = await fetchJSONWithRetry<BackendQualityAssessment>(
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
            qualityGrade: quality.grade as QualityGrade,
            qualityScore: quality.overallScore,
          }));
          setQualityReport(quality);
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
    setShowRepair(false);
    setRepairConvId('');
    setOriginalReport(null);
    setDiffAffectedAccounts([]);
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

  // ─── Repair chat: mark provisional ───────────────────────────────────────
  // Triggered by RepairChat when the agent decides (via `mark_provisional`
  // tool) that the user wants to bypass the validator hard-fail. We reset
  // error state and re-trigger the pipeline by minting a NEW input object
  // (carries the override flag). The effect on `pipelineInput` re-fires
  // because `lastProcessedInputRef` no longer matches the new reference.
  const handleMarkProvisional = useCallback(
    (reason: string) => {
      setShowRepair(false);
      setError(null);
      if (!pipelineInput) return;
      const provisional: ProvisionalFlag = { active: true, reason };
      // The shared NiifReportIntake type does not yet declare `provisional` —
      // we attach it locally and the api/financial-report route reads it via
      // its own (Backend-agent-extended) request schema. Cast at the boundary
      // to avoid mutating the global type from this file.
      const next = { ...pipelineInput, provisional } as NiifReportIntake;
      setPipelineInput(next);
    },
    [pipelineInput, setPipelineInput],
  );

  // ─── Repair chat: regenerate with applied adjustments (Phase 2) ──────────
  // Triggered by RepairChat when the user has confirmed at least one
  // adjustment via the inline propose/apply UI. The component already
  // filters to `status === 'applied'` before invoking this callback.
  //
  // Mutual exclusion with `provisional`: applying real adjustments supersedes
  // the provisional override — there is no need to mark a report as
  // provisional if the user has actually repaired the data. We therefore
  // CLEAR `provisional` when re-running with adjustments. (If the user later
  // wants to bypass validation again, the repair chat can re-emit it.)
  const handleRegenerateWithAdjustments = useCallback(
    (applied: Adjustment[]) => {
      if (!pipelineInput) return;
      setShowRepair(false);
      setRepairSeed(null);
      setError(null);
      // ─── Phase 3 hook 3: capturar reporte original ANTES del regen ─────
      // El reporte vivo puede venir de dos lugares dependiendo de si hubo
      // un patch del chat de seguimiento: prefer backend.consolidatedReport
      // (autoritativo, es lo que el backend ya emitio) y caer a report.content.
      // Si ninguno existe (caso raro: regenerando sin reporte previo), no
      // capturamos — el toggle de diff simplemente no aparecera.
      const previousMarkdown =
        backendReport?.consolidatedReport ?? report?.content ?? null;
      if (previousMarkdown && previousMarkdown.trim().length > 0) {
        setOriginalReport(previousMarkdown);
      }
      // Cuentas afectadas — codigos PUC unicos del set aplicado, para que
      // el diff las pueda resaltar.
      setDiffAffectedAccounts(
        Array.from(new Set(applied.map((a) => a.accountCode).filter(Boolean))),
      );
      // Mint a NEW reference so the pipeline effect re-fires (it compares
      // identity against `lastProcessedInputRef.current`).
      const next = {
        ...pipelineInput,
        adjustmentLedger: { adjustments: applied },
        provisional: undefined,
      } as NiifReportIntake & {
        adjustmentLedger: AdjustmentLedger;
        provisional?: ProvisionalFlag;
      };
      setPipelineInput(next);
    },
    [pipelineInput, setPipelineInput, backendReport, report],
  );

  // ─── "Continuar de todas formas" shortcut ────────────────────────────────
  const handleContinueAnyway = useCallback(() => {
    setRepairSeed(
      language === 'es'
        ? 'Quiero generar el reporte como borrador a pesar del error de validación. Confirma el override y procede.'
        : 'I want to generate the report as a draft despite the validation error. Confirm the override and proceed.',
    );
    setShowRepair(true);
  }, [language]);

  const handleToggleRepair = useCallback(() => {
    setShowRepair((s) => {
      // Si abrimos el chat manualmente (no via "Continuar de todas formas"),
      // limpiamos el seed para no auto-enviar mensaje no deseado.
      if (!s) setRepairSeed(null);
      return !s;
    });
  }, []);

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
            auditReport={auditReport}
            qualityReport={qualityReport}
            outputOptions={pipelineInput?.outputOptions ?? null}
            onReset={handleReset}
            onPatchReport={handlePatchReport}
            onTurnsChange={handleTurnsChange}
            originalContent={originalReport}
            affectedAccounts={diffAffectedAccounts}
          />
        </div>
      </div>
    );
  }

  // Phase 2 visual indicator: when the pipeline is running with applied
  // adjustments, show a thin banner so the user knows the regeneration was
  // not a fresh run. Read via the same narrow lookup used in the fetch.
  const adjustmentLedger = (pipelineInput as
    | (NiifReportIntake & { adjustmentLedger?: AdjustmentLedger })
    | null)?.adjustmentLedger;
  const adjustmentCount = adjustmentLedger?.adjustments?.length ?? 0;
  const isRegeneratingWithAdjustments = isRunning && adjustmentCount > 0;

  return (
    <div className="h-full flex flex-col overflow-y-auto styled-scrollbar">
      {isRegeneratingWithAdjustments && (
        <div className="shrink-0 border-b border-gold-500/30 bg-gold-300/10 px-6 py-2 flex items-center gap-2 text-xs text-gold-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="font-medium">
            {language === 'es'
              ? `Regenerando con ${adjustmentCount} ajuste${adjustmentCount === 1 ? '' : 's'} aplicado${adjustmentCount === 1 ? '' : 's'}`
              : `Regenerating with ${adjustmentCount} applied adjustment${adjustmentCount === 1 ? '' : 's'}`}
          </span>
        </div>
      )}

      <PipelineMonitor state={pipelineState} />

      {error && (
        <div className="mx-6 my-4 rounded-lg border border-danger bg-danger/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-danger">
                {language === 'es' ? 'Error en el pipeline' : 'Pipeline error'}
              </div>
              <p className="text-xs text-n-700 whitespace-pre-wrap break-words">{error}</p>

              {/* Action footer — repair chat toggle + continue-anyway shortcut. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleRepair}
                  aria-expanded={showRepair}
                  aria-controls="repair-chat-panel"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
                >
                  <Stethoscope className="w-3.5 h-3.5" />
                  {showRepair
                    ? language === 'es' ? 'Cerrar chat' : 'Close chat'
                    : language === 'es' ? 'Hablar con El Doctor' : 'Talk to the Doctor'}
                  {showRepair ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleContinueAnyway}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-700 text-xs font-medium hover:bg-n-50 transition-colors"
                >
                  {language === 'es' ? 'Continuar de todas formas' : 'Continue anyway'}
                </button>
              </div>
            </div>
          </div>

          {showRepair && pipelineInput && (
            <div id="repair-chat-panel" className="mt-3">
              <RepairChat
                context={{
                  errorMessage: error,
                  rawCsv: pipelineInput.rawData ?? null,
                  language,
                  companyName: pipelineInput.company?.name,
                  period: pipelineInput.fiscalPeriod,
                  conversationId: repairConvId,
                }}
                onMarkProvisional={handleMarkProvisional}
                onRegenerateWithAdjustments={handleRegenerateWithAdjustments}
                onClose={() => {
                  setShowRepair(false);
                  setRepairSeed(null);
                }}
                language={language}
                initialUserMessage={repairSeed ?? undefined}
                // Phase 3 P1 fix #4: el provisional flag vive en el pipelineInput
                // como campo runtime (no declarado en NiifReportIntake). Lo
                // pasamos al chat para que el autosave del hook lo persista en DB.
                provisional={
                  (pipelineInput as NiifReportIntake & { provisional?: ProvisionalFlag })
                    ?.provisional ?? null
                }
              />
            </div>
          )}
        </div>
      )}

      {!pipelineInput && !isRunning && (
        <div className="flex-1 flex items-center justify-center text-sm text-n-600 px-6 text-center">
          No hay pipeline activo. Inicie un nuevo reporte desde &quot;Nueva Consulta&quot;.
        </div>
      )}

      {/* Live streaming preview */}
      {streamedContent && (
        <div className="flex-1 border-t border-n-200 px-8 py-6 overflow-y-auto styled-scrollbar">
          <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-3 font-mono">
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
        <div className="flex-1 flex items-center justify-center text-sm text-n-600">
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

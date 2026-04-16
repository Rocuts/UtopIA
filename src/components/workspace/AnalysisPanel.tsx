'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronDown,
  Sparkles,
  BookOpen,
  FileText,
  FileDown,
  FileSpreadsheet,
  Copy,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
  Shield,
  Scale,
  Gavel,
  Building2,
  Eye,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import { RiskMeter, ScoreGauge, DSBadge, FindingCard, CitationBadge, ProgressRing } from '@/design-system';
import { Button } from '@/components/ui/Button';
import type {
  CaseType,
  AuditFinding,
  AuditSeverity,
  AuditDomain,
  Citation,
  QualityDimension,
} from '@/types/platform';
import type { RiskAssessmentData, UploadedDocument as WorkspaceUploadedDoc } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const SEVERITY_ORDER: AuditSeverity[] = ['critico', 'alto', 'medio', 'bajo', 'informativo'];

const SEVERITY_COLORS: Record<AuditSeverity, string> = {
  critico: '#EF4444',
  alto: '#F97316',
  medio: '#F59E0B',
  bajo: '#22C55E',
  informativo: '#3B82F6',
};

const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  critico: 'Critico',
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  informativo: 'Info',
};

const DOMAIN_ICONS: Record<AuditDomain, React.ComponentType<{ className?: string }>> = {
  niif: Building2,
  tributario: Scale,
  legal: Gavel,
  revisoria: Eye,
};

const DOMAIN_LABELS: Record<AuditDomain, string> = {
  niif: 'NIIF',
  tributario: 'Tributario',
  legal: 'Legal',
  revisoria: 'Revisoria Fiscal',
};

const CASE_TYPE_LABELS: Record<CaseType, string> = {
  general_chat: 'Chat General',
  dian_defense: 'Defensa DIAN',
  tax_refund: 'Devolucion de Saldos',
  due_diligence: 'Due Diligence',
  financial_intel: 'Inteligencia Financiera',
  niif_report: 'Reporte NIIF',
  tax_planning: 'Planeacion Tributaria',
  transfer_pricing: 'Precios de Transferencia',
  business_valuation: 'Valoracion Empresarial',
  fiscal_audit_opinion: 'Dictamen Rev. Fiscal',
  tax_reconciliation: 'Conciliacion Fiscal',
  feasibility_study: 'Estudio de Factibilidad',
};

// Quick reference citations per case type
const CASE_TYPE_CITATIONS: Record<CaseType, Citation[]> = {
  general_chat: [
    { article: 'Art. 641 E.T.', source: 'Estatuto Tributario', normText: 'Sancion por extemporaneidad en la presentacion de declaraciones tributarias.' },
    { article: 'NIC 1', source: 'NIIF / IAS', normText: 'Presentacion de estados financieros de proposito general.' },
  ],
  dian_defense: [
    { article: 'Art. 705 E.T.', source: 'Estatuto Tributario', normText: 'Termino para notificar el requerimiento especial. El requerimiento debera notificarse dentro de los tres (3) anos siguientes a la fecha de vencimiento del plazo para declarar.' },
    { article: 'Art. 703 E.T.', source: 'Estatuto Tributario', normText: 'El requerimiento especial como requisito previo a la liquidacion de revision.' },
    { article: 'Art. 720 E.T.', source: 'Estatuto Tributario', normText: 'Recurso de reconsideracion. Sin perjuicio de lo dispuesto en normas especiales, contra las liquidaciones oficiales, resoluciones que impongan sanciones, u ordenen el reintegro de sumas devueltas, procede el recurso de reconsideracion.' },
    { article: 'Art. 641 E.T.', source: 'Estatuto Tributario', normText: 'Extemporaneidad en la presentacion. Las personas obligadas a declarar que presenten las declaraciones tributarias en forma extemporanea, deberan liquidar y pagar una sancion por cada mes o fraccion de mes calendario de retardo.' },
  ],
  tax_refund: [
    { article: 'Art. 850 E.T.', source: 'Estatuto Tributario', normText: 'Devoluciones de saldos a favor. Los contribuyentes o responsables que liquiden saldos a favor en sus declaraciones tributarias podran solicitar su devolucion.' },
    { article: 'Art. 854 E.T.', source: 'Estatuto Tributario', normText: 'Termino para efectuar la devolucion. La Administracion de Impuestos debera devolver, previa las compensaciones a que haya lugar, los saldos a favor originados en los impuestos sobre la renta y complementarios y sobre las ventas.' },
    { article: 'Art. 857 E.T.', source: 'Estatuto Tributario', normText: 'Rechazo e inadmision de las solicitudes de devolucion o compensacion.' },
  ],
  due_diligence: [
    { article: 'NIC 1', source: 'NIIF / IAS', normText: 'Presentacion de estados financieros. Establece las bases para la presentacion de los estados financieros de proposito general.' },
    { article: 'NIIF 3', source: 'NIIF / IFRS', normText: 'Combinaciones de negocios. Mejorar la relevancia, la fiabilidad y la comparabilidad de la informacion sobre combinaciones de negocios.' },
    { article: 'Art. 260-1 E.T.', source: 'Estatuto Tributario', normText: 'Criterio de vinculacion para efectos del regimen de precios de transferencia.' },
  ],
  financial_intel: [
    { article: 'NIC 7', source: 'NIIF / IAS', normText: 'Estado de flujos de efectivo. Suministrar informacion sobre los cambios historicos en el efectivo y equivalentes al efectivo de una entidad.' },
    { article: 'NIC 36', source: 'NIIF / IAS', normText: 'Deterioro del valor de los activos. Procedimientos para asegurar que los activos no esten contabilizados a un importe superior a su valor recuperable.' },
    { article: 'NIIF 13', source: 'NIIF / IFRS', normText: 'Medicion del valor razonable. Define valor razonable, establece un marco para su medicion y requiere informacion a revelar.' },
  ],
  niif_report: [
    { article: 'NIC 1', source: 'NIIF / IAS', normText: 'Presentacion de estados financieros. Establece las bases para la presentacion de los estados financieros de proposito general.' },
    { article: 'NIC 8', source: 'NIIF / IAS', normText: 'Politicas contables, cambios en estimaciones contables y errores.' },
    { article: 'Dec. 2420/2015', source: 'Decreto', normText: 'Decreto Unico Reglamentario de las Normas de Contabilidad, de Informacion Financiera y de Aseguramiento de la Informacion.' },
  ],
  tax_planning: [
    { article: 'Art. 240 E.T.', source: 'Estatuto Tributario', normText: 'Tarifa general del impuesto sobre la renta para personas juridicas: 35% (2026).' },
    { article: 'Arts. 903-916 E.T.', source: 'Estatuto Tributario', normText: 'Regimen SIMPLE de Tributacion. Regimen alternativo voluntario que integra renta, ICA y consumo.' },
    { article: 'Art. 256 E.T.', source: 'Estatuto Tributario', normText: 'Descuento por inversiones en investigacion, desarrollo tecnologico e innovacion (30%).' },
  ],
  transfer_pricing: [
    { article: 'Art. 260-1 E.T.', source: 'Estatuto Tributario', normText: 'Criterio de vinculacion para efectos del regimen de precios de transferencia.' },
    { article: 'Art. 260-2 E.T.', source: 'Estatuto Tributario', normText: 'Principio de plena competencia (arm\'s length) en operaciones con vinculados.' },
    { article: 'Art. 260-5 E.T.', source: 'Estatuto Tributario', normText: 'Documentacion comprobatoria obligatoria para precios de transferencia.' },
  ],
  business_valuation: [
    { article: 'NIIF 13', source: 'NIIF / IFRS', normText: 'Medicion del valor razonable. Define valor razonable, establece un marco para su medicion con jerarquia de 3 niveles.' },
    { article: 'NIC 36', source: 'NIIF / IAS', normText: 'Deterioro del valor de los activos. Valor recuperable = max(valor razonable - costos de venta, valor en uso).' },
    { article: 'Art. 90 E.T.', source: 'Estatuto Tributario', normText: 'Determinacion del valor comercial de bienes para efectos fiscales. Desviacion > 15% permite ajuste DIAN.' },
  ],
  fiscal_audit_opinion: [
    { article: 'NIA 700', source: 'Normas Internacionales de Auditoria', normText: 'Formacion de la opinion y emision del informe de auditoria sobre los estados financieros.' },
    { article: 'Art. 207 C.Co.', source: 'Codigo de Comercio', normText: 'Funciones del revisor fiscal: 10 funciones estatutarias obligatorias.' },
    { article: 'Ley 43/1990', source: 'Ley', normText: 'Reglamentacion de la profesion de contador publico. Requisitos, deberes y sanciones.' },
  ],
  tax_reconciliation: [
    { article: 'Art. 772-1 E.T.', source: 'Estatuto Tributario', normText: 'Conciliacion fiscal. Los contribuyentes obligados a llevar contabilidad deben conciliar las diferencias entre la aplicacion de los marcos tecnicos normativos contables y las disposiciones del Estatuto Tributario.' },
    { article: 'NIC 12', source: 'NIIF / IAS', normText: 'Impuesto a las ganancias. Tratamiento contable del impuesto corriente y diferido generado por diferencias temporarias.' },
    { article: 'Formato 2516', source: 'DIAN', normText: 'Reporte de conciliacion fiscal para personas juridicas. Transmision electronica obligatoria si ingresos >= 45,000 UVT.' },
  ],
  feasibility_study: [
    { article: 'Ley 2069/2020', source: 'Ley', normText: 'Ley de Emprendimiento. Marco regulatorio para el crecimiento, consolidacion y sostenibilidad de empresas.' },
    { article: 'Ley 590/2000', source: 'Ley', normText: 'Clasificacion MIPYME: micro (<= 10 trabajadores), pequena (11-50), mediana (51-200).' },
    { article: 'Art. 240-1 E.T.', source: 'Estatuto Tributario', normText: 'Tarifa para usuarios de zona franca: 20% sobre renta liquida gravable.' },
  ],
};

const WELCOME_CITATIONS: Citation[] = [
  { article: 'Art. 641 E.T.', source: 'Estatuto Tributario', normText: 'Sancion por extemporaneidad en la presentacion de declaraciones tributarias.' },
  { article: 'Art. 647 E.T.', source: 'Estatuto Tributario', normText: 'Sancion por inexactitud. Constituye inexactitud sancionable la omision de ingresos, de impuestos generados por las operaciones gravadas, de bienes o actuaciones susceptibles de gravamen.' },
  { article: 'NIC 1', source: 'NIIF / IAS', normText: 'Presentacion de estados financieros. Establece las bases generales para la presentacion de los estados financieros de proposito general.' },
];

// ---------------------------------------------------------------------------
// Backward-compat props interface (layout still passes these)
// ---------------------------------------------------------------------------

interface AnalysisPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  riskAssessment: RiskAssessmentData | null;
  uploadedDocuments: WorkspaceUploadedDoc[];
  onRemoveDocument?: (filename: string) => void;
  onExportPDF?: () => void;
  onClearConversation?: () => void;
  language: 'es' | 'en';
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
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
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-3.5 h-3.5 text-[#a3a3a3]" />
        </motion.span>
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
// Elapsed Time Counter
// ---------------------------------------------------------------------------

function ElapsedTimer({ startedAt }: { startedAt: Date }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <span className="text-[10px] font-[family-name:var(--font-geist-mono)] text-[#a3a3a3] flex items-center gap-1">
      <Clock className="w-3 h-3" />
      {minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Stage Dots
// ---------------------------------------------------------------------------

function StageDots({
  stageLabels,
  completedStages,
  currentStage,
  mode,
}: {
  stageLabels: string[];
  completedStages: number[];
  currentStage: number;
  mode: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {stageLabels.map((label, i) => {
        const isComplete = completedStages.includes(i);
        const isActive = mode === 'running' && currentStage === i;
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="relative">
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-full bg-[#d4a017]"
                  animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
              <div
                className={cn(
                  'w-3 h-3 rounded-full border-2 transition-colors',
                  isComplete
                    ? 'bg-[#22c55e] border-[#22c55e]'
                    : isActive
                      ? 'bg-[#d4a017] border-[#d4a017]'
                      : 'bg-[#f5f5f5] border-[#e5e5e5]',
                )}
              />
            </div>
            <span className="text-[8px] text-[#a3a3a3] max-w-[60px] text-center leading-tight truncate">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auditor Dots
// ---------------------------------------------------------------------------

function AuditorDots({
  auditorsStarted,
  auditorsComplete,
}: {
  auditorsStarted: string[];
  auditorsComplete: string[];
}) {
  const auditorKeys: AuditDomain[] = ['niif', 'tributario', 'legal', 'revisoria'];
  return (
    <div className="flex items-center gap-1.5">
      {auditorKeys.map(key => {
        const started = auditorsStarted.includes(key);
        const complete = auditorsComplete.includes(key);
        return (
          <div key={key} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-colors',
                complete
                  ? 'bg-[#22c55e]'
                  : started
                    ? 'bg-[#f59e0b] animate-pulse'
                    : 'bg-[#e5e5e5]',
              )}
            />
            <span className="text-[8px] text-[#a3a3a3]">{DOMAIN_LABELS[key].slice(0, 4)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity Summary Bar
// ---------------------------------------------------------------------------

function SeveritySummary({ summary }: { summary: Record<AuditSeverity, number> }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {SEVERITY_ORDER.map(sev => {
        const count = summary[sev] ?? 0;
        if (count === 0) return null;
        return (
          <div key={sev} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: SEVERITY_COLORS[sev] }}
            />
            <span className="text-[10px] text-[#525252] font-[family-name:var(--font-geist-mono)]">
              {count} {SEVERITY_LABELS[sev]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document Status Icon
// ---------------------------------------------------------------------------

function DocStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'ready':
    case 'indexed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-[#22c55e] shrink-0" />;
    case 'processing':
    case 'uploading':
      return <Loader2 className="w-3.5 h-3.5 text-[#d4a017] shrink-0 animate-spin" />;
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />;
    default:
      return <FileText className="w-3.5 h-3.5 text-[#a3a3a3] shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// AnalysisPanel (main export)
// ---------------------------------------------------------------------------

export function AnalysisPanel({
  isOpen,
  onToggle,
  riskAssessment,
  uploadedDocuments,
  onRemoveDocument,
  onExportPDF,
  onClearConversation,
  language: propLanguage,
}: AnalysisPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { language } = useLanguage();

  // Pull state from workspace context
  const {
    activeCaseType,
    activeMode,
    pipelineState,
    intelligencePanelData,
    intakeModalOpen,
    uploadedDocuments: contextDocs,
  } = useWorkspace();

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

  // ── Determine which state to render ──────────────────────────────────────

  const currentState = useMemo(() => {
    // STATE 7: Pipeline complete
    if (pipelineState.mode === 'complete') return 'pipeline_complete';
    // STATE 6: Pipeline running/auditing/quality
    if (pipelineState.mode !== 'idle') return 'pipeline_running';
    // STATE 5: Chat response complete (has intelligence data)
    if (
      activeMode === 'chat' &&
      (intelligencePanelData.riskLevel ||
        intelligencePanelData.citations.length > 0 ||
        intelligencePanelData.findings.length > 0)
    ) {
      return 'chat_response';
    }
    // STATE 4: During chat (streaming) -- when in chat mode but no response data yet
    if (activeMode === 'chat' && activeCaseType) return 'chat_active';
    // STATE 3: During intake
    if (intakeModalOpen || activeMode === 'intake') return 'intake';
    // STATE 2: Case type selected but no active case
    if (activeCaseType) return 'case_selected';
    // STATE 1: Welcome
    return 'welcome';
  }, [activeCaseType, activeMode, pipelineState.mode, intelligencePanelData, intakeModalOpen]);

  // ── Computed data ────────────────────────────────────────────────────────

  const riskLevelMapped = useMemo(() => {
    if (intelligencePanelData.riskLevel) return intelligencePanelData.riskLevel;
    if (riskAssessment) {
      const MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
        critico: 'critical',
        alto: 'high',
        medio: 'medium',
        bajo: 'low',
      };
      return MAP[riskAssessment.level] ?? 'low';
    }
    return undefined;
  }, [intelligencePanelData.riskLevel, riskAssessment]);

  const riskScore = intelligencePanelData.riskScore ?? riskAssessment?.score ?? 0;

  const riskFactors = useMemo(() => {
    if (intelligencePanelData.riskFactors) return intelligencePanelData.riskFactors;
    if (riskAssessment?.factors) {
      return riskAssessment.factors.map(f => ({
        description: f.description,
        points: f.severity === 'alto' || f.severity === 'high' ? 3 : f.severity === 'medio' || f.severity === 'medium' ? 2 : 1,
      }));
    }
    return [];
  }, [intelligencePanelData.riskFactors, riskAssessment]);

  const findingsByDomain = useMemo(() => {
    const grouped: Partial<Record<AuditDomain, AuditFinding[]>> = {};
    for (const f of intelligencePanelData.findings) {
      if (!grouped[f.domain]) grouped[f.domain] = [];
      grouped[f.domain]!.push(f);
    }
    return grouped;
  }, [intelligencePanelData.findings]);

  const pipelineProgress = useMemo(() => {
    const totalSteps = pipelineState.stageLabels.length + 4 + 1; // agents + auditors + meta
    let done = pipelineState.completedStages.length;
    done += pipelineState.auditorsComplete.length;
    if (pipelineState.qualityGrade) done += 1;
    return Math.round((done / totalSteps) * 100);
  }, [pipelineState]);

  const handleCopyMarkdown = useCallback(() => {
    // Stub for markdown copy -- actual implementation connects to report content
    navigator.clipboard.writeText('Reporte copiado al portapapeles.');
  }, []);

  // ── Render helpers ───────────────────────────────────────────────────────

  function renderWelcome() {
    return (
      <div className="px-4 py-6 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-[#d4a017]" />
          <h3 className="text-sm font-medium text-[#0a0a0a]">Bienvenido</h3>
        </div>
        <p className="text-xs text-[#525252] leading-relaxed">
          Seleccione un tipo de consulta para ver informacion relevante. Este panel se actualizara en tiempo real a medida que interactue con la plataforma.
        </p>
        <div className="border-t border-[#e5e5e5] pt-3">
          <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-2">
            Referencias Rapidas
          </h4>
          <div className="space-y-1.5">
            {WELCOME_CITATIONS.map((c, i) => (
              <CitationBadge
                key={i}
                article={c.article}
                source={c.source}
                normText={c.normText}
                className="mr-1.5"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderCaseSelected() {
    if (!activeCaseType) return null;
    const citations = CASE_TYPE_CITATIONS[activeCaseType] ?? [];
    const isPipeline = activeCaseType === 'niif_report';

    return (
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#d4a017]" />
          <h3 className="text-sm font-medium text-[#0a0a0a]">
            {CASE_TYPE_LABELS[activeCaseType]}
          </h3>
        </div>

        {isPipeline && (
          <div className="bg-[#FEF9EC] border border-[#FBE08A] rounded-lg p-3 space-y-2">
            <h4 className="text-[10px] font-medium text-[#A87C10] uppercase tracking-wider">
              Pipeline de Agentes
            </h4>
            <ul className="space-y-1">
              <li className="text-xs text-[#525252] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#d4a017]" />
                Analista NIIF (estados financieros)
              </li>
              <li className="text-xs text-[#525252] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#d4a017]" />
                Director de Estrategia (KPIs, flujo)
              </li>
              <li className="text-xs text-[#525252] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#d4a017]" />
                Gobierno Corporativo (actas, notas)
              </li>
            </ul>
            <p className="text-[10px] text-[#a3a3a3]">
              + 4 auditores en paralelo + Meta-auditor de calidad
            </p>
          </div>
        )}

        <div>
          <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-2">
            Referencias Clave
          </h4>
          <div className="space-y-1.5">
            {citations.map((c, i) => (
              <CitationBadge
                key={i}
                article={c.article}
                source={c.source}
                normText={c.normText}
                className="mr-1.5"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderIntake() {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[#0ea5e9]" />
          <h3 className="text-sm font-medium text-[#0a0a0a]">Lo que analizaremos</h3>
        </div>
        <p className="text-xs text-[#525252] leading-relaxed">
          Complete el formulario de ingreso para que nuestros agentes de IA puedan preparar un analisis personalizado.
        </p>

        <div className="space-y-2">
          <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider">
            Capacidades habilitadas
          </h4>
          {[
            'Busqueda normativa en base documental',
            'Busqueda web en tiempo real',
            'Calculo de sanciones y plazos',
            'Evaluacion de nivel de riesgo',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-[#22c55e] shrink-0" />
              <span className="text-xs text-[#525252]">{item}</span>
            </div>
          ))}
        </div>

        {activeCaseType === 'niif_report' && (
          <div className="bg-[#f5f5f5] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider">
                Agentes estimados
              </span>
            </div>
            <p className="text-xs text-[#525252]">3 agentes secuenciales + 4 auditores paralelos</p>
            <p className="text-[10px] text-[#a3a3a3] mt-1">Tiempo estimado: 2-4 minutos</p>
          </div>
        )}

        {activeCaseType && activeCaseType !== 'niif_report' && (
          <div className="bg-[#f5f5f5] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider">
                Agentes estimados
              </span>
            </div>
            <p className="text-xs text-[#525252]">1-3 agentes segun complejidad (T1/T2/T3)</p>
            <p className="text-[10px] text-[#a3a3a3] mt-1">Tiempo estimado: 10-30 segundos</p>
          </div>
        )}
      </div>
    );
  }

  function renderChatActive() {
    return (
      <div className="px-4 py-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider">
              Actividad del Agente
            </h4>
          </div>

          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-[#d4a017] animate-spin" />
              <span className="text-xs text-[#525252]">Procesando consulta...</span>
            </div>
            <p className="text-[10px] text-[#a3a3a3]">
              Consultando base normativa y evaluando complejidad del caso.
            </p>
          </div>
        </div>

        {/* Tier explanation (collapsed) */}
        <CollapsibleSection
          title="Tiers de Procesamiento"
          icon={Info}
          defaultOpen={false}
        >
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <DSBadge variant="tier" tier="T1" label="T1" size="sm" />
              <span className="text-[10px] text-[#525252]">Respuesta directa, 1 llamada LLM</span>
            </div>
            <div className="flex items-start gap-2">
              <DSBadge variant="tier" tier="T2" label="T2" size="sm" />
              <span className="text-[10px] text-[#525252]">Especialista unico con herramientas</span>
            </div>
            <div className="flex items-start gap-2">
              <DSBadge variant="tier" tier="T3" label="T3" size="sm" />
              <span className="text-[10px] text-[#525252]">Multi-expertos en paralelo + sintesis</span>
            </div>
          </div>
        </CollapsibleSection>

        {/* Show references if case type selected */}
        {activeCaseType && (
          <div>
            <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-2">
              Referencias del Caso
            </h4>
            <div className="space-y-1.5">
              {(CASE_TYPE_CITATIONS[activeCaseType] ?? []).slice(0, 3).map((c, i) => (
                <CitationBadge
                  key={i}
                  article={c.article}
                  source={c.source}
                  normText={c.normText}
                  className="mr-1.5"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderChatResponse() {
    return (
      <>
        {/* Risk Assessment */}
        {riskLevelMapped && (
          <CollapsibleSection
            title="Riesgo"
            icon={AlertTriangle}
            defaultOpen
          >
            <div className="space-y-3">
              <RiskMeter score={riskScore} level={riskLevelMapped} />

              {riskFactors.length > 0 && (
                <CollapsibleSection
                  title="Factores de Riesgo"
                  icon={Info}
                  defaultOpen={false}
                  count={riskFactors.length}
                >
                  <ul className="space-y-1">
                    {riskFactors.map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[#525252]">
                        <span
                          className={cn(
                            'mt-1 w-1.5 h-1.5 rounded-full shrink-0',
                            f.points >= 3
                              ? 'bg-[#ef4444]'
                              : f.points >= 2
                                ? 'bg-[#f59e0b]'
                                : 'bg-[#22c55e]',
                          )}
                        />
                        {f.description}
                      </li>
                    ))}
                  </ul>
                </CollapsibleSection>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Citations */}
        {intelligencePanelData.citations.length > 0 && (
          <CollapsibleSection
            title="Referencias Normativas"
            icon={BookOpen}
            count={intelligencePanelData.citations.length}
          >
            <div className="space-y-1.5">
              {intelligencePanelData.citations.map((c, i) => (
                <CitationBadge
                  key={i}
                  article={c.article}
                  source={c.source}
                  normText={c.normText}
                  url={c.url}
                  className="mr-1.5"
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Uploaded Documents */}
        {uploadedDocuments.length > 0 && (
          <CollapsibleSection
            title="Documentos"
            icon={FileText}
            count={uploadedDocuments.length}
          >
            <div className="space-y-1.5">
              {uploadedDocuments.map((doc, i) => (
                <div
                  key={`${doc.filename}-${i}`}
                  className="flex items-center gap-2 p-2 bg-[#fafafa] rounded border border-[#e5e5e5]"
                >
                  <DocStatusIcon status={doc.chunks > 0 ? 'ready' : 'processing'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#0a0a0a] truncate">{doc.filename}</p>
                    <p className="text-[10px] text-[#a3a3a3]">
                      {(doc.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  {onRemoveDocument && (
                    <button
                      onClick={() => onRemoveDocument(doc.filename)}
                      className="p-1 text-[#a3a3a3] hover:text-[#ef4444] transition-colors"
                      aria-label={`Eliminar ${doc.filename}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </>
    );
  }

  function renderPipelineRunning() {
    return (
      <div className="px-4 py-4 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[#0a0a0a]">Pipeline NIIF</h3>
          {pipelineState.startedAt && (
            <ElapsedTimer startedAt={pipelineState.startedAt} />
          )}
        </div>

        {/* Overall progress */}
        <div className="flex items-center gap-3">
          <ProgressRing progress={pipelineProgress} size={48} strokeWidth={4} />
          <div>
            <p className="text-xs font-medium text-[#0a0a0a]">
              {pipelineState.mode === 'running' && 'Generando reporte...'}
              {pipelineState.mode === 'auditing' && 'Auditando...'}
              {pipelineState.mode === 'quality' && 'Evaluacion de calidad...'}
            </p>
            <p className="text-[10px] text-[#a3a3a3]">
              {pipelineState.mode === 'running' && `Etapa ${pipelineState.currentStage + 1} de ${pipelineState.stageLabels.length}`}
              {pipelineState.mode === 'auditing' && `${pipelineState.auditorsComplete.length}/4 auditores completos`}
              {pipelineState.mode === 'quality' && 'Meta-auditor evaluando calidad'}
            </p>
          </div>
        </div>

        {/* Agent stages */}
        <div>
          <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-2">
            Agentes de Reporte
          </h4>
          <StageDots
            stageLabels={pipelineState.stageLabels}
            completedStages={pipelineState.completedStages}
            currentStage={pipelineState.currentStage}
            mode={pipelineState.mode}
          />
        </div>

        {/* Auditor stages */}
        {(pipelineState.mode === 'auditing' || pipelineState.mode === 'quality') && (
          <div>
            <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-2">
              Auditores
            </h4>
            <AuditorDots
              auditorsStarted={pipelineState.auditorsStarted}
              auditorsComplete={pipelineState.auditorsComplete}
            />
          </div>
        )}

        {/* Meta-auditor indicator */}
        {pipelineState.mode === 'quality' && (
          <div className="flex items-center gap-2 p-2 bg-[#FEF9EC] border border-[#FBE08A] rounded-lg">
            <Loader2 className="w-3.5 h-3.5 text-[#d4a017] animate-spin" />
            <span className="text-xs text-[#A87C10]">Meta-auditor de calidad evaluando...</span>
          </div>
        )}
      </div>
    );
  }

  function renderPipelineComplete() {
    return (
      <>
        {/* Quality Score */}
        {intelligencePanelData.grade && (
          <CollapsibleSection
            title="Calidad del Reporte"
            icon={Sparkles}
            defaultOpen
          >
            <div className="flex flex-col items-center gap-3">
              <ScoreGauge
                grade={intelligencePanelData.grade}
                score={intelligencePanelData.qualityScore ?? 0}
                size="md"
              />
              <p className="text-[10px] text-[#a3a3a3] text-center">
                Calificacion general basada en 12 dimensiones de calidad
              </p>

              {/* 12 dimensions expander */}
              {intelligencePanelData.qualityDimensions && intelligencePanelData.qualityDimensions.length > 0 && (
                <CollapsibleSection
                  title="Ver 12 dimensiones"
                  icon={Info}
                  defaultOpen={false}
                  count={intelligencePanelData.qualityDimensions.length}
                >
                  <div className="space-y-2">
                    {intelligencePanelData.qualityDimensions.map((dim: QualityDimension, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-xs text-[#525252] flex-1 truncate">{dim.name}</span>
                        <span className="text-[10px] font-[family-name:var(--font-geist-mono)] text-[#a3a3a3]">
                          {dim.score}/{dim.maxScore}
                        </span>
                        <div className="w-12 h-1.5 rounded-full bg-[#f5f5f5] ml-2 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#d4a017]"
                            style={{ width: `${(dim.score / dim.maxScore) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Audit Findings Summary */}
        {intelligencePanelData.findings.length > 0 && (
          <CollapsibleSection
            title="Hallazgos de Auditoria"
            icon={AlertTriangle}
            count={intelligencePanelData.findings.length}
          >
            <div className="space-y-3">
              {/* Severity summary bar */}
              {intelligencePanelData.auditSummary && (
                <SeveritySummary summary={intelligencePanelData.auditSummary} />
              )}

              {/* Findings grouped by domain */}
              {(Object.keys(findingsByDomain) as AuditDomain[]).map(domain => {
                const domainFindings = findingsByDomain[domain];
                if (!domainFindings || domainFindings.length === 0) return null;
                const DomainIcon = DOMAIN_ICONS[domain];

                return (
                  <CollapsibleSection
                    key={domain}
                    title={DOMAIN_LABELS[domain]}
                    icon={DomainIcon}
                    defaultOpen={false}
                    count={domainFindings.length}
                  >
                    <div className="space-y-2">
                      {domainFindings.map((f, i) => (
                        <FindingCard key={`${f.code}-${i}`} finding={f} />
                      ))}
                    </div>
                  </CollapsibleSection>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Risk from pipeline */}
        {riskLevelMapped && (
          <CollapsibleSection
            title="Riesgo"
            icon={AlertTriangle}
            defaultOpen={false}
          >
            <RiskMeter score={riskScore} level={riskLevelMapped} />
          </CollapsibleSection>
        )}

        {/* Citations from pipeline */}
        {intelligencePanelData.citations.length > 0 && (
          <CollapsibleSection
            title="Referencias Normativas"
            icon={BookOpen}
            defaultOpen={false}
            count={intelligencePanelData.citations.length}
          >
            <div className="space-y-1.5">
              {intelligencePanelData.citations.map((c, i) => (
                <CitationBadge
                  key={i}
                  article={c.article}
                  source={c.source}
                  normText={c.normText}
                  url={c.url}
                  className="mr-1.5"
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Documents */}
        {uploadedDocuments.length > 0 && (
          <CollapsibleSection
            title="Documentos"
            icon={FileText}
            defaultOpen={false}
            count={uploadedDocuments.length}
          >
            <div className="space-y-1.5">
              {uploadedDocuments.map((doc, i) => (
                <div
                  key={`${doc.filename}-${i}`}
                  className="flex items-center gap-2 p-2 bg-[#fafafa] rounded border border-[#e5e5e5]"
                >
                  <DocStatusIcon status={doc.chunks > 0 ? 'ready' : 'processing'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#0a0a0a] truncate">{doc.filename}</p>
                    <p className="text-[10px] text-[#a3a3a3]">
                      {(doc.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </>
    );
  }

  // ── Footer actions ──────────────────────────────────────────────────────

  function renderFooter() {
    if (currentState === 'pipeline_complete') {
      return (
        <div className="px-4 py-3 border-t border-[#e5e5e5] shrink-0 space-y-2">
          <Button
            variant="accent"
            size="sm"
            className="w-full justify-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Descargar Excel .xlsx
          </Button>
          <Button
            onClick={onExportPDF}
            variant="secondary"
            size="sm"
            className="w-full justify-center gap-1.5"
          >
            <FileDown className="w-3.5 h-3.5" />
            Exportar PDF
          </Button>
          <Button
            onClick={handleCopyMarkdown}
            variant="ghost"
            size="sm"
            className="w-full justify-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            Copiar Markdown
          </Button>
        </div>
      );
    }

    return (
      <div className="px-4 py-3 border-t border-[#e5e5e5] shrink-0 space-y-2">
        {onExportPDF && (
          <Button
            onClick={onExportPDF}
            variant="secondary"
            size="sm"
            className="w-full justify-center gap-1.5"
          >
            <FileDown className="w-3.5 h-3.5" />
            Exportar PDF
          </Button>
        )}
        {onClearConversation && (
          <Button
            onClick={onClearConversation}
            variant="ghost"
            size="sm"
            className="w-full justify-center gap-1.5 text-[#ef4444] hover:text-[#ef4444] hover:bg-[#fef2f2]"
          >
            Limpiar conversacion
          </Button>
        )}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────

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
              'lg:static lg:w-[340px] lg:z-auto lg:shrink-0',
              'bg-white border-l border-[#e5e5e5] flex flex-col overflow-hidden',
            )}
            role="complementary"
            aria-label="Panel de Inteligencia"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5] shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#d4a017]" />
                <h2 className="text-sm font-medium text-[#0a0a0a] uppercase tracking-wide">
                  Inteligencia
                </h2>
              </div>
              <button
                onClick={onToggle}
                className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
                aria-label="Cerrar panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
              {currentState === 'welcome' && renderWelcome()}
              {currentState === 'case_selected' && renderCaseSelected()}
              {currentState === 'intake' && renderIntake()}
              {currentState === 'chat_active' && renderChatActive()}
              {currentState === 'chat_response' && renderChatResponse()}
              {currentState === 'pipeline_running' && renderPipelineRunning()}
              {currentState === 'pipeline_complete' && renderPipelineComplete()}
            </div>

            {/* Footer */}
            {renderFooter()}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

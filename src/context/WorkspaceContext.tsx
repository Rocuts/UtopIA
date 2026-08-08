'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  generateConversationId,
  saveReport,
  listReports,
  type StoredReportRecord,
} from '@/lib/storage/conversation-history';
import type {
  CaseType,
  WorkspaceMode,
  PipelineState,
  IntelligencePanelData,
  IntakeFormUnion,
  NiifReportIntake,
} from '@/types/platform';
import type { FinancialReport, CompanyInfo } from '@/lib/agents/financial/types';
import type { AuditReport as BackendAuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment as BackendQualityAssessment } from '@/lib/agents/financial/quality/types';
import type { ReportIterationTurn } from '@/components/workspace/types';
import {
  savePendingRun,
  loadPendingRun,
  clearPendingRun as clearPendingRunStorage,
  type PendingRunRecord,
} from '@/components/workspace/pipeline-resilience';

// ─── Preserved existing types ─────────────────────────────────────────────────

export interface UploadedDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  uploadedAt: string;
}

export interface RiskAssessmentData {
  level: 'bajo' | 'medio' | 'alto' | 'critico';
  score: number;
  factors: { description: string; severity: string }[];
  recommendations: string[];
}

// ─── State shape ──────────────────────────────────────────────────────────────

export interface WorkspaceState {
  // Existing state (preserved)
  sidebarOpen: boolean;
  analysisPanelOpen: boolean;
  activeCase: string | null;
  activeUseCase: string;
  uploadedDocuments: UploadedDocument[];
  riskAssessment: RiskAssessmentData | null;
  toggleSidebar: () => void;
  toggleAnalysisPanel: () => void;
  setActiveCase: (id: string | null) => void;
  setActiveUseCase: (uc: string) => void;
  addDocument: (doc: UploadedDocument) => void;
  setRiskAssessment: (data: RiskAssessmentData | null) => void;
  startNewConsultation: (useCase?: string) => void;
  conversationListVersion: number;
  refreshConversationList: () => void;

  // New state for platform transformation
  activeCaseType: CaseType | null;
  activeMode: WorkspaceMode;
  pipelineState: PipelineState;
  intelligencePanelData: IntelligencePanelData;
  intakeDrafts: Partial<Record<CaseType, Partial<IntakeFormUnion>>>;
  intakeModalOpen: boolean;
  pipelineInput: NiifReportIntake | null;

  /**
   * Corrida disparada en una sesión anterior del navegador (persistida al
   * llamar `setPipelineInput`). Auditoría 2026-08: un F5 durante la generación
   * perdía el intake ya confirmado y el usuario tenía que rehacer el wizard
   * entero. NO se re-dispara sola — gastar 3-5 min y varios dólares de LLM
   * requiere un click explícito del usuario (`resumePendingRun`).
   */
  pendingRun: PendingRunRecord | null;
  /** Promueve la corrida pendiente a `pipelineInput` (la relanza). */
  resumePendingRun: () => void;
  /** Descarta la corrida pendiente sin relanzarla. */
  clearPendingRun: () => void;

  // Reporte financiero mas reciente completado (backend report + turnos del chat de seguimiento)
  lastCompletedReport: LastCompletedReport | null;

  // New setters
  setActiveCaseType: (ct: CaseType | null) => void;
  setActiveMode: (mode: WorkspaceMode) => void;
  setPipelineState: (ps: PipelineState | ((prev: PipelineState) => PipelineState)) => void;
  setIntelligencePanelData: (data: IntelligencePanelData | ((prev: IntelligencePanelData) => IntelligencePanelData)) => void;
  setIntakeDraft: (caseType: CaseType, draft: Partial<IntakeFormUnion>) => void;
  clearIntakeDraft: (caseType: CaseType) => void;
  setIntakeModalOpen: (open: boolean) => void;
  openIntakeForType: (ct: CaseType) => void;
  setPipelineInput: (input: NiifReportIntake | null) => void;

  /** Reemplaza el reporte completado actual y lo persiste en localStorage (FIFO). */
  setLastCompletedReport: (data: LastCompletedReport | null) => void;
  /**
   * Actualiza los turnos del chat de seguimiento para un `conversationId` dado.
   * Si coincide con el reporte activo, tambien actualiza el estado en memoria.
   */
  updateReportTurns: (conversationId: string, turns: ReportIterationTurn[]) => void;

  // ─── Chat seed bus (agentes E/F/G/H → ChatSidebar) ──────────────────────────
  /**
   * Texto "seed" emitido por los strips contextuales de cada ventana de área
   * (El Escudo, El Valor, La Verdad, El Futuro). El ChatSidebar lo consume al
   * montarse / hidratarse: lo coloca en su input y lo limpia vía
   * `setPendingChatSeed(null)`. Single-consumer — no buffering.
   */
  pendingChatSeed: string | null;
  setPendingChatSeed: (seed: string | null) => void;

  // ─── Chat context bus (Capa 5 — contexto fiscal automático) ─────────────────
  /**
   * Bloque de contexto fiscal automático producido por El Escudo cuando hay un
   * FiscalSnapshot disponible. El ChatSidebar lo antepone como seed enriquecido
   * al primer mensaje (si el input está vacío) o lo guarda para que el usuario
   * lo incluya en su próxima consulta. Single-consumer — se limpia tras el
   * primer consume. Formato: bloque de texto plano con F01-F10 + score + alertas.
   */
  pendingChatContext: string | null;
  setPendingChatContext: (ctx: string | null) => void;
}

// ─── Reporte completado (expuesto al shell) ───────────────────────────────────

export interface LastCompletedReport {
  report: FinancialReport;
  rawData: string;
  company: CompanyInfo;
  conversationId: string;
  turns: ReportIterationTurn[];
  /**
   * Auditoría 2026-08: `auditReport` y `qualityReport` vivían SOLO en el estado
   * del componente. Tras un refresh el usuario exportaba el PDF y el documento
   * salía sin las páginas de auditoría ni de meta-auditoría — las que él había
   * esperado (y pagado en tiempo de LLM) — sin ningún aviso de que faltaban.
   * Ahora viajan con el registro persistido.
   */
  auditReport?: BackendAuditReport | null;
  qualityReport?: BackendQualityAssessment | null;
}

/**
 * El registro persistido lleva dos campos extra sobre `StoredReportRecord`.
 * `saveReport` hace spread del objeto completo (`capRecord` incluido), así que
 * los campos adicionales sobreviven el round-trip a localStorage sin tocar el
 * módulo de storage.
 */
type StoredReportRecordWithAudit = StoredReportRecord & {
  auditReport?: unknown;
  qualityReport?: unknown;
};

// ─── Default pipeline state ───────────────────────────────────────────────────

const DEFAULT_PIPELINE_STATE: PipelineState = {
  mode: 'idle',
  currentStage: 0,
  stageLabels: ['Analista NIIF', 'Director de Estrategia', 'Gobierno Corporativo'],
  completedStages: [],
  auditorsStarted: [],
  auditorsComplete: [],
  auditFindings: {},
};

const DEFAULT_INTELLIGENCE_DATA: IntelligencePanelData = {
  citations: [],
  findings: [],
};

// ─── Context ──────────────────────────────────────────────────────────────────

const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Existing state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false);
  const [activeCase, setActiveCaseState] = useState<string | null>(null);
  const [activeUseCase, setActiveUseCaseState] = useState('dian-defense');
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [riskAssessment, setRiskAssessmentState] = useState<RiskAssessmentData | null>(null);
  const [conversationListVersion, setConversationListVersion] = useState(0);

  // New state
  const [activeCaseType, setActiveCaseTypeState] = useState<CaseType | null>(null);
  const [activeMode, setActiveModeState] = useState<WorkspaceMode>('chat');
  const [pipelineState, setPipelineStateInternal] = useState<PipelineState>(DEFAULT_PIPELINE_STATE);
  const [intelligencePanelData, setIntelligencePanelDataInternal] = useState<IntelligencePanelData>(DEFAULT_INTELLIGENCE_DATA);
  const [intakeDrafts, setIntakeDrafts] = useState<Partial<Record<CaseType, Partial<IntakeFormUnion>>>>({});
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [pipelineInput, setPipelineInputState] = useState<NiifReportIntake | null>(null);
  // Corrida persistida de una sesión anterior. Inicializador lazy: `loadPendingRun`
  // devuelve null en SSR (no hay `localStorage` en `globalThis`).
  const [pendingRun, setPendingRunState] = useState<PendingRunRecord | null>(() => loadPendingRun());
  const [pendingChatSeed, setPendingChatSeedState] = useState<string | null>(null);
  const [pendingChatContext, setPendingChatContextState] = useState<string | null>(null);
  // Hidratar el reporte mas reciente desde localStorage al crear el state.
  // `listReports()` ya chequea `typeof window === 'undefined'` y retorna [] en SSR,
  // asi que es seguro usarlo como inicializador lazy en un 'use client' component.
  // Este provider es 'use client', por lo que el hook solo corre en el cliente.
  const [lastCompletedReport, setLastCompletedReportState] = useState<LastCompletedReport | null>(
    () => {
      try {
        const all = listReports();
        const latest = all[0] as StoredReportRecordWithAudit | undefined;
        if (!latest) return null;
        const report = latest.report as FinancialReport | null;
        if (!report || typeof report.consolidatedReport !== 'string') return null;
        return {
          report,
          rawData: latest.rawData,
          company: report.company,
          conversationId: latest.conversationId,
          turns: (latest.turns as ReportIterationTurn[] | undefined) ?? [],
          // Rehidratamos auditoría y meta-auditoría: sin esto el PDF exportado
          // tras un refresh omitía silenciosamente sus páginas.
          auditReport: (latest.auditReport as BackendAuditReport | undefined) ?? null,
          qualityReport: (latest.qualityReport as BackendQualityAssessment | undefined) ?? null,
        };
      } catch {
        // Si el storage esta corrupto, ignoramos — el usuario empieza vacio.
        return null;
      }
    },
  );

  // Existing methods
  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);
  const toggleAnalysisPanel = useCallback(() => setAnalysisPanelOpen(prev => !prev), []);
  const setActiveCase = useCallback((id: string | null) => setActiveCaseState(id), []);
  const setActiveUseCase = useCallback((uc: string) => setActiveUseCaseState(uc), []);
  const addDocument = useCallback((doc: UploadedDocument) => {
    setUploadedDocuments(prev => [...prev, doc]);
  }, []);
  const setRiskAssessment = useCallback((data: RiskAssessmentData | null) => {
    setRiskAssessmentState(data);
  }, []);

  const startNewConsultation = useCallback((useCase?: string) => {
    const newId = generateConversationId();
    setActiveCaseState(newId);
    if (useCase) setActiveUseCaseState(useCase);
    setUploadedDocuments([]);
    setRiskAssessmentState(null);
  }, []);

  const refreshConversationList = useCallback(() => {
    setConversationListVersion(prev => prev + 1);
  }, []);

  // New methods
  const setActiveCaseType = useCallback((ct: CaseType | null) => {
    setActiveCaseTypeState(ct);
    if (ct) {
      // Map CaseType to legacy useCase string for backward compat
      const CASE_TYPE_TO_USE_CASE: Record<CaseType, string> = {
        general_chat: 'general',
        dian_defense: 'dian-defense',
        tax_refund: 'tax-refund',
        due_diligence: 'due-diligence',
        financial_intel: 'financial-intelligence',
        niif_report: 'financial-report',
        tax_planning: 'tax-planning',
        transfer_pricing: 'transfer-pricing',
        business_valuation: 'business-valuation',
        fiscal_audit_opinion: 'fiscal-audit-opinion',
        tax_reconciliation: 'tax-reconciliation',
        feasibility_study: 'feasibility-study',
      };
      setActiveUseCaseState(CASE_TYPE_TO_USE_CASE[ct]);
    }
  }, []);

  const setActiveMode = useCallback((mode: WorkspaceMode) => {
    setActiveModeState(mode);
  }, []);

  const setPipelineState = useCallback(
    (ps: PipelineState | ((prev: PipelineState) => PipelineState)) => {
      setPipelineStateInternal(ps);
    },
    [],
  );

  const setIntelligencePanelData = useCallback(
    (data: IntelligencePanelData | ((prev: IntelligencePanelData) => IntelligencePanelData)) => {
      setIntelligencePanelDataInternal(data);
    },
    [],
  );

  const setIntakeDraft = useCallback((caseType: CaseType, draft: Partial<IntakeFormUnion>) => {
    setIntakeDrafts(prev => ({ ...prev, [caseType]: draft }));
  }, []);

  const clearIntakeDraft = useCallback((caseType: CaseType) => {
    setIntakeDrafts(prev => {
      const next = { ...prev };
      delete next[caseType];
      return next;
    });
  }, []);

  /**
   * Fija el intake que dispara el pipeline y lo PERSISTE antes de que arranque
   * la corrida. Ese orden importa: si el tab se cierra o el usuario refresca a
   * los 30 segundos, el intake ya está en disco y se le puede ofrecer reanudar
   * en vez de obligarlo a rehacer el wizard.
   */
  const setPipelineInput = useCallback((input: NiifReportIntake | null) => {
    setPipelineInputState(input);
    if (input) {
      savePendingRun(input);
      // Una corrida nueva invalida la oferta de reanudar la anterior.
      setPendingRunState(null);
    } else {
      clearPendingRunStorage();
      setPendingRunState(null);
    }
  }, []);

  const resumePendingRun = useCallback(() => {
    setPendingRunState((prev) => {
      if (prev) setPipelineInputState(prev.input);
      return null;
    });
  }, []);

  const clearPendingRun = useCallback(() => {
    clearPendingRunStorage();
    setPendingRunState(null);
  }, []);

  const setPendingChatSeed = useCallback((seed: string | null) => {
    // Trimmed-null normalization: empty strings collapse to null so consumers
    // can just check `if (pendingChatSeed)`.
    setPendingChatSeedState(() => {
      if (seed == null) return null;
      const t = seed.trim();
      return t ? t : null;
    });
  }, []);

  const setPendingChatContext = useCallback((ctx: string | null) => {
    setPendingChatContextState(() => {
      if (ctx == null) return null;
      const t = ctx.trim();
      return t ? t : null;
    });
  }, []);

  /**
   * Reemplaza el reporte completado actual. Si `data` no es null, tambien
   * se persiste en localStorage via `saveReport` (FIFO, ultimos 3).
   */
  const setLastCompletedReport = useCallback((data: LastCompletedReport | null) => {
    setLastCompletedReportState(data);
    if (!data) return;
    try {
      const record: StoredReportRecordWithAudit = {
        conversationId: data.conversationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        companyName: data.company.name,
        companyNit: data.company.nit,
        fiscalPeriod: data.company.fiscalPeriod,
        report: data.report,
        rawData: data.rawData,
        turns: data.turns,
        // Se persisten SIEMPRE que existan: el PDF editorial las necesita para
        // AuditFindingsPage / QualityMetaAuditPage y antes se perdían con el
        // primer refresh.
        auditReport: data.auditReport ?? null,
        qualityReport: data.qualityReport ?? null,
      };
      saveReport(record);
    } catch (err) {
      console.error('Failed to save report to localStorage:', err);
    }
  }, []);

  /**
   * Actualiza los turnos del chat de seguimiento para un `conversationId`
   * dado. Si coincide con el reporte activo, actualiza el estado en memoria
   * y persiste. Si no coincide, solo persiste (caso raro: reporte historico).
   */
  const updateReportTurns = useCallback(
    (conversationId: string, turns: ReportIterationTurn[]) => {
      setLastCompletedReportState((prev) => {
        if (prev && prev.conversationId === conversationId) {
          const next: LastCompletedReport = { ...prev, turns };
          try {
            const record: StoredReportRecordWithAudit = {
              conversationId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              companyName: next.company.name,
              companyNit: next.company.nit,
              fiscalPeriod: next.company.fiscalPeriod,
              report: next.report,
              rawData: next.rawData,
              turns,
              // Re-escribir el registro sin estos campos los borraría: un turno
              // del chat de seguimiento dejaría al PDF sin páginas de auditoría.
              auditReport: next.auditReport ?? null,
              qualityReport: next.qualityReport ?? null,
            };
            saveReport(record);
          } catch (err) {
            console.error('Failed to update report turns in localStorage:', err);
          }
          return next;
        }
        return prev;
      });
    },
    [],
  );

  const openIntakeForType = useCallback((ct: CaseType) => {
    setActiveCaseTypeState(ct);
    const CASE_TYPE_TO_USE_CASE: Record<CaseType, string> = {
      general_chat: 'general',
      dian_defense: 'dian-defense',
      tax_refund: 'tax-refund',
      due_diligence: 'due-diligence',
      financial_intel: 'financial-intelligence',
      niif_report: 'financial-report',
      tax_planning: 'tax-planning',
      transfer_pricing: 'transfer-pricing',
      business_valuation: 'business-valuation',
      fiscal_audit_opinion: 'fiscal-audit-opinion',
      tax_reconciliation: 'tax-reconciliation',
      feasibility_study: 'feasibility-study',
    };
    setActiveUseCaseState(CASE_TYPE_TO_USE_CASE[ct]);
    setIntakeModalOpen(true);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        // Existing
        sidebarOpen,
        analysisPanelOpen,
        activeCase,
        activeUseCase,
        uploadedDocuments,
        riskAssessment,
        toggleSidebar,
        toggleAnalysisPanel,
        setActiveCase,
        setActiveUseCase,
        addDocument,
        setRiskAssessment,
        startNewConsultation,
        conversationListVersion,
        refreshConversationList,

        // New
        activeCaseType,
        activeMode,
        pipelineState,
        intelligencePanelData,
        intakeDrafts,
        intakeModalOpen,
        pipelineInput,
        pendingRun,
        resumePendingRun,
        clearPendingRun,
        lastCompletedReport,
        setActiveCaseType,
        setActiveMode,
        setPipelineState,
        setIntelligencePanelData,
        setIntakeDraft,
        clearIntakeDraft,
        setIntakeModalOpen,
        openIntakeForType,
        setPipelineInput,
        setLastCompletedReport,
        updateReportTurns,
        pendingChatSeed,
        setPendingChatSeed,
        pendingChatContext,
        setPendingChatContext,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

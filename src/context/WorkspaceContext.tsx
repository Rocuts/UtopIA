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
import type { ReportIterationTurn } from '@/components/workspace/types';

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
}

// ─── Reporte completado (expuesto al shell) ───────────────────────────────────

export interface LastCompletedReport {
  report: FinancialReport;
  rawData: string;
  company: CompanyInfo;
  conversationId: string;
  turns: ReportIterationTurn[];
}

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
  const [pendingChatSeed, setPendingChatSeedState] = useState<string | null>(null);
  // Hidratar el reporte mas reciente desde localStorage al crear el state.
  // `listReports()` ya chequea `typeof window === 'undefined'` y retorna [] en SSR,
  // asi que es seguro usarlo como inicializador lazy en un 'use client' component.
  // Este provider es 'use client', por lo que el hook solo corre en el cliente.
  const [lastCompletedReport, setLastCompletedReportState] = useState<LastCompletedReport | null>(
    () => {
      try {
        const all = listReports();
        const latest = all[0];
        if (!latest) return null;
        const report = latest.report as FinancialReport | null;
        if (!report || typeof report.consolidatedReport !== 'string') return null;
        return {
          report,
          rawData: latest.rawData,
          company: report.company,
          conversationId: latest.conversationId,
          turns: (latest.turns as ReportIterationTurn[] | undefined) ?? [],
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

  const setPipelineInput = useCallback((input: NiifReportIntake | null) => {
    setPipelineInputState(input);
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

  /**
   * Reemplaza el reporte completado actual. Si `data` no es null, tambien
   * se persiste en localStorage via `saveReport` (FIFO, ultimos 3).
   */
  const setLastCompletedReport = useCallback((data: LastCompletedReport | null) => {
    setLastCompletedReportState(data);
    if (!data) return;
    try {
      const record: StoredReportRecord = {
        conversationId: data.conversationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        companyName: data.company.name,
        companyNit: data.company.nit,
        fiscalPeriod: data.company.fiscalPeriod,
        report: data.report,
        rawData: data.rawData,
        turns: data.turns,
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
            saveReport({
              conversationId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              companyName: next.company.name,
              companyNit: next.company.nit,
              fiscalPeriod: next.company.fiscalPeriod,
              report: next.report,
              rawData: next.rawData,
              turns,
            });
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

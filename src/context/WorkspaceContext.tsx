'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { generateConversationId } from '@/lib/storage/conversation-history';
import type {
  CaseType,
  WorkspaceMode,
  PipelineState,
  IntelligencePanelData,
  IntakeFormUnion,
  NiifReportIntake,
} from '@/types/platform';

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
        setActiveCaseType,
        setActiveMode,
        setPipelineState,
        setIntelligencePanelData,
        setIntakeDraft,
        clearIntakeDraft,
        setIntakeModalOpen,
        openIntakeForType,
        setPipelineInput,
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

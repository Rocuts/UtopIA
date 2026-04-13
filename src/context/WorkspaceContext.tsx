'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

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

export interface WorkspaceState {
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
}

const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false);
  const [activeCase, setActiveCaseState] = useState<string | null>(null);
  const [activeUseCase, setActiveUseCaseState] = useState('dian-defense');
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [riskAssessment, setRiskAssessmentState] = useState<RiskAssessmentData | null>(null);

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

  return (
    <WorkspaceContext.Provider
      value={{
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

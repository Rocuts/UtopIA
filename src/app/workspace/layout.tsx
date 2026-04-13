'use client';

import { useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { WorkspaceProvider, useWorkspace } from '@/context/WorkspaceContext';
import { Sidebar } from '@/components/workspace/Sidebar';
import { StatusBar } from '@/components/workspace/StatusBar';
import { AnalysisPanel } from '@/components/workspace/AnalysisPanel';
import { exportConversationPDF } from '@/lib/export/pdf-export';
import { inferTitle, listConversations } from '@/lib/storage/conversation-history';
import type { UploadedDocument as WorkspaceUploadedDoc } from '@/components/workspace/types';

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const {
    sidebarOpen,
    toggleSidebar,
    analysisPanelOpen,
    toggleAnalysisPanel,
    activeCase,
    activeUseCase,
    uploadedDocuments,
    riskAssessment,
  } = useWorkspace();

  // Auto-collapse sidebar on mobile
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && sidebarOpen) {
        toggleSidebar();
      }
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert workspace documents to AnalysisPanel format
  const analysisDocs: WorkspaceUploadedDoc[] = uploadedDocuments.map(d => ({
    filename: d.name,
    size: d.size,
    chunks: d.status === 'ready' ? 1 : 0,
    uploadedAt: d.uploadedAt,
  }));

  const handleExportPDF = useCallback(() => {
    if (!activeCase) return;
    const conversations = listConversations();
    const conv = conversations.find(c => c.id === activeCase);
    if (!conv || conv.messages.length <= 1) return;

    const useCaseLabelsForExport: Record<string, string> = {
      'dian-defense': language === 'es' ? 'Defensa DIAN' : 'DIAN Defense',
      'tax-refund': language === 'es' ? 'Devolucion de Saldos' : 'Tax Refund',
      'due-diligence': 'Due Diligence',
      'financial-intelligence': language === 'es' ? 'Inteligencia Financiera' : 'Financial Intelligence',
    };

    exportConversationPDF({
      title: inferTitle(conv.messages),
      useCase: useCaseLabelsForExport[conv.useCase] ?? conv.useCase,
      messages: conv.messages,
      language,
    });
  }, [activeCase, language]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-white">
      <StatusBar
        caseId={activeCase ? `TC-${activeCase.slice(5, 13)}` : null}
        useCase={activeUseCase}
        riskLevel={riskAssessment?.level ?? null}
        documentCount={uploadedDocuments.length}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        analysisPanelOpen={analysisPanelOpen}
        onToggleAnalysisPanel={toggleAnalysisPanel}
        language={language}
      />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden bg-white">
          {children}
        </main>
        <AnalysisPanel
          isOpen={analysisPanelOpen}
          onToggle={toggleAnalysisPanel}
          riskAssessment={riskAssessment}
          uploadedDocuments={analysisDocs}
          onExportPDF={handleExportPDF}
          language={language}
        />
      </div>
    </div>
  );
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}

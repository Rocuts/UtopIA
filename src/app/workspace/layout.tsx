'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { WorkspaceProvider, useWorkspace } from '@/context/WorkspaceContext';
import { Sidebar } from '@/components/workspace/Sidebar';
import { StatusBar } from '@/components/workspace/StatusBar';
import { AnalysisPanel } from '@/components/workspace/AnalysisPanel';
import { CommandPalette } from '@/components/workspace/CommandPalette';
import { ToastProvider } from '@/design-system/components/Toast';
import { IntakeModal } from '@/components/workspace/intake/IntakeModal';
import { exportConversationPDF } from '@/lib/export/pdf-export';
import { inferTitle, listConversations } from '@/lib/storage/conversation-history';
import type { UploadedDocument as WorkspaceUploadedDoc } from '@/components/workspace/types';

function IntakeModalLoader() {
  const { intakeModalOpen } = useWorkspace();
  if (!intakeModalOpen) return null;
  return <IntakeModal />;
}

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
    setActiveCase,
    startNewConsultation,
  } = useWorkspace();

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  const handleClearConversation = useCallback(() => {
    setActiveCase(null);
  }, [setActiveCase]);

  const handleCommandAction = useCallback(
    (actionId: string) => {
      if (actionId === 'new-consultation') {
        startNewConsultation();
      } else if (actionId === 'export-pdf') {
        handleExportPDF();
      } else if (actionId === 'clear-chat') {
        setActiveCase(null);
      } else if (actionId === 'dian-defense') {
        startNewConsultation('dian-defense');
      } else if (actionId === 'tax-refund') {
        startNewConsultation('tax-refund');
      } else if (actionId === 'due-diligence') {
        startNewConsultation('due-diligence');
      } else if (actionId === 'financial-intel') {
        startNewConsultation('financial-intelligence');
      } else if (actionId.startsWith('recent-')) {
        const conversationId = actionId.replace('recent-', '');
        setActiveCase(conversationId);
      }
    },
    [startNewConsultation, setActiveCase, handleExportPDF]
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-[#0a0a0a] focus:rounded focus:shadow-lg focus:border focus:border-[#0a0a0a]"
      >
        {language === 'es' ? 'Saltar al contenido principal' : 'Skip to main content'}
      </a>
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
        <div id="workspace-sidebar" className="contents">
          <Sidebar />
        </div>
        <main id="main-content" className="flex-1 min-w-0 overflow-hidden flex flex-col bg-white">
          {children}
        </main>
        <div id="analysis-panel" className="contents">
          <AnalysisPanel
            isOpen={analysisPanelOpen}
            onToggle={toggleAnalysisPanel}
            riskAssessment={riskAssessment}
            uploadedDocuments={analysisDocs}
            onExportPDF={handleExportPDF}
            onClearConversation={handleClearConversation}
            language={language}
          />
        </div>
      </div>

      {/* Intake Modal */}
      <IntakeModalLoader />

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        language={language}
        onAction={handleCommandAction}
      />
    </div>
  );
}

export default function WorkspaceLayoutRoot({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <ToastProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </ToastProvider>
    </WorkspaceProvider>
  );
}

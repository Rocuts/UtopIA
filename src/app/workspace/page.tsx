'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ChatWorkspace } from '@/components/workspace/ChatWorkspace';
import { PipelineWorkspace } from '@/components/workspace/PipelineWorkspace';
import { ExecutiveDashboard } from '@/components/workspace/ExecutiveDashboard';
import type { RiskAssessmentData, UploadedDocument } from '@/components/workspace/types';

/**
 * Workspace home router:
 *
 *  - If there's an active NIIF pipeline, render the pipeline surface.
 *  - If there's an active chat case, render ChatWorkspace (preserving
 *    the existing handlers: handleDocumentUploaded, setRiskAssessment, …).
 *  - Otherwise, render the Executive Dashboard (4 pillars + narrative).
 */

export default function WorkspacePage() {
  const { language } = useLanguage();
  const {
    activeCase,
    activeUseCase,
    activeCaseType,
    activeMode,
    setRiskAssessment,
    addDocument,
  } = useWorkspace();

  // Side-effect bridges for the chat case — unchanged from the previous impl.
  const handleRiskAssessment = (data: RiskAssessmentData) => {
    setRiskAssessment(data);
  };

  const handleDocumentUploaded = (doc: UploadedDocument) => {
    addDocument({
      id: `doc-${Date.now()}`,
      name: doc.filename,
      type: 'document',
      size: doc.size,
      status: doc.chunks > 0 ? 'ready' : 'processing',
      uploadedAt: doc.uploadedAt,
    });
  };

  // MODE: PIPELINE — NIIF Elite
  if (activeCaseType === 'niif_report' && activeMode === 'pipeline') {
    return <PipelineWorkspace />;
  }

  // MODE: CHAT — Active case with conversation
  if (activeCase) {
    return (
      <ChatWorkspace
        key={activeCase}
        conversationId={activeCase}
        useCase={activeUseCase}
        language={language}
        onRiskAssessment={handleRiskAssessment}
        onDocumentUploaded={handleDocumentUploaded}
      />
    );
  }

  // MODE: HOME — No active case → Executive Dashboard
  return <ExecutiveDashboard />;
}

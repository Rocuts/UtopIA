'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { WelcomeScreen } from '@/components/workspace/WelcomeScreen';
import { ChatWorkspace } from '@/components/workspace/ChatWorkspace';
import { PipelineWorkspace } from '@/components/workspace/PipelineWorkspace';
import type { RiskAssessmentData, UploadedDocument } from '@/components/workspace/types';

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

  // MODE: WELCOME — No active case
  return <WelcomeScreen />;
}

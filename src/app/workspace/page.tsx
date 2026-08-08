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
    pipelineState,
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
  const showPipeline = activeCaseType === 'niif_report' && activeMode === 'pipeline';

  // Auditoría 2026-08 (`navegacion-mata-corrida`): antes, cambiar de área
  // durante la generación DESMONTABA `PipelineWorkspace` y el cleanup de su
  // efecto abortaba el reporte — 3-5 minutos y varios dólares de LLM tirados,
  // sin confirmación ni aviso.
  //
  // `PipelineWorkspace` se mantiene montado mientras la corrida siga viva,
  // SIEMPRE en la misma posición del árbol (primer hijo del fragmento) para
  // que React preserve la instancia cuando `showPipeline` pasa a false. Si se
  // renderizara condicionalmente en otra rama, React lo desmontaría y volvería
  // a montarlo, que es exactamente lo que queremos evitar.
  const pipelineRunning =
    pipelineState.mode === 'running' ||
    pipelineState.mode === 'auditing' ||
    pipelineState.mode === 'quality';
  const keepPipelineMounted = showPipeline || pipelineRunning;

  return (
    <>
      <div className={showPipeline ? 'h-full' : 'hidden'} aria-hidden={!showPipeline}>
        {keepPipelineMounted && <PipelineWorkspace />}
      </div>

      {!showPipeline &&
        (activeCase ? (
          // MODE: CHAT — Active case with conversation
          <ChatWorkspace
            key={activeCase}
            conversationId={activeCase}
            useCase={activeUseCase}
            language={language}
            onRiskAssessment={handleRiskAssessment}
            onDocumentUploaded={handleDocumentUploaded}
          />
        ) : (
          // MODE: HOME — No active case → Executive Dashboard
          <ExecutiveDashboard />
        ))}
    </>
  );
}

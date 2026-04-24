'use client';

/**
 * Workspace Layout — Centro de Comando Elite
 *
 * Arquitectura:
 *
 *   <WorkspaceProvider>
 *     <ToastProvider>
 *       <div data-theme="elite" data-lenis-prevent>
 *         <EliteHeader />                    ← sticky top 64px, brand + AreaNav + NiifEliteButton
 *         <div className="flex">
 *           <ChatSidebar />                  ← izquierda persistente, colapsable (320/56px)
 *           <main id="main-content">
 *             {children}                     ← dashboard o ventana activa
 *           </main>
 *         </div>
 *         <CommandPalette />                 ← Cmd/Ctrl+K (preservado)
 *         <IntakeModal />                    ← abierto por NiifEliteButton u otros (preservado)
 *       </div>
 *     </ToastProvider>
 *   </WorkspaceProvider>
 *
 * Decisiones de refactor (documentadas aquí porque el shell es el contrato
 * que consumen todos los demás agentes E–H):
 *
 *   1. `data-theme="elite"` en el contenedor raíz del workspace — todos los
 *      descendientes heredan los tokens dark. El landing `/` sigue light.
 *   2. `data-lenis-prevent` preservado en el mismo div — crítico para el
 *      wheel scroll (ver CLAUDE.md "Layout Gotchas"). NO removerlo.
 *   3. StatusBar legacy — ELIMINADO. Su contenido útil (caseId, riskLevel,
 *      documentCount, toggles) queda absorbido por el EliteHeader (user menu,
 *      language toggle) y por cada ventana individual que mostrará su case
 *      info en su propio header. El toggle de AnalysisPanel ya no aplica
 *      porque el panel se deprecia en este shell (ver punto 5).
 *   4. Sidebar legacy (`src/components/workspace/Sidebar.tsx`) — NO se monta
 *      en este layout. Queda huérfano pero el archivo se deja intacto por
 *      si alguna vista aislada quiere usarlo como navegador full de casos
 *      históricos. El nuevo ChatSidebar ya integra: (a) chat general
 *      persistente, (b) historial de conversaciones en el tab "Historial".
 *   5. AnalysisPanel legacy — NO se monta aquí. El panel de análisis con
 *      risk meter + findings + citations era relevante para el flujo chat
 *      monolítico anterior. En el Centro de Comando Elite, cada ventana
 *      (Escudo/Valor/Verdad/Futuro) muestra su propio análisis contextual.
 *      El `riskAssessment` y `uploadedDocuments` en WorkspaceContext siguen
 *      expuestos para quien los necesite. Cero regresiones — sólo deja de
 *      mostrarse el panel lateral derecho.
 *   6. CommandPalette (Cmd+K) — preservado con la misma lógica de acciones.
 *   7. IntakeModal — preservado; el NiifEliteButton lo abre para niif_report.
 *   8. WorkspaceContext — NO se modifica. Todas las APIs existentes siguen
 *      disponibles para los agentes C/E/F/G/H que consumen activeCase,
 *      activeCaseType, activeMode, openIntakeForType, etc.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import {
  WorkspaceProvider,
  useWorkspace,
} from '@/context/WorkspaceContext';
import { ToastProvider } from '@/design-system/components/Toast';
import { CommandPalette } from '@/components/workspace/CommandPalette';
import { IntakeModal } from '@/components/workspace/intake/IntakeModal';
import { ChatSidebar } from '@/components/workspace/ChatSidebar';
import { EliteHeader } from '@/components/workspace/EliteHeader';
import { exportConversationPDF } from '@/lib/export/pdf-export';
import {
  inferTitle,
  listConversations,
} from '@/lib/storage/conversation-history';

// ─── Intake Modal loader (only mount when open) ──────────────────────────────

function IntakeModalLoader() {
  const { intakeModalOpen } = useWorkspace();
  if (!intakeModalOpen) return null;
  return <IntakeModal />;
}

// ─── Shell ───────────────────────────────────────────────────────────────────

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const {
    activeCase,
    setActiveCase,
    startNewConsultation,
  } = useWorkspace();

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Global Cmd+K / Ctrl+K to open the command palette.
  // Runs at the shell level so it works regardless of which page/area is active.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // PDF export + command-palette actions (ported from previous shell)
  const handleExportPDF = useCallback(() => {
    if (!activeCase) return;
    const conversations = listConversations();
    const conv = conversations.find((c) => c.id === activeCase);
    if (!conv || conv.messages.length <= 1) return;

    const useCaseLabelsForExport: Record<string, string> = {
      'dian-defense': language === 'es' ? 'Defensa DIAN' : 'DIAN Defense',
      'tax-refund': language === 'es' ? 'Devolucion de Saldos' : 'Tax Refund',
      'due-diligence': 'Due Diligence',
      'financial-intelligence':
        language === 'es' ? 'Inteligencia Financiera' : 'Financial Intelligence',
    };

    exportConversationPDF({
      title: inferTitle(conv.messages),
      useCase: useCaseLabelsForExport[conv.useCase] ?? conv.useCase,
      messages: conv.messages,
      language,
    });
  }, [activeCase, language]);

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
    [startNewConsultation, setActiveCase, handleExportPDF],
  );

  return (
    <div
      data-theme="elite"
      data-lenis-prevent
      className="min-h-screen w-full bg-[#030303] text-[#F5F5F5] flex flex-col relative overflow-x-hidden"
    >
      {/* Skip-to-content link — visible on focus, compliant with WCAG 2.1 */}
      <a
        href="#main-content"
        className={[
          'sr-only focus:not-sr-only',
          'focus:absolute focus:top-3 focus:left-3 focus:z-[100]',
          'focus:px-4 focus:py-2 focus:rounded-md',
          'focus:bg-[#0a0a0a] focus:text-[#F5F5F5]',
          'focus:border focus:border-[#D4A017] focus:shadow-lg',
          'focus:outline-none focus:ring-2 focus:ring-[#D4A017]',
        ].join(' ')}
      >
        {language === 'es' ? 'Saltar al contenido principal' : 'Skip to main content'}
      </a>

      {/* Ambient gold glow — subtle, behind everything. Decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-50"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(212,160,23,0.08) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 100% 50%, rgba(114,47,55,0.06) 0%, transparent 60%)',
        }}
      />

      <EliteHeader />

      <div className="flex-1 flex min-h-0 relative z-10">
        <ChatSidebar />
        <main
          id="main-content"
          role="main"
          className="flex-1 min-w-0 min-h-[calc(100vh-64px)] relative"
        >
          {children}
        </main>
      </div>

      {/* Intake Modal — opens for niif_report + other case types */}
      <IntakeModalLoader />

      {/* Command Palette — Cmd/Ctrl+K */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        language={language}
        onAction={handleCommandAction}
      />
    </div>
  );
}

// ─── Root layout export ──────────────────────────────────────────────────────

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

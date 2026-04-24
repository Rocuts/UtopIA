'use client';

/**
 * WorkspaceLayout — Legacy 3-panel shell (Navigator / Main / Intelligence).
 *
 * STATUS: Orphaned by the Centro de Comando Elite refactor. The new shell
 * lives in `src/app/workspace/layout.tsx` (EliteHeader + ChatSidebar + main).
 * This file is kept source-compatible for any isolated view that still wants
 * a 3-panel layout, but it has been re-themed to the dark token system so
 * it doesn't ship a light-mode relic. If no one re-adopts it by Phase 2 we
 * can delete it; Agent B is deliberately leaving the contract intact for now.
 */
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';

interface WorkspaceLayoutProps {
  navigator: React.ReactNode;
  main: React.ReactNode;
  intelligence: React.ReactNode;
}

const SPRING = { stiffness: 400, damping: 25 };

export function WorkspaceLayout({ navigator, main, intelligence }: WorkspaceLayoutProps) {
  const { sidebarOpen, analysisPanelOpen } = useWorkspace();

  return (
    <div className="flex h-full min-h-0 w-full bg-n-0 text-n-900">
      {/* Panel A — Navigator */}
      <motion.div
        initial={false}
        animate={{ width: sidebarOpen ? 240 : 48 }}
        transition={{ type: 'spring', ...SPRING }}
        className="shrink-0 h-full overflow-hidden border-r border-n-200"
      >
        <div className="h-full overflow-y-auto styled-scrollbar">
          {navigator}
        </div>
      </motion.div>

      {/* Panel B — Main */}
      <main className="flex-1 min-w-0 h-full overflow-hidden">
        {main}
      </main>

      {/* Panel C — Intelligence */}
      <motion.div
        initial={false}
        animate={{
          width: analysisPanelOpen ? 340 : 0,
          opacity: analysisPanelOpen ? 1 : 0,
        }}
        transition={{ type: 'spring', ...SPRING }}
        className={cn(
          'shrink-0 h-full overflow-hidden border-l border-n-200',
          !analysisPanelOpen && 'border-l-0',
        )}
      >
        <div className="h-full w-[340px] overflow-y-auto styled-scrollbar">
          {intelligence}
        </div>
      </motion.div>
    </div>
  );
}

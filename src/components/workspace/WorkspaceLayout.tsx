'use client';

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
    <div className="flex h-full min-h-0 w-full">
      {/* Panel A — Navigator */}
      <motion.div
        initial={false}
        animate={{ width: sidebarOpen ? 240 : 48 }}
        transition={{ type: 'spring', ...SPRING }}
        className="shrink-0 h-full overflow-hidden border-r border-[#e5e5e5]"
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
          'shrink-0 h-full overflow-hidden border-l border-[#e5e5e5]',
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

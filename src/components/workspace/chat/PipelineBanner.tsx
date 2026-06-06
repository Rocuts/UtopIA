'use client';

import { Zap } from 'lucide-react';
import { AgentPipelineViz } from '@/design-system/components/AgentPipelineViz';
import { DSBadge } from '@/design-system/components/Badge';
import type { PipelineVizState } from './types';

export function PipelineBanner({
  vizState,
  onToggle,
}: {
  vizState: PipelineVizState;
  onToggle: () => void;
}) {
  if (!vizState.visible) return null;

  if (vizState.collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-6 py-2 border-b border-n-200 bg-n-50 flex items-center gap-2 text-xs text-n-600 hover:bg-n-100 transition-colors"
      >
        <Zap className="w-3 h-3 text-gold-500" />
        <span>
          Analizado por: {vizState.nodes.filter(n => n.status === 'complete').map(n => n.label).join(' + ')}
        </span>
        <DSBadge variant="tier" tier={vizState.tier} label="" size="sm" />
        <span className="text-2xs text-n-600 ml-auto">
          {vizState.toolLog.length} herramientas · ver detalle
        </span>
      </button>
    );
  }

  return (
    <div className="border-b border-n-200 bg-n-50 px-6 py-3">
      <AgentPipelineViz nodes={vizState.nodes} tier={vizState.tier} compact />
      {vizState.toolLog.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {vizState.toolLog.slice(-3).map((log, i) => (
            <p key={i} className="text-2xs text-n-500 font-mono truncate">
              {log}
            </p>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="text-2xs text-n-700 hover:text-n-1000 mt-1"
      >
        Colapsar
      </button>
    </div>
  );
}

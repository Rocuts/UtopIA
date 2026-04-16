'use client';

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { tokens } from '../tokens';
import type { AgentNode, AgentTier } from '@/types/platform';

interface AgentPipelineVizProps {
  nodes: AgentNode[];
  tier: AgentTier;
  compact?: boolean;
  className?: string;
}

const STATUS_STYLES = {
  pending:  { bg: '#f5f5f5', border: '#e5e5e5', text: '#a3a3a3', icon: '\u25CB' },
  active:   { bg: '#FEF9EC', border: '#D4A017', text: '#D4A017', icon: '\u26A1' },
  complete: { bg: '#F0FDF4', border: '#22C55E', text: '#16A34A', icon: '\u2713' },
  error:    { bg: '#FEF2F2', border: '#EF4444', text: '#DC2626', icon: '\u2717' },
};

function NodeCard({ node, compact }: { node: AgentNode; compact?: boolean }) {
  const prefersReduced = useReducedMotion();
  const style = STATUS_STYLES[node.status];

  return (
    <motion.div
      className={cn(
        'relative rounded-lg border-2 flex flex-col items-center justify-center text-center',
        compact ? 'px-3 py-2 min-w-[100px]' : 'px-4 py-3 min-w-[130px]',
      )}
      style={{ backgroundColor: style.bg, borderColor: style.border }}
      animate={
        node.status === 'active' && !prefersReduced
          ? { boxShadow: [`0 0 0 0px ${style.border}40`, `0 0 0 4px ${style.border}20`, `0 0 0 0px ${style.border}40`] }
          : {}
      }
      transition={node.status === 'active' ? { duration: 1.5, repeat: Infinity } : {}}
    >
      <span className="text-xs font-semibold" style={{ color: style.text }}>
        {style.icon} {node.label}
      </span>
      {node.sublabel && (
        <span className="text-[10px] text-[#a3a3a3] mt-0.5">{node.sublabel}</span>
      )}
      {node.lastTool && node.status === 'active' && (
        <span className="text-[10px] text-[#737373] mt-1 max-w-[120px] truncate">
          {node.lastTool}
        </span>
      )}
      {node.elapsed !== undefined && node.status === 'complete' && (
        <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)] mt-0.5">
          {(node.elapsed / 1000).toFixed(1)}s
        </span>
      )}
    </motion.div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center px-1">
      <div className="w-6 h-px bg-[#d4d4d4]" />
      <div className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-[#d4d4d4]" />
    </div>
  );
}

export function AgentPipelineViz({ nodes, tier, compact, className }: AgentPipelineVizProps) {
  if (tier === 'T1') {
    return null;
  }

  const isT3 = tier === 'T3';
  const tierConfig = tokens.color.tier[tier];

  if (isT3) {
    const classifier = nodes.find(n => n.id === 'classifier');
    const enhancer = nodes.find(n => n.id === 'enhancer');
    const taxAgent = nodes.find(n => n.branch === 'tax' || n.id === 'tax');
    const accountingAgent = nodes.find(n => n.branch === 'accounting' || n.id === 'accounting');
    const synthesizer = nodes.find(n => n.id === 'synthesizer');

    return (
      <div className={cn('w-full', className)}>
        <div className="flex items-center gap-1 mb-2">
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)]"
            style={{ backgroundColor: tierConfig.bg, color: tierConfig.color }}
          >
            T3 · {tierConfig.label}
          </span>
        </div>
        <div className="flex items-center overflow-x-auto styled-scrollbar pb-2">
          {classifier && <NodeCard node={classifier} compact={compact} />}
          <Arrow />
          {enhancer && <NodeCard node={enhancer} compact={compact} />}
          <Arrow />
          <div className="flex flex-col gap-1">
            {taxAgent && <NodeCard node={taxAgent} compact={compact} />}
            {accountingAgent && <NodeCard node={accountingAgent} compact={compact} />}
          </div>
          <Arrow />
          {synthesizer && <NodeCard node={synthesizer} compact={compact} />}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center gap-1 mb-2">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)]"
          style={{ backgroundColor: tierConfig.bg, color: tierConfig.color }}
        >
          {tier} · {tierConfig.label}
        </span>
      </div>
      <div className="flex items-center overflow-x-auto styled-scrollbar pb-2">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center">
            <NodeCard node={node} compact={compact} />
            {i < nodes.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
    </div>
  );
}

import type { AgentNode, AgentTier } from '@/types/platform';

export interface PipelineVizState {
  visible: boolean;
  collapsed: boolean;
  tier: AgentTier;
  nodes: AgentNode[];
  toolLog: string[];
}

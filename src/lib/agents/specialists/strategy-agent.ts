// ---------------------------------------------------------------------------
// Strategy & DIAN Defense specialist agent
// ---------------------------------------------------------------------------

import { BaseSpecialist } from './base-agent';
import { buildStrategyPrompt } from '@/lib/agents/prompts/strategy-agent.prompt';
import type { SpecialistContext } from '@/lib/agents/types';

export class StrategyAgent extends BaseSpecialist {
  readonly name = 'strategy' as const;
  readonly displayName = 'Agente de Estrategia';

  buildSystemPrompt(ctx: SpecialistContext): string {
    return buildStrategyPrompt(ctx.language, ctx.useCase, ctx.nitContext);
  }
}

export const strategyAgent = new StrategyAgent();

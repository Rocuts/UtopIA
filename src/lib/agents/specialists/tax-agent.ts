// ---------------------------------------------------------------------------
// Tax specialist agent
// ---------------------------------------------------------------------------

import { BaseSpecialist } from './base-agent';
import { buildTaxPrompt } from '@/lib/agents/prompts/tax-agent.prompt';
import type { SpecialistContext } from '@/lib/agents/types';

export class TaxAgent extends BaseSpecialist {
  readonly name = 'tax' as const;
  readonly displayName = 'Agente Tributario';

  buildSystemPrompt(ctx: SpecialistContext): string {
    return buildTaxPrompt(ctx.language, ctx.useCase, ctx.nitContext);
  }
}

export const taxAgent = new TaxAgent();

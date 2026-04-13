// ---------------------------------------------------------------------------
// Accounting specialist agent
// ---------------------------------------------------------------------------

import { BaseSpecialist } from './base-agent';
import { buildAccountingPrompt } from '@/lib/agents/prompts/accounting-agent.prompt';
import type { SpecialistContext } from '@/lib/agents/types';

export class AccountingAgent extends BaseSpecialist {
  readonly name = 'accounting' as const;
  readonly displayName = 'Agente Contable';

  buildSystemPrompt(ctx: SpecialistContext): string {
    return buildAccountingPrompt(ctx.language, ctx.useCase, ctx.nitContext);
  }
}

export const accountingAgent = new AccountingAgent();

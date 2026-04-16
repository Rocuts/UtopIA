// ---------------------------------------------------------------------------
// Document specialist agent
// ---------------------------------------------------------------------------

import { BaseSpecialist } from './base-agent';
import { buildDocumentPrompt } from '@/lib/agents/prompts/document-agent.prompt';
import type { SpecialistContext } from '@/lib/agents/types';

export class DocumentAgent extends BaseSpecialist {
  readonly name = 'documents' as const;
  readonly displayName = 'Agente Documental';

  buildSystemPrompt(ctx: SpecialistContext): string {
    return buildDocumentPrompt(ctx.language, ctx.useCase, ctx.nitContext);
  }
}

export const documentAgent = new DocumentAgent();

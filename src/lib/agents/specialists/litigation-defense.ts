// ---------------------------------------------------------------------------
// Litigation Defense specialist agent — "Escudo y Espada"
// ---------------------------------------------------------------------------
// Activa cuando la DIAN YA emitio un acto administrativo (requerimiento, pliego,
// liquidacion oficial, resolucion) y toca contestar con filo procesal. Es el
// complemento agresivo del strategy agent (que hace planeacion y compliance
// antes de que exista acto). Mismo toolkit que strategy + tono litigante.
// ---------------------------------------------------------------------------

import { BaseSpecialist } from './base-agent';
import { buildLitigationPrompt } from '@/lib/agents/prompts/litigation.prompt';
import type { SpecialistContext } from '@/lib/agents/types';

export class LitigationDefenseAgent extends BaseSpecialist {
  readonly name = 'litigation' as const;
  readonly displayName = 'Agente Litigante';

  buildSystemPrompt(ctx: SpecialistContext): string {
    return buildLitigationPrompt(ctx.language, ctx.useCase, ctx.nitContext);
  }
}

export const litigationDefenseAgent = new LitigationDefenseAgent();

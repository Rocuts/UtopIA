// ---------------------------------------------------------------------------
// Capa 4 — Módulo 5 — Agente: Defensa DIAN
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildDefensaDianPrompt } from '../prompts/defensa-dian.prompt';
import { defensaDianModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { buildDianLetterSkeleton } from '../tools/dian-letter-builder';
import type { DefensaDianModuleResult, FiscalAgentInput } from '../types';

export interface DefensaDianAgentOptions {
  input: FiscalAgentInput;
  signal?: AbortSignal;
}

export async function runDefensaDianAgent(
  opts: DefensaDianAgentOptions,
): Promise<DefensaDianModuleResult> {
  const { input } = opts;
  const skeleton = buildDianLetterSkeleton(
    input.dianRequirementText,
    input.dianRequirementKind,
  );

  const system = buildDefensaDianPrompt(input.language, input.company.nit);

  const userContent = `<context>
TEXTO_REQUERIMIENTO_DIAN (del usuario):
${input.dianRequirementText && input.dianRequirementText.length > 0 ? input.dianRequirementText : '(no provisto — el agente debe pedir aclaración a la DIAN o trabajar con tipo desconocido)'}

CLASIFICACION_PRECOMPUTADA:
  Tipo: ${skeleton.classification.kind}
  Plazo respuesta: ${skeleton.classification.plazoRespuesta}
  Norma del plazo: ${skeleton.classification.normaPlazo}

SECCIONES_OBLIGATORIAS_DE_LA_CARTA:
${skeleton.secciones.map((s, i) => `  ${i + 1}. ${s.titulo}\n     ${s.instrucciones}`).join('\n')}

REDUCCIONES_DISPONIBLES:
${skeleton.reduccionesDisponibles.map((r) => `  - ${r}`).join('\n')}

DATOS_EMPRESA:
  Razón social: ${input.company.name ?? 'no provista'}
  NIT: ${input.company.nit ?? 'no provisto'}

ANCLAS_FISCALES_REFERENCIA (Bloque Âncora):
  F01 UAI: ${formatCopFromCents(BigInt(input.fiscalAnchor.f01))}
  F02 Imp. ref.: ${formatCopFromCents(BigInt(input.fiscalAnchor.f02))}
  F03 Retenciones: ${formatCopFromCents(BigInt(input.fiscalAnchor.f03))}
  F04 Saldo: ${formatCopFromCents(BigInt(input.fiscalAnchor.f04))}
  F09 TET: ${input.fiscalAnchor.f09}%

PERIODO: ${input.fiscalAnchor.fuente.periodo}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'defensa-dian',
    slot: 'escudoFiscalDefensaDian',
    schema: defensaDianModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  return json;
}

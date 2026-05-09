// ---------------------------------------------------------------------------
// Submódulo 4: Reserva de Contingencia
// ---------------------------------------------------------------------------
// 10% de la utilidad neta como provision de caja para impuestos. Se diferencia
// explicitamente de la reserva legal del Art. 452 C.Co.
// ---------------------------------------------------------------------------

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { withRetry } from '@/lib/agents/utils/retry';
import { buildContingencyReservePrompt } from '../prompts/contingency-reserve.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import type { SurvivalAgentInput, ContingencyReserveResult } from '../types';

const reserveSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    utilidadNeta: z.number(),
    reservaSugerida: z.number(),
    pctUtilidad: z.number(),
    cuentaSugerida: z.string(),
    reservaLegalActual: z.number().optional(),
    gapReservaLegal: z.number().optional(),
  }),
});

export async function runContingencyReserve(
  input: SurvivalAgentInput,
): Promise<ContingencyReserveResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const systemPrompt = buildContingencyReservePrompt(input.language, undefined, nitContext);

  const userContent = [
    'Calcula la reserva de contingencia (10% utilidad neta) y revisa la reserva legal del Art. 452 C.Co. sobre los totales:',
    '',
    anchorBlock,
    '',
    input.instructions ? `INSTRUCCIONES ADICIONALES:\n${input.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        maxOutputTokens: 3000,
        experimental_output: Output.object({ schema: reserveSchema }),
      }),
    { label: 'escudo_survival_reserve', maxAttempts: 3 },
  );

  return result.experimental_output;
}

// ---------------------------------------------------------------------------
// Submódulo 5: Optimización de Dividendos
// ---------------------------------------------------------------------------
// Compara distribuir vs capitalizar utilidades segun Art. 242 E.T. y
// Art. 36-3 E.T. (capitalizacion = INCRGNO al accionista).
// ---------------------------------------------------------------------------

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { withRetry } from '@/lib/agents/utils/retry';
import { buildDividendOptimizerPrompt } from '../prompts/dividend-optimizer.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import type { SurvivalAgentInput, DividendOptimizerResult } from '../types';

const dividendScenarioSchema = z.object({
  ahorroSocio: z.number(),
  impuestoSocio: z.number(),
  netoSocio: z.number(),
  fortPatrimonio: z.number().optional(),
});

const dividendSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    utilidadDistribuible: z.number(),
    escenarios: z.object({
      distribuirTotal: dividendScenarioSchema,
      capitalizarTotal: dividendScenarioSchema,
      hibrido50_50: dividendScenarioSchema,
    }),
    recomendacion: z.string(),
    norma: z.enum(['Art. 242 E.T.', 'Art. 36-3 E.T.']),
  }),
});

export async function runDividendOptimizer(
  input: SurvivalAgentInput,
): Promise<DividendOptimizerResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const systemPrompt = buildDividendOptimizerPrompt(input.language, undefined, nitContext);

  const userContent = [
    'Calcula los tres escenarios de distribucion de dividendos sobre los totales vinculantes:',
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
        maxOutputTokens: 4000,
        experimental_output: Output.object({ schema: dividendSchema }),
      }),
    { label: 'escudo_survival_dividend', maxAttempts: 3 },
  );

  return result.experimental_output;
}

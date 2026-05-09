// ---------------------------------------------------------------------------
// Submódulo 1: TET Calculator
// ---------------------------------------------------------------------------
// Calcula la Tasa Efectiva de Tributación (TET) y la Tasa de Tributación
// Depurada (TTD, parágrafo 6 Art. 240 ET) sobre los anchors deterministicos
// del balance preprocesado. Una sola llamada al modelo con
// `experimental_output` para obtener {markdown, warnings, data} en una pasada.
// ---------------------------------------------------------------------------

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { withRetry } from '@/lib/agents/utils/retry';
import { buildTetCalculatorPrompt } from '../prompts/tet-calculator.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import type { SurvivalAgentInput, TetCalculatorResult } from '../types';

const tetSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    tet: z.number(),
    ttd: z.number(),
    nivelAlerta: z.enum(['verde', 'amarillo', 'rojo']),
    impuestoProyectado: z.number(),
    uai: z.number(),
    sugerenciasOptimizacion: z
      .array(
        z.object({
          norma: z.string(),
          ahorroEstimado: z.number(),
          requisitos: z.array(z.string()),
          factibilidad: z.enum(['alta', 'media', 'baja']),
        }),
      )
      .default([]),
  }),
});

export async function runTetCalculator(
  input: SurvivalAgentInput,
): Promise<TetCalculatorResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit}, sector ${company.sector ?? 'no especificado'}, CIIU ${company.ciiu ?? 'no especificado'})`
    : undefined;

  const systemPrompt = buildTetCalculatorPrompt(input.language, undefined, nitContext);

  const userContent = [
    'Calcula la TET, la TTD (parag. 6 Art. 240 E.T.) y nivel de alerta sobre los siguientes totales vinculantes:',
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
        experimental_output: Output.object({ schema: tetSchema }),
      }),
    { label: 'escudo_survival_tet', maxAttempts: 3 },
  );

  return result.experimental_output;
}

// ---------------------------------------------------------------------------
// Submódulo 3: Anti-DIAN Preventivo
// ---------------------------------------------------------------------------
// Bancarizacion (Estatuto Tributario, articulo 771 numeral 5) + cruce con
// informacion exogena (Resolucion DIAN 000227/2025 + 000233/2025).
// ---------------------------------------------------------------------------

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { withRetry } from '@/lib/agents/utils/retry';
import { buildAntiDianAuditorPrompt } from '../prompts/anti-dian-auditor.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import type { SurvivalAgentInput, AntiDianResult } from '../types';

const antiDianSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    pagosEfectivoTotal: z.number(),
    pagosNoDeduciblesIndividuales: z
      .array(
        z.object({
          beneficiarioNit: z.string().optional(),
          beneficiarioNombre: z.string().optional(),
          monto: z.number(),
          excesoUvt: z.number(),
          norma: z.literal('Art. 771-5 §2 E.T.'),
        }),
      )
      .default([]),
    excesoNoDeducibleGeneral: z.number(),
    crucesExogenaSospechosos: z
      .array(
        z.object({
          cuenta: z.string(),
          terceroNit: z.string().optional(),
          diferenciaEstimada: z.number(),
          norma: z.string(),
        }),
      )
      .default([]),
    mayorImpuestoEstimado: z.number(),
  }),
});

export async function runAntiDianAuditor(
  input: SurvivalAgentInput,
): Promise<AntiDianResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const systemPrompt = buildAntiDianAuditorPrompt(input.language, undefined, nitContext);

  const userContent = [
    'Audita el riesgo de fiscalizacion DIAN sobre los totales vinculantes siguientes:',
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
        maxOutputTokens: 4500,
        experimental_output: Output.object({ schema: antiDianSchema }),
      }),
    { label: 'escudo_survival_antidian', maxAttempts: 3 },
  );

  return result.experimental_output;
}

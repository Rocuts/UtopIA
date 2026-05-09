// ---------------------------------------------------------------------------
// Submódulo 2: Escudo de Retenciones
// ---------------------------------------------------------------------------
// Lee saldo cuenta 1355 (Anticipos), proyecta saldo a favor y sugiere
// acciones para liberar capital atrapado en la DIAN.
// ---------------------------------------------------------------------------

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { withRetry } from '@/lib/agents/utils/retry';
import { buildRetentionShieldPrompt } from '../prompts/retention-shield.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import type { SurvivalAgentInput, RetentionShieldResult } from '../types';

const retentionSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    retencionesAcumuladas: z.number(),
    impuestoProyectado: z.number(),
    saldoAFavorProyectado: z.number(),
    acciones: z
      .array(
        z.object({
          tipo: z.enum([
            'certif_no_retencion',
            'autorretenedor',
            'compensacion',
            'devolucion',
          ]),
          norma: z.string(),
          dificultad: z.enum(['baja', 'media', 'alta']),
          riesgo: z.string(),
        }),
      )
      .default([]),
  }),
});

export async function runRetentionShield(
  input: SurvivalAgentInput,
): Promise<RetentionShieldResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const systemPrompt = buildRetentionShieldPrompt(input.language, undefined, nitContext);

  // Hint del impuesto proyectado (UAI x 35%) para que el modelo no tenga que
  // recalcularlo. Este es el caso default cuando el TET Calculator no le ha
  // pasado un valor — los 5 agentes corren en paralelo, no en serie.
  const impuestoHint = Math.max(0, anchors.utilidadAntesImpuestos) * 0.35;

  const userContent = [
    'Calcula el escudo de retenciones para los totales vinculantes siguientes:',
    '',
    anchorBlock,
    '',
    `Impuesto proyectado de referencia (UAI x 35%): $${impuestoHint.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`,
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
        experimental_output: Output.object({ schema: retentionSchema }),
      }),
    { label: 'escudo_survival_retention', maxAttempts: 3 },
  );

  return result.experimental_output;
}

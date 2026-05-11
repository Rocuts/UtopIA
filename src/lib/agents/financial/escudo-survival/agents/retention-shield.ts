// ---------------------------------------------------------------------------
// Submódulo 2: Escudo de Retenciones
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `RetentionShieldReportSchema` + `MODELS_CONFIG.retentionShield`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildRetentionShieldPrompt } from '../prompts/retention-shield.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import { RetentionShieldReportSchema } from '../../contracts/escudo-survival';
import type { SurvivalAgentInput, RetentionShieldResult } from '../types';

export async function runRetentionShield(
  input: SurvivalAgentInput,
): Promise<RetentionShieldResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  // Hint del impuesto proyectado (UAI x 35%) para evitar recalculo. Los 5
  // agentes corren en paralelo (no en serie), por eso este hint suple al TET.
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

  const { json } = await callFinancialAgent({
    agentName: 'escudo-survival-retention',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: RetentionShieldReportSchema,
    system: buildRetentionShieldPrompt(input.language, undefined, nitContext),
    userContent,
    ...MODELS_CONFIG.retentionShield,
  });

  return json as RetentionShieldResult;
}

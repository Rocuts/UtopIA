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
import { enforceRetention } from '../lib/deterministic-survival';
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

  const userContent = [
    'Calcula el escudo de retenciones para los totales vinculantes siguientes:',
    '',
    anchorBlock,
    '',
    `Impuesto de renta causado en libros (clase 54): $${anchors.impuestoCausado.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`,
    'Saldo a favor: N/D — sin la declaración de renta no hay saldo a favor determinable; no recomiendes devolución.',
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

  // Crédito de renta (lista blanca), impuesto causado y saldo N/D: deterministas.
  return enforceRetention(json as RetentionShieldResult, anchors);
}

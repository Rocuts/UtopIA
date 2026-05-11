// ---------------------------------------------------------------------------
// Submódulo 5: Optimización de Dividendos
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `DividendOptimizationReportSchema` + `MODELS_CONFIG.dividendOptimizer`.
//
// El validator C1.6 enforza data.escenarios.capitalizarTotal.impuestoSocio = 0
// (INCRGNO Art. 36-3 E.T.) — el prompt lo declara como invariante.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildDividendOptimizerPrompt } from '../prompts/dividend-optimizer.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import { DividendOptimizationReportSchema } from '../../contracts/escudo-survival';
import type { SurvivalAgentInput, DividendOptimizerResult } from '../types';

export async function runDividendOptimizer(
  input: SurvivalAgentInput,
): Promise<DividendOptimizerResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const userContent = [
    'Calcula los tres escenarios de distribucion de dividendos sobre los totales vinculantes:',
    '',
    anchorBlock,
    '',
    input.instructions ? `INSTRUCCIONES ADICIONALES:\n${input.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'escudo-survival-dividend',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: DividendOptimizationReportSchema,
    system: buildDividendOptimizerPrompt(input.language, undefined, nitContext),
    userContent,
    ...MODELS_CONFIG.dividendOptimizer,
  });

  return json as DividendOptimizerResult;
}

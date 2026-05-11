// ---------------------------------------------------------------------------
// Submódulo 4: Reserva de Contingencia
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `ContingencyReserveReportSchema` + `MODELS_CONFIG.contingencyReserve`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildContingencyReservePrompt } from '../prompts/contingency-reserve.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import { ContingencyReserveReportSchema } from '../../contracts/escudo-survival';
import type { SurvivalAgentInput, ContingencyReserveResult } from '../types';

export async function runContingencyReserve(
  input: SurvivalAgentInput,
): Promise<ContingencyReserveResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const userContent = [
    'Calcula la reserva de contingencia (10% utilidad neta) y revisa la reserva legal del Art. 452 C.Co. sobre los totales:',
    '',
    anchorBlock,
    '',
    input.instructions ? `INSTRUCCIONES ADICIONALES:\n${input.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'escudo-survival-reserve',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: ContingencyReserveReportSchema,
    system: buildContingencyReservePrompt(input.language, undefined, nitContext),
    userContent,
    ...MODELS_CONFIG.contingencyReserve,
  });

  return json as ContingencyReserveResult;
}

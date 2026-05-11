// ---------------------------------------------------------------------------
// Submódulo 3: Anti-DIAN Preventivo
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `AntiDianAuditReportSchema` + `MODELS_CONFIG.antiDianAuditor`.
//
// La defensa Art. 647 E.T. exige cita textual de "Art. 771-5" en el markdown
// (validator C3.2). Cada CashPaymentViolation tiene norma = "Art. 771-5 §2 E.T."
// como literal estricto en el schema.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildAntiDianAuditorPrompt } from '../prompts/anti-dian-auditor.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import { AntiDianAuditReportSchema } from '../../contracts/escudo-survival';
import type { SurvivalAgentInput, AntiDianResult } from '../types';

export async function runAntiDianAuditor(
  input: SurvivalAgentInput,
): Promise<AntiDianResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit})`
    : undefined;

  const userContent = [
    'Audita el riesgo de fiscalizacion DIAN sobre los totales vinculantes siguientes:',
    '',
    anchorBlock,
    '',
    input.instructions ? `INSTRUCCIONES ADICIONALES:\n${input.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'escudo-survival-antidian',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: AntiDianAuditReportSchema,
    system: buildAntiDianAuditorPrompt(input.language, undefined, nitContext),
    userContent,
    ...MODELS_CONFIG.antiDianAuditor,
  });

  return json as AntiDianResult;
}

// ---------------------------------------------------------------------------
// Submódulo 1: TET Calculator
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` + `TetReportSchema`
// migrado a `contracts/escudo-survival.ts` + `MODELS_CONFIG.tetCalculator`.
//
// El shape de salida ({markdown, warnings, data}) se preserva al 100% porque
// `survival-validators.ts` lo lee directo. No hace falta adapter; el schema
// migrado es identico al inline previo.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildTetCalculatorPrompt } from '../prompts/tet-calculator.prompt';
import { extractSurvivalAnchors, buildAnchorBlock } from '../lib/extract-totals';
import { TetReportSchema } from '../../contracts/escudo-survival';
import type { SurvivalAgentInput, TetCalculatorResult } from '../types';

export async function runTetCalculator(
  input: SurvivalAgentInput,
): Promise<TetCalculatorResult> {
  const anchors = extractSurvivalAnchors(input.preprocessed);
  const anchorBlock = buildAnchorBlock(anchors);

  const company = input.company ?? {};
  const nitContext = company.nit
    ? `${company.name ?? 'empresa'} (NIT ${company.nit}, sector ${company.sector ?? 'no especificado'}, CIIU ${company.ciiu ?? 'no especificado'})`
    : undefined;

  const userContent = [
    'Calcula la TET, la TTD (parag. 6 Art. 240 E.T.) y nivel de alerta sobre los siguientes totales vinculantes:',
    '',
    anchorBlock,
    '',
    input.instructions ? `INSTRUCCIONES ADICIONALES:\n${input.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'escudo-survival-tet',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TetReportSchema,
    system: buildTetCalculatorPrompt(input.language, undefined, nitContext),
    userContent,
    ...MODELS_CONFIG.tetCalculator,
  });

  // El shape de TetReportSchema coincide con TetCalculatorResult (extensions de
  // AgentResultBase). La aseveracion `as TetCalculatorResult` evita un mapeo
  // identidad ruidoso — Zod ya garantizo el shape, y los tests del validator
  // confirman compatibilidad.
  return json as TetCalculatorResult;
}

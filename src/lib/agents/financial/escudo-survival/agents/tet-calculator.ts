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
import { computeTetContable, enforceTet } from '../lib/deterministic-survival';
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

  const tetContable = computeTetContable(anchors);
  const userContent = [
    'Redacta el análisis de la tasa efectiva contable sobre los totales vinculantes. Las cifras de data las fija el sistema:',
    '',
    anchorBlock,
    '',
    `TET contable (impuesto causado / UAI): ${tetContable.tet === null ? 'N/D (UAI ≤ 0)' : `${(tetContable.tet * 100).toFixed(2)}%`}`,
    `Nivel de alerta (heurística interna): ${tetContable.nivelAlerta ?? 'N/D'}`,
    'TTD (parág. 6 Art. 240 E.T.): N/D — faltan impuesto depurado (ID) y utilidad depurada (UD).',
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

  // TET contable, nivel, UAI e impuesto causado: deterministas; TTD = null
  // (auditoría 2026-09, tributario-modulos-06). El LLM sólo narra y sugiere.
  return enforceTet(json as TetCalculatorResult, anchors);
}

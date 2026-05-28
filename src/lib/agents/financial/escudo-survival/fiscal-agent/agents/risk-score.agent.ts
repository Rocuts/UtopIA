// ---------------------------------------------------------------------------
// Capa 4 — Módulo 3 — Agente: Score Riesgo DIAN
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildRiskScorePrompt } from '../prompts/risk-score.prompt';
import { riskScoreModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { computeRiskScore } from '../tools/risk-score-calculator';
import type { FiscalAgentInput, RiskScoreModuleResult } from '../types';

export interface RiskScoreAgentOptions {
  input: FiscalAgentInput;
  signal?: AbortSignal;
}

export async function runRiskScoreAgent(
  opts: RiskScoreAgentOptions,
): Promise<RiskScoreModuleResult> {
  const { input } = opts;
  const breakdown = computeRiskScore({
    anchor: input.fiscalAnchor,
    preprocessed: input.preprocessed,
  });

  const system = buildRiskScorePrompt(input.language, input.company.nit);

  const userContent = `<context>
SCORE_RIESGO_DIAN_PRECOMPUTADO (vinculante — no recalcular):
  Score total: ${breakdown.score}/100
  Nivel: ${breakdown.nivel}
  Factores:
${breakdown.factores
  .map(
    (f) =>
      `    - ${f.factor} → ${f.puntos} pts | ${f.descripcion}\n      detalle: ${f.detalle}`,
  )
  .join('\n')}

ANCLAS_FISCALES (referencia):
  F01 UAI: ${formatCopFromCents(BigInt(input.fiscalAnchor.f01))}
  F02 Imp. ref. 35%: ${formatCopFromCents(BigInt(input.fiscalAnchor.f02))}
  F03 Retenciones: ${formatCopFromCents(BigInt(input.fiscalAnchor.f03))}
  F04 Saldo neto: ${formatCopFromCents(BigInt(input.fiscalAnchor.f04))}
  F09 TET: ${input.fiscalAnchor.f09}%
  F10 Cobertura: ${input.fiscalAnchor.f10}%

DATOS_EMPRESA:
  Sector: ${input.company.sector ?? 'no provisto'}
  CIIU: ${input.company.ciiu ?? 'no provisto'}

PERIODO: ${input.fiscalAnchor.fuente.periodo}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'risk-score',
    slot: 'escudoFiscalRiskScore',
    schema: riskScoreModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  return json;
}

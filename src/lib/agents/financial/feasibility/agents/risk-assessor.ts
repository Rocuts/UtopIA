// ---------------------------------------------------------------------------
// Agente 3: Evaluador de Riesgos (Feasibility)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `RiskAssessmentReportSchema` + `MODELS_CONFIG.riskAssessor`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildRiskAssessorPrompt } from '../prompts/risk-assessor.prompt';
import {
  RiskAssessmentReportSchema,
  type RiskAssessmentReportJson,
  type RiskItemJson,
} from '../../contracts/feasibility';
import type {
  ProjectInfo,
  MarketAnalysisResult,
  FinancialModelResult,
  RiskAssessmentResult,
  FeasibilityProgressEvent,
} from '../types';

/**
 * Takes outputs from Agent 1 (Market) and Agent 2 (Financial) to produce
 * a comprehensive risk assessment with go/no-go recommendation.
 */
export async function runRiskAssessor(
  marketOutput: MarketAnalysisResult,
  financialOutput: FinancialModelResult,
  project: ProjectInfo,
  language: 'es' | 'en',
  onProgress?: (event: FeasibilityProgressEvent) => void,
): Promise<RiskAssessmentResult> {
  onProgress?.({ type: 'stage_progress', stage: 3, detail: 'Evaluando riesgos y construyendo matriz probabilidad-impacto...' });

  const userContent = [
    '=== ANALISIS DE MERCADO (Agente 1) ===',
    '',
    marketOutput.fullContent,
    '',
    '=== MODELO FINANCIERO (Agente 2) ===',
    '',
    financialOutput.fullContent,
  ].join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'risk-assessor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: RiskAssessmentReportSchema,
    system: buildRiskAssessorPrompt(project, language),
    userContent,
    ...MODELS_CONFIG.riskAssessor,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> RiskAssessmentResult legacy
// ---------------------------------------------------------------------------

function toLegacyShape(json: RiskAssessmentReportJson): RiskAssessmentResult {
  const decisionLabel: Record<typeof json.goNoGoDecision, string> = {
    go: 'GO — Recomendado',
    go_con_condiciones: 'GO CON CONDICIONES',
    no_go: 'NO-GO',
  };

  const riskMatrixMd = renderRiskMatrix(json.riskMatrix);
  const goNoGoMd = `**Decision:** ${decisionLabel[json.goNoGoDecision]}\n\n${json.goNoGoRationale}`;

  const fullContent = [
    '## 1. MATRIZ DE RIESGOS',
    '',
    riskMatrixMd,
    '',
    '## 2. VPN AJUSTADO POR RIESGO',
    '',
    json.riskAdjustedNpv,
    '',
    '## 3. ESTRATEGIAS DE MITIGACION',
    '',
    json.mitigationStrategies,
    '',
    '## 4. RECOMENDACIONES DE SEGUROS Y COBERTURAS',
    '',
    json.insuranceRecommendations,
    '',
    '## 5. RECOMENDACION GO / NO-GO',
    '',
    goNoGoMd,
    '',
    '## 6. RESUMEN EJECUTIVO',
    '',
    json.executiveSummary,
  ].join('\n');

  return {
    riskMatrix: riskMatrixMd,
    riskAdjustedNpv: json.riskAdjustedNpv,
    mitigationStrategies: json.mitigationStrategies,
    insuranceRecommendations: json.insuranceRecommendations,
    goNoGoRecommendation: goNoGoMd,
    executiveSummary: json.executiveSummary,
    fullContent,
  };
}

function renderRiskMatrix(items: RiskItemJson[]): string {
  if (items.length === 0) return '(Sin riesgos identificados)';
  const header = '| # | Categoria | Descripcion | P | I | Score | Clasificacion | Norma |';
  const sep = '|---|---|---|---:|---:|---:|---|---|';
  const rows = items
    .map(
      (r, idx) =>
        `| ${idx + 1} | ${r.category} | ${r.description.replace(/\|/g, '\\|')} | ${r.probability} | ${r.impact} | ${r.score} | ${r.classification} | ${r.normReference ?? '—'} |`,
    )
    .join('\n');
  const mitigations = items
    .filter((r) => r.classification === 'alto' || r.classification === 'critico')
    .map((r, idx) => `${idx + 1}. (${r.category}) ${r.description} → Mitigacion: ${r.mitigation}`)
    .join('\n');
  return [header, sep, rows, '', '**Mitigaciones para riesgos altos/criticos:**', '', mitigations || '(Sin riesgos altos/criticos)']
    .join('\n');
}

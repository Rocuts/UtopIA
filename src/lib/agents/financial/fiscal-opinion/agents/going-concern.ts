// ---------------------------------------------------------------------------
// Evaluador de Empresa en Marcha (NIA 570)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4: usa `callFinancialAgent` con
// `GoingConcernReportSchema` + `MODELS_CONFIG.goingConcernAuditor`. El adapter
// local convierte el JSON validado al `GoingConcernResult` legacy que consumen
// el orchestrator y el opinion-drafter.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildGoingConcernPrompt } from '../prompts/going-concern.prompt';
import {
  GoingConcernReportSchema,
  type GoingConcernReportJson,
} from '../../contracts/fiscal-opinion';
import type { CompanyInfo } from '../../types';
import type {
  GoingConcernResult,
  FiscalOpinionProgressEvent,
} from '../types';

export async function runGoingConcernEvaluator(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<GoingConcernResult> {
  onProgress?.({
    type: 'evaluator_progress',
    domain: 'empresa_en_marcha',
    detail: 'Evaluando hipotesis de empresa en marcha (NIA 570)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'going-concern',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: GoingConcernReportSchema,
    system: buildGoingConcernPrompt(company, language),
    userContent: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.goingConcernAuditor,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> GoingConcernResult legacy
// ---------------------------------------------------------------------------

function toLegacyShape(json: GoingConcernReportJson): GoingConcernResult {
  const fullContent = renderGoingConcernMarkdown(json);
  return {
    assessment: json.assessment,
    conclusion: json.conclusion,
    indicators: json.indicators.map((i) => ({
      category: i.category,
      description: i.description,
      severity: i.severity,
      normReference: i.normReference,
    })),
    recommendedDisclosures: [...json.recommendedDisclosures],
    analysis: json.analysis,
    fullContent,
  };
}

function renderGoingConcernMarkdown(json: GoingConcernReportJson): string {
  const indicatorLines = json.indicators
    .map((i) => `- [${i.severity.toUpperCase()}] (${i.category}) ${i.description} — ${i.normReference}`)
    .join('\n');
  const disclosureLines = json.recommendedDisclosures.map((d) => `- ${d}`).join('\n');
  return [
    '## EVALUACION',
    '',
    json.assessment,
    '',
    '## CONCLUSION NIA 570',
    '',
    json.conclusion,
    '',
    '## INDICADORES',
    '',
    indicatorLines || '(Ninguno)',
    '',
    '## REVELACIONES RECOMENDADAS',
    '',
    disclosureLines || '(Ninguna)',
    '',
    '## ANALISIS DETALLADO',
    '',
    json.analysis,
  ].join('\n');
}

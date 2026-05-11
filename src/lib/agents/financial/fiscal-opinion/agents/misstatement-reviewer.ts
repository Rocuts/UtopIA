// ---------------------------------------------------------------------------
// Revisor de Incorrecciones Materiales (NIA 315/320/330/450)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `MisstatementReviewReportSchema` + `MODELS_CONFIG.misstatementReviewer`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildMisstatementReviewerPrompt } from '../prompts/misstatement-reviewer.prompt';
import {
  MisstatementReviewReportSchema,
  type MisstatementReviewReportJson,
} from '../../contracts/fiscal-opinion';
import type { CompanyInfo } from '../../types';
import type {
  MisstatementResult,
  FiscalOpinionProgressEvent,
} from '../types';

export async function runMisstatementReviewer(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<MisstatementResult> {
  onProgress?.({
    type: 'evaluator_progress',
    domain: 'incorrecciones',
    detail: 'Calculando materialidad y evaluando incorrecciones (NIA 320/450)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'misstatement-reviewer',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: MisstatementReviewReportSchema,
    system: buildMisstatementReviewerPrompt(company, language),
    userContent: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.misstatementReviewer,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> MisstatementResult legacy
// ---------------------------------------------------------------------------

function toLegacyShape(json: MisstatementReviewReportJson): MisstatementResult {
  const totalUncorrected = json.misstatements
    .filter((m) => !m.corrected)
    .reduce((sum, m) => sum + m.amount, 0);

  // El LLM puede haber reportado un totalUncorrected ligeramente distinto;
  // usamos el recalculo determinista para no propagar errores.
  const fullContent = renderMisstatementMarkdown(json, totalUncorrected);

  return {
    materiality: { ...json.materiality },
    misstatements: json.misstatements.map((m) => ({ ...m })),
    totalUncorrected,
    materialInAggregate: json.materialInAggregate,
    assessment: json.assessment,
    analysis: json.analysis,
    fullContent,
  };
}

function renderMisstatementMarkdown(
  json: MisstatementReviewReportJson,
  totalUncorrected: number,
): string {
  const fmt = (n: number) =>
    (n < 0 ? '-' : '') +
    '$' +
    Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const misstatementLines = json.misstatements
    .map(
      (m) =>
        `- [${m.code}] (${m.type}) ${m.description} — ${fmt(m.amount)} — ${m.corrected ? 'Corregida' : 'NO corregida'} — ${m.affectedArea} — ${m.normReference}`,
    )
    .join('\n');

  return [
    '## MATERIALIDAD',
    '',
    `- Benchmark: ${json.materiality.benchmark}`,
    `- Monto base: ${fmt(json.materiality.baseAmount)}`,
    `- Materialidad global: ${fmt(json.materiality.materialityThreshold)}`,
    `- Materialidad de ejecucion: ${fmt(json.materiality.performanceMateriality)}`,
    `- Umbral de trivialidad: ${fmt(json.materiality.trivialThreshold)}`,
    '',
    '## INCORRECCIONES IDENTIFICADAS',
    '',
    misstatementLines || '(Ninguna)',
    '',
    '## EFECTO AGREGADO',
    '',
    `- Total incorrecciones no corregidas: ${fmt(totalUncorrected)}`,
    `- Materialidad: ${fmt(json.materiality.materialityThreshold)}`,
    `- Material en conjunto: ${json.materialInAggregate ? 'SI' : 'NO'}`,
    '',
    '## EVALUACION',
    '',
    json.assessment,
    '',
    '## ANALISIS DETALLADO',
    '',
    json.analysis,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Verificador de Cumplimiento Estatutario (Art. 207 C.Co.)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `ComplianceCheckReportSchema` + `MODELS_CONFIG.complianceChecker`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildComplianceCheckerPrompt } from '../prompts/compliance-checker.prompt';
import {
  ComplianceCheckReportSchema,
  type ComplianceCheckReportJson,
} from '../../contracts/fiscal-opinion';
import type { CompanyInfo } from '../../types';
import type {
  ComplianceResult,
  FiscalOpinionProgressEvent,
} from '../types';
import {
  evaluateSagrilaft,
  isSagrilaftItem,
  readSagrilaftInputs,
  SAGRILAFT_FUENTE,
  type SagrilaftEvaluation,
} from '../sagrilaft';

export async function runComplianceChecker(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
  preprocessed?: unknown,
): Promise<ComplianceResult> {
  onProgress?.({
    type: 'evaluator_progress',
    domain: 'cumplimiento',
    detail: 'Verificando cumplimiento estatutario (Art. 207 C.Co.)...',
  });

  const sagrilaft = evaluateSagrilaft(readSagrilaftInputs(preprocessed));

  const { json } = await callFinancialAgent({
    agentName: 'compliance-checker',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: ComplianceCheckReportSchema,
    system: buildComplianceCheckerPrompt(company, language, sagrilaft),
    userContent: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.complianceChecker,
  });

  return toLegacyShape(json, sagrilaft);
}

// ---------------------------------------------------------------------------
// Override determinista SAGRILAFT (prompts-normativa-02)
// ---------------------------------------------------------------------------

/**
 * Sin constancia de vigilancia por Supersociedades la obligatoriedad del
 * SAGRILAFT no es afirmable: un ítem SAGRILAFT en `no_cumple` pasa a
 * `no_evaluado` (con la norma y el motivo) y sale de `nonComplianceItems`.
 */
export function applySagrilaftOverride(
  json: ComplianceCheckReportJson,
  sagrilaft: SagrilaftEvaluation,
): ComplianceCheckReportJson {
  if (sagrilaft.obligada !== 'no_determinable') return json;
  type Item = ComplianceCheckReportJson['regulatoryItems'][number];
  const fix = (item: Item): Item =>
    isSagrilaftItem(item) && item.status === 'no_cumple'
      ? {
          ...item,
          status: 'no_evaluado',
          normReference: SAGRILAFT_FUENTE,
          observation: `No evaluado: ${sagrilaft.motivo} (antes: ${item.observation})`,
        }
      : item;
  return {
    ...json,
    regulatoryItems: json.regulatoryItems.map(fix),
    nonComplianceItems: json.nonComplianceItems.filter((i) => !(isSagrilaftItem(i) && i.status === 'no_cumple')),
  };
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> ComplianceResult legacy
// ---------------------------------------------------------------------------

export function toLegacyShape(
  rawJson: ComplianceCheckReportJson,
  sagrilaft: SagrilaftEvaluation = evaluateSagrilaft({ activosCop: null, ingresosCop: null }),
): ComplianceResult {
  const json = applySagrilaftOverride(rawJson, sagrilaft);
  const fullContent = renderComplianceMarkdown(json);
  return {
    statutoryFunctions: json.statutoryFunctions.map((f) => ({ ...f })),
    regulatoryItems: json.regulatoryItems.map((i) => ({ ...i })),
    independenceAssessment: json.independenceAssessment,
    nonComplianceItems: json.nonComplianceItems.map((i) => ({ ...i })),
    complianceScore: Math.min(100, Math.max(0, Math.round(json.complianceScore))),
    analysis: json.analysis,
    fullContent,
  };
}

function renderComplianceMarkdown(json: ComplianceCheckReportJson): string {
  const fnLines = json.statutoryFunctions
    .sort((a, b) => a.number - b.number)
    .map(
      (f) =>
        `- Funcion ${f.number}: ${f.status.toUpperCase()} — ${f.description}${f.observations ? ` (${f.observations})` : ''}`,
    )
    .join('\n');

  const regLines = json.regulatoryItems
    .map(
      (i) =>
        `- [${i.code}] (${i.area}) ${i.requirement} — ${i.status.toUpperCase()} — ${i.normReference}${i.observation ? `: ${i.observation}` : ''}`,
    )
    .join('\n');

  const incLines = json.nonComplianceItems
    .map(
      (i) =>
        `- [${i.code}] (${i.area}) ${i.requirement} — ${i.normReference}: ${i.observation}`,
    )
    .join('\n');

  return [
    '## MATRIZ ESTATUTARIA (ART. 207 C.Co.)',
    '',
    fnLines,
    '',
    '## CUMPLIMIENTO REGULATORIO',
    '',
    regLines || '(Sin items)',
    '',
    '## INDEPENDENCIA',
    '',
    json.independenceAssessment,
    '',
    '## INCUMPLIMIENTOS',
    '',
    incLines || '(Ninguno)',
    '',
    '## SCORE',
    '',
    `${json.complianceScore}`,
    '',
    '## ANALISIS DETALLADO',
    '',
    json.analysis,
  ].join('\n');
}

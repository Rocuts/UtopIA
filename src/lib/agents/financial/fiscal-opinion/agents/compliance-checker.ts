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

export async function runComplianceChecker(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<ComplianceResult> {
  onProgress?.({
    type: 'evaluator_progress',
    domain: 'cumplimiento',
    detail: 'Verificando cumplimiento estatutario (Art. 207 C.Co.)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'compliance-checker',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: ComplianceCheckReportSchema,
    system: buildComplianceCheckerPrompt(company, language),
    userContent: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.complianceChecker,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> ComplianceResult legacy
// ---------------------------------------------------------------------------

function toLegacyShape(json: ComplianceCheckReportJson): ComplianceResult {
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

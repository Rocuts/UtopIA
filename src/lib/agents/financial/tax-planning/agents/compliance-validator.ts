// ---------------------------------------------------------------------------
// Agente 3: Validador de Cumplimiento Regulatorio (Compliance & Risk)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildComplianceValidatorPrompt } from '../prompts/compliance-validator.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type {
  TaxOptimizerResult,
  NiifImpactResult,
  ComplianceValidatorResult,
  TaxPlanningProgressEvent,
} from '../types';

/**
 * Takes the outputs from Agent 1 (Tax Optimizer) and Agent 2 (NIIF Impact) and
 * validates regulatory compliance, anti-abuse risk, and documentation requirements.
 */
export async function runComplianceValidator(
  taxOptimizerOutput: TaxOptimizerResult,
  niifImpactOutput: NiifImpactResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TaxPlanningProgressEvent) => void,
): Promise<ComplianceValidatorResult> {
  const systemPrompt = buildComplianceValidatorPrompt(company, language);

  const userContent = [
    '=== ESTRATEGIAS DEL OPTIMIZADOR TRIBUTARIO (Agente 1) ===',
    '',
    taxOptimizerOutput.fullContent,
    '',
    '=== ANALISIS DE IMPACTO NIIF (Agente 2) ===',
    '',
    niifImpactOutput.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 3,
    detail: 'Validando cumplimiento regulatorio y evaluando riesgos anti-abuso...',
  });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        maxOutputTokens: 8192,
      }),
    { label: 'compliance_validator', maxAttempts: 3 },
  );

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    riskAssessment:
      sections['1. EVALUACION DE RIESGO REGULATORIO POR ESTRATEGIA'] || sections['1'] || '',
    complianceChecklist:
      sections['2. CHECKLIST DE CUMPLIMIENTO REGULATORIO'] || sections['2'] || '',
    documentationRequirements:
      sections['3. REQUISITOS DOCUMENTALES'] || sections['3'] || '',
    regulatoryRedFlags:
      sections['4. BANDERAS ROJAS Y ALERTAS REGULATORIAS'] || sections['4'] || '',
    fullContent,
  };
}

/**
 * Parse numbered `## N. TITLE` sections from Markdown content.
 */
function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const pattern = /^##\s+(\d+\.?\s*[^\n]*)/gm;
  const matches = [...content.matchAll(pattern)];

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    sections[key] = content.slice(start, end).trim();
    const numMatch = key.match(/^(\d+)/);
    if (numMatch) sections[numMatch[1]] = sections[key];
  }

  return sections;
}

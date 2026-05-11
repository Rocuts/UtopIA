// ---------------------------------------------------------------------------
// Agente 3: Compliance Validator — outcome-first GPT-5.4
// ---------------------------------------------------------------------------
// Consume los outputs legacy del Tax Optimizer (Agente 1) y del NIIF Impact
// Analyst (Agente 2). Emite `ComplianceValidationReportJson`. Adapter local
// sintetiza el shape legacy `ComplianceValidatorResult`.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import {
  ComplianceValidationReportSchema,
  type ComplianceValidationReportJson,
} from '../../contracts/tax-planning';
import { buildComplianceValidatorPrompt } from '../prompts/compliance-validator.prompt';
import type { CompanyInfo } from '../../types';
import type {
  TaxOptimizerResult,
  NiifImpactResult,
  ComplianceValidatorResult,
  TaxPlanningProgressEvent,
} from '../types';

/**
 * Takes outputs from Agent 1 (Tax Optimizer) and Agent 2 (NIIF Impact) and
 * validates regulatory compliance, anti-abuse risk, and documentation
 * requirements. Builds the Art. 647 E.T. defense (Diferencia de Criterio)
 * for medium/high-risk strategies.
 */
export async function runComplianceValidator(
  taxOptimizerOutput: TaxOptimizerResult,
  niifImpactOutput: NiifImpactResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TaxPlanningProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ComplianceValidatorResult> {
  const system = buildComplianceValidatorPrompt(company, language);

  const userContent = [
    '<context>',
    '=== ESTRATEGIAS DEL OPTIMIZADOR TRIBUTARIO (Agente 1) ===',
    '',
    taxOptimizerOutput.fullContent,
    '',
    '=== ANALISIS DE IMPACTO NIIF (Agente 2) ===',
    '',
    niifImpactOutput.fullContent,
    '</context>',
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 3,
    detail: 'Validando cumplimiento regulatorio y evaluando riesgos anti-abuso...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'compliance-validator',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: ComplianceValidationReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.complianceValidator,
    signal,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local
// ---------------------------------------------------------------------------

function toLegacyShape(json: ComplianceValidationReportJson): ComplianceValidatorResult {
  const riskAssessment = renderRiskAssessment(json);
  const complianceChecklist = renderChecklist(json);
  const documentationRequirements = renderDocs(json);
  const regulatoryRedFlags = renderRedFlags(json);

  const fullContent = [
    `**Dictamen consolidado:** ${json.overallVerdict.toUpperCase()}`,
    '',
    `${json.verdictRationale}`,
    '',
    json.blockers.length > 0
      ? [
          '**Bloqueantes identificados:**',
          '',
          ...json.blockers.map((b) => `- [${b.recommendationId}] ${b.reason} (${b.norma})`),
        ].join('\n')
      : '',
    '',
    '## 1. EVALUACION DE RIESGO REGULATORIO POR ESTRATEGIA',
    '',
    riskAssessment,
    '',
    '## 2. CHECKLIST DE CUMPLIMIENTO REGULATORIO',
    '',
    complianceChecklist,
    '',
    '## 3. REQUISITOS DOCUMENTALES',
    '',
    documentationRequirements,
    '',
    '## 4. BANDERAS ROJAS Y ALERTAS REGULATORIAS',
    '',
    regulatoryRedFlags,
    json.preparerNotes.length > 0
      ? ['', '### Notas del Preparador', ...json.preparerNotes.map((n) => `- ${n}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    riskAssessment,
    complianceChecklist,
    documentationRequirements,
    regulatoryRedFlags,
    fullContent,
  };
}

function renderRiskAssessment(json: ComplianceValidationReportJson): string {
  if (json.riskAssessments.length === 0) return '_Sin evaluaciones disponibles._';
  return json.riskAssessments
    .map((r) => {
      const defense = r.art647DefenseAvailable
        ? `\n- **Defensa Art. 647 E.T. (Diferencia de Criterio):** disponible.\n  - **Sustento:** ${r.art647DefenseRationale ?? '— (sustento doctrinal a confirmar)'}`
        : '\n- **Defensa Art. 647 E.T.:** no aplicable a esta estrategia.';
      return [
        `### Estrategia ${r.recommendationId}`,
        `- **Riesgo:** ${r.riskLevel.toUpperCase()}`,
        `- **Test de propósito comercial (Art. 869 E.T.):** ${r.businessPurposeTestPasses ? 'SUPERA' : 'NO SUPERA'}`,
        `- **Normas potencialmente invocables por DIAN:** ${r.potentialNormas.join('; ')}`,
        `- **Argumento:** ${r.rationale}${defense}`,
      ].join('\n');
    })
    .join('\n\n');
}

function renderChecklist(json: ComplianceValidationReportJson): string {
  if (json.riskAssessments.length === 0) return '_Sin checklist disponible._';
  return json.riskAssessments
    .map((r) => {
      const rows = r.checklist
        .map((c) => `- [${c.passes ? 'x' : ' '}] ${c.question}${c.gapAction ? ` — Acción: ${c.gapAction}` : ''}`)
        .join('\n');
      return [`### Estrategia ${r.recommendationId}`, '', rows].join('\n');
    })
    .join('\n\n');
}

function renderDocs(json: ComplianceValidationReportJson): string {
  if (json.documentationRequirements.length === 0) return '_Sin requisitos documentales identificados._';
  return json.documentationRequirements
    .map((d) => {
      const rows = d.documents
        .map(
          (doc) =>
            `- **${doc.document}** (${doc.mandatory ? 'obligatorio' : 'recomendado'})${doc.norma ? ` — ${doc.norma}` : ''}`,
        )
        .join('\n');
      return [`### Estrategia ${d.recommendationId}`, '', rows].join('\n');
    })
    .join('\n\n');
}

function renderRedFlags(json: ComplianceValidationReportJson): string {
  if (json.redFlags.length === 0) return '_Sin banderas rojas identificadas._';
  return json.redFlags
    .map((f) =>
      [
        `### [${f.severity.toUpperCase()}] ${f.flag}`,
        `- **Norma:** ${f.norma}`,
        `- **Estrategias afectadas:** ${f.affectedRecommendations.join(', ')}`,
        `- **Mitigación:** ${f.mitigation}`,
      ].join('\n'),
    )
    .join('\n\n');
}

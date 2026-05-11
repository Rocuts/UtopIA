// ---------------------------------------------------------------------------
// Agente 2: Modelador Financiero (Feasibility)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `FinancialModelReportSchema` + `MODELS_CONFIG.financialModeler`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildFinancialModelerPrompt } from '../prompts/financial-modeler.prompt';
import {
  FinancialModelReportSchema,
  type FinancialModelReportJson,
} from '../../contracts/feasibility';
import type { ProjectInfo, MarketAnalysisResult, FinancialModelResult, FeasibilityProgressEvent } from '../types';

/**
 * Takes market analysis from Agent 1 and builds a complete financial model:
 * pro-forma statements, WACC, NPV, IRR, sensitivity analysis, breakeven.
 */
export async function runFinancialModeler(
  marketOutput: MarketAnalysisResult,
  project: ProjectInfo,
  language: 'es' | 'en',
  onProgress?: (event: FeasibilityProgressEvent) => void,
): Promise<FinancialModelResult> {
  onProgress?.({ type: 'stage_progress', stage: 2, detail: 'Construyendo estados pro-forma y calculando WACC...' });

  const userContent = [
    'ANALISIS DE MERCADO GENERADO POR EL ANALISTA DE MERCADO:',
    '',
    marketOutput.fullContent,
  ].join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'financial-modeler',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: FinancialModelReportSchema,
    system: buildFinancialModelerPrompt(project, language),
    userContent,
    ...MODELS_CONFIG.financialModeler,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> FinancialModelResult legacy
// ---------------------------------------------------------------------------

function toLegacyShape(json: FinancialModelReportJson): FinancialModelResult {
  const fullContent = [
    '## 1. ESTADOS FINANCIEROS PRO-FORMA',
    '',
    json.proFormaStatements,
    '',
    '## 2. ESTRUCTURA DE CAPITAL Y WACC',
    '',
    json.capitalStructure,
    '',
    '## 3. EVALUACION DEL PROYECTO',
    '',
    json.projectEvaluation,
    '',
    '## 4. ANALISIS DE SENSIBILIDAD Y ESCENARIOS',
    '',
    json.sensitivityAnalysis,
    '',
    '## 5. PUNTO DE EQUILIBRIO',
    '',
    json.breakEvenAnalysis,
  ].join('\n');

  return {
    proFormaStatements: json.proFormaStatements,
    capitalStructure: json.capitalStructure,
    projectEvaluation: json.projectEvaluation,
    sensitivityAnalysis: json.sensitivityAnalysis,
    breakEvenAnalysis: json.breakEvenAnalysis,
    fullContent,
  };
}

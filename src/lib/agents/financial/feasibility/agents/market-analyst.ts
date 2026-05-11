// ---------------------------------------------------------------------------
// Agente 1: Analista de Mercado (Feasibility)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `MarketAnalysisReportSchema` + `MODELS_CONFIG.marketAnalyst`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildMarketAnalystPrompt } from '../prompts/market-analyst.prompt';
import {
  MarketAnalysisReportSchema,
  type MarketAnalysisReportJson,
} from '../../contracts/feasibility';
import type { ProjectInfo, MarketAnalysisResult, FeasibilityProgressEvent } from '../types';

/**
 * Analyzes market viability: TAM/SAM/SOM, target segment, competitive landscape,
 * demand projections, and regulatory entry barriers for the Colombian market.
 */
export async function runMarketAnalyst(
  projectData: string,
  project: ProjectInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: FeasibilityProgressEvent) => void,
): Promise<MarketAnalysisResult> {
  onProgress?.({ type: 'stage_progress', stage: 1, detail: 'Dimensionando mercado y analizando segmento objetivo...' });

  const userContent = [
    'DATOS DEL PROYECTO PARA ANALISIS DE MERCADO:',
    '',
    projectData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'market-analyst',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: MarketAnalysisReportSchema,
    system: buildMarketAnalystPrompt(project, language),
    userContent,
    ...MODELS_CONFIG.marketAnalyst,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> MarketAnalysisResult legacy
// ---------------------------------------------------------------------------

function toLegacyShape(json: MarketAnalysisReportJson): MarketAnalysisResult {
  const fullContent = [
    '## 1. DIMENSIONAMIENTO DEL MERCADO',
    '',
    json.marketSize,
    '',
    '## 2. ANALISIS DEL SEGMENTO OBJETIVO',
    '',
    json.targetSegment,
    '',
    '## 3. PANORAMA COMPETITIVO',
    '',
    json.competitiveLandscape,
    '',
    '## 4. PROYECCIONES DE DEMANDA',
    '',
    json.demandProjections,
    '',
    '## 5. BARRERAS DE ENTRADA Y REQUISITOS REGULATORIOS',
    '',
    json.entryBarriers,
  ].join('\n');

  return {
    marketSize: json.marketSize,
    targetSegment: json.targetSegment,
    competitiveLandscape: json.competitiveLandscape,
    demandProjections: json.demandProjections,
    entryBarriers: json.entryBarriers,
    fullContent,
  };
}

// ---------------------------------------------------------------------------
// Agente 1: Analista Contable NIIF (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 2.A (2026-05): se reemplaza la llamada legacy `generateText` +
// parser Markdown por `callFinancialAgent` con schema `NiifReportSchema`.
// El struct legacy `NiifAnalysisResult` se obtiene aplicando
// `toNiifAnalysisResult(json)` del renderer determinístico — los consumers
// downstream (Strategy Director, Governance, PDF Élite, Excel) no notan el
// cambio.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from './runtime';
import { toNiifAnalysisResult } from './renderer';
import { NiifReportSchema } from '../contracts/niif-report';
import {
  buildNiifAnalystPrompt,
  type NiifAnalystEliteContext,
} from '../prompts/niif-analyst.prompt';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { CompanyInfo, NiifAnalysisResult, FinancialProgressEvent } from '../types';

/**
 * Processes raw accounting data and produces the 4 NIIF financial statements
 * + technical notes, validated against `NiifReportSchema`.
 *
 * @param rawData       Texto CSV/markdown del balance pre-procesado.
 * @param company       Metadata de la empresa.
 * @param language      es | en
 * @param instructions  Instrucciones adicionales del usuario (propaga A2 a los 3 agentes).
 * @param bindingTotals Bloque Markdown con totales vinculantes (pre-calculados). Se
 *                      antepone al userContent para que el modelo lo vea SIEMPRE.
 * @param preprocessed  PreprocessedBalance completo. El prompt builder lo usa para
 *                      activar el modo comparativo cuando hay >=2 periodos.
 * @param onProgress    Callback de progreso SSE.
 * @param elite         Contexto Élite (R-1..R-6) inyectado por el orquestador.
 * @param signal        AbortSignal opcional para cancelación temprana.
 */
export async function runNiifAnalyst(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  preprocessed: PreprocessedBalance | undefined,
  onProgress?: (event: FinancialProgressEvent) => void,
  elite?: NiifAnalystEliteContext,
  signal?: AbortSignal,
): Promise<NiifAnalysisResult> {
  const systemPrompt = buildNiifAnalystPrompt(company, language, preprocessed, elite);

  // El bindingTotals se antepone al raw data para que el Agente 1 lo lea
  // ANTES de ver los auxiliares. Evita que el modelo re-sume y divaga.
  const userContent = [
    bindingTotals,
    '',
    'DATOS CONTABLES EN BRUTO:',
    '',
    rawData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Clasificando cuentas y mapeando estructura NIIF...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'niif-analyst',
    // PREMIUM (gpt-5.5): 128K output ceiling + reasoning más eficiente para
    // blindar contra `finish_reason=length` con schemas Zod complejos.
    model: MODELS.FINANCIAL_PIPELINE_PREMIUM,
    schema: NiifReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.niifAnalyst,
    signal,
  });

  return toNiifAnalysisResult(json);
}

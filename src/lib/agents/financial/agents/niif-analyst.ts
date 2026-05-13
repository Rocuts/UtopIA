// ---------------------------------------------------------------------------
// Agente 1: Analista Contable NIIF (Fase 3 — chunked, 3 passes secuenciales)
// ---------------------------------------------------------------------------
// Refactor Fase 3.D (2026-05-12): el monolithic `callFinancialAgent` con
// `NiifReportSchema` (~30 fields, ~32K maxOutputTokens) se rompe en 3 passes
// secuenciales con sub-schemas dedicados:
//
//   Pass 1 — BalanceAndPnlSubSchema (company, balanceSheet, incomeStatement,
//            curatorFlags). Sin contexto previo.
//   Pass 2 — CashFlowAndEquitySubSchema (cashFlow, equityChanges). Recibe
//            Pass-1 anchors como `<previously_computed>` para anclar
//            cashClosing == PUC 11 y closing_balance ECP == totalEquity.
//   Pass 3 — TechnicalNotesSubSchema (technicalNotes globales). Recibe
//            Pass-1 + Pass-2 anchors para citar cifras reales en las notas.
//
// El reensamblaje vive en `assembleNiifReport` (merge puro determinístico) y
// se valida estructuralmente contra `NiifReportSchema.safeParse` como red de
// seguridad antes de devolver. La signature pública `runNiifAnalyst` es
// INVARIANTE — los consumers downstream (Strategy Director, Governance, PDF
// Élite, Excel, validators) no notan el cambio.
//
// Modelo: revierte FINANCIAL_PIPELINE_PREMIUM (gpt-5.5) → FINANCIAL_PIPELINE
// (gpt-5.4-mini). El chunking elimina el bug `finish_reason=length` por
// construcción porque cada pass tiene su propio reasoning budget (slots
// niifAnalystPass1/2/3 en MODELS_CONFIG, ~12K cada uno).
//
// SSE: el callback `onProgress` emite 3 `stage_progress` events (1/3, 2/3,
// 3/3). Telemetría per-pass queda en el `meta` retornado por
// `callFinancialAgent`; la consolidación a un solo evento agregado se
// difiere a Fase 4 incremental.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from './runtime';
import { toNiifAnalysisResult } from './renderer';
import {
  BalanceAndPnlSubSchema,
  CashFlowAndEquitySubSchema,
  TechnicalNotesSubSchema,
  NiifReportSchema,
  assembleNiifReport,
  type BalanceAndPnlSubJson,
  type CashFlowAndEquitySubJson,
  type TechnicalNotesSubJson,
} from '../contracts/niif-report';
import {
  buildNiifAnalystPass1Prompt,
  buildNiifAnalystPass2Prompt,
  buildNiifAnalystPass3Prompt,
  type NiifAnalystEliteContext,
  type PreviouslyComputedPass1Anchors,
  type PreviouslyComputedPass2Anchors,
} from '../prompts/niif-analyst.prompt';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { ReportMode } from '../contracts/base';
import type { CompanyInfo, NiifAnalysisResult, FinancialProgressEvent } from '../types';

/**
 * Extrae los anchors numéricos que Pass-2 y Pass-3 necesitan citar
 * literalmente. MoneyCop strings (centavos) se pasan sin transformar — el
 * prompt renderer los formatea para presentación.
 */
function extractPass1Anchors(pass1: BalanceAndPnlSubJson): PreviouslyComputedPass1Anchors {
  return {
    totalAssetsPrimary: pass1.balanceSheet.totalAssetsPrimary,
    totalLiabilitiesPrimary: pass1.balanceSheet.totalLiabilitiesPrimary,
    totalEquityPrimary: pass1.balanceSheet.totalEquityPrimary,
    netIncomePrimary: pass1.incomeStatement.netIncomePrimary,
    oriPrimary: pass1.incomeStatement.oriPrimary,
    // 2026-05-13 hotfix regresion comparativo: propagar los 7 *Comparative
    // a Pass-2/Pass-3 para que puedan emitir amountComparative != null.
    // Sin esto el modelo null-eaba todo el comparativo silenciosamente
    // porque "MUST anclar a previously_computed" + "previously_computed solo
    // contenia Primary" => interpretacion: comparativo fuera del contrato.
    totalAssetsComparative: pass1.balanceSheet.totalAssetsComparative,
    totalLiabilitiesComparative: pass1.balanceSheet.totalLiabilitiesComparative,
    totalEquityComparative: pass1.balanceSheet.totalEquityComparative,
    grossProfitComparative: pass1.incomeStatement.grossProfitComparative,
    operatingProfitComparative: pass1.incomeStatement.operatingProfitComparative,
    netIncomeComparative: pass1.incomeStatement.netIncomeComparative,
    oriComparative: pass1.incomeStatement.oriComparative,
    curatorFlags: pass1.curatorFlags,
  };
}

/**
 * Extrae los anchors numéricos del Pass-2 que Pass-3 cita en las notas
 * técnicas globales. `ecpClosingTotal` viene del row con kind=closing_balance
 * (siempre debe existir por contrato del schema); fallback '0' si el modelo
 * lo omite (NiifReportSchema.safeParse al final lo capturará si rompe).
 */
function extractPass2Anchors(pass2: CashFlowAndEquitySubJson): PreviouslyComputedPass2Anchors {
  const closing = pass2.equityChanges.rows.find((r) => r.kind === 'closing_balance');
  return {
    cashOpening: pass2.cashFlow.cashOpening,
    cashClosing: pass2.cashFlow.cashClosing,
    netChange: pass2.cashFlow.netChange,
    ecpClosingTotal: closing?.total ?? '0',
  };
}

/**
 * Processes raw accounting data through 3 sequential LLM passes and produces
 * the 4 NIIF financial statements + technical notes, validated against
 * `NiifReportSchema` after deterministic assembly.
 *
 * @param rawData       Texto CSV/markdown del balance pre-procesado.
 * @param company       Metadata de la empresa.
 * @param language      es | en
 * @param instructions  Instrucciones adicionales del usuario (propaga A2 a los 3 agentes).
 * @param bindingTotals Bloque Markdown con totales vinculantes (pre-calculados). Se
 *                      antepone al userContent para que los 3 pases lo vean SIEMPRE.
 * @param preprocessed  PreprocessedBalance completo. Los prompt builders lo usan para
 *                      activar el modo comparativo cuando hay >=2 periodos.
 * @param onProgress    Callback de progreso SSE — emite 3 stage_progress events.
 * @param elite         Contexto Élite (R-1..R-6) inyectado por el orquestador.
 * @param signal        AbortSignal opcional para cancelación temprana.
 * @param reportMode    Modo del reporte (v8.1 §2) — pre-derivado por
 *                      `prepareFinancialContext`. Default
 *                      `'COMPARATIVO_COMPLETO'` para backward compat. Los
 *                      prompts internos NO lo consumen aún (F4 lo cableará
 *                      a `buildNiifAnalystPass1/2/3Prompt`).
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
  // Why: F0 sólo cablea la propagación; F4 leerá `reportMode` desde el
  // builder. Marcamos el binding void aquí para que tsc/lint no fallen por
  // parámetro no usado pero el contrato externo quede declarado.
  reportMode: ReportMode = 'COMPARATIVO_COMPLETO',
): Promise<NiifAnalysisResult> {
  void reportMode;
  // El bindingTotals se antepone al raw data para que cada pass lo lea ANTES
  // de ver los auxiliares. Compartido entre los 3 pases — maximiza el prompt
  // cache de GPT-5.4 mini (stable prefix + per-pass dynamic suffix).
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

  // -- Pass 1: Backbone (Balance + P&L + company + curatorFlags) ----------
  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Pass 1/3 — Construyendo Balance General y Estado de Resultados...',
  });
  let pass1: BalanceAndPnlSubJson;
  try {
    const result = await callFinancialAgent({
      agentName: 'niif-analyst-pass1',
      model: MODELS.FINANCIAL_PIPELINE,
      schema: BalanceAndPnlSubSchema,
      system: buildNiifAnalystPass1Prompt(company, language, preprocessed, elite),
      userContent,
      ...MODELS_CONFIG.niifAnalystPass1,
      signal,
    });
    pass1 = result.json;
  } catch (err) {
    throw new Error(
      `runNiifAnalyst: Pass 1 (Balance + P&L) falló — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }

  const pass1Anchors = extractPass1Anchors(pass1);

  // -- Pass 2: Derivados (EFE + ECP) --------------------------------------
  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Pass 2/3 — Construyendo Flujo de Efectivo y Cambios en Patrimonio...',
  });
  let pass2: CashFlowAndEquitySubJson;
  try {
    const result = await callFinancialAgent({
      agentName: 'niif-analyst-pass2',
      model: MODELS.FINANCIAL_PIPELINE,
      schema: CashFlowAndEquitySubSchema,
      system: buildNiifAnalystPass2Prompt(company, language, pass1Anchors, preprocessed, elite),
      userContent,
      ...MODELS_CONFIG.niifAnalystPass2,
      signal,
    });
    pass2 = result.json;
  } catch (err) {
    throw new Error(
      `runNiifAnalyst: Pass 2 (EFE + ECP) falló — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }

  const pass2Anchors = extractPass2Anchors(pass2);

  // -- Pass 3: Narrativa (Technical Notes globales) -----------------------
  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Pass 3/3 — Redactando notas técnicas y Defensa Art. 647 E.T....',
  });
  let pass3: TechnicalNotesSubJson;
  try {
    const result = await callFinancialAgent({
      agentName: 'niif-analyst-pass3',
      model: MODELS.FINANCIAL_PIPELINE,
      schema: TechnicalNotesSubSchema,
      system: buildNiifAnalystPass3Prompt(
        company,
        language,
        pass1Anchors,
        pass2Anchors,
        preprocessed,
        elite,
      ),
      userContent,
      ...MODELS_CONFIG.niifAnalystPass3,
      signal,
    });
    pass3 = result.json;
  } catch (err) {
    throw new Error(
      `runNiifAnalyst: Pass 3 (Notas técnicas) falló — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }

  // -- Ensamblaje + validación estructural extra --------------------------
  // assembleNiifReport es un merge puro determinístico (sin transformación
  // numérica). La validación contra NiifReportSchema funciona como red de
  // seguridad: si algún sub-schema permitió una shape divergente que el
  // monolithic NiifReportSchema rechaza, fallamos rápido aquí en vez de
  // entregar JSON corrupto al renderer.
  const assembled = assembleNiifReport(pass1, pass2, pass3);

  const parsed = NiifReportSchema.safeParse(assembled);
  if (!parsed.success) {
    throw new Error(
      `runNiifAnalyst: assembled output failed NiifReportSchema validation — ${parsed.error.message}`,
    );
  }

  return toNiifAnalysisResult(parsed.data);
}

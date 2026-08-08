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
  reconcileAnchors,
  completeBreakdownFromSnapshot,
  buildQualificationSeal,
  type ReconciliationOutcome,
} from './reconcile-anchors';
import { buildReportAnchors } from '../contracts/anchors';
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

// ---------------------------------------------------------------------------
// Per-pass timeout budget (Wave 8.R — resilience preventiva 2026-05-27)
// ---------------------------------------------------------------------------
// Antes los 3 pases compartían el AbortSignal del request (techo 800s del
// route). Si Pass-1 colgaba 700s, Pass-2 y Pass-3 se ahogaban dentro del
// mismo budget y el route cerraba el SSE sin enviar `niif_phase`. Con
// AbortSignal.timeout por pase encadenado al signal del caller, cada pase
// muere limpio en su propio techo y `withRetry` no reintenta (AbortError no
// es retryable — un timeout indica que el budget está agotado, no
// transitoriedad).
//
// Valores calibrados contra latencias observadas con gpt-5.4-mini reasoning
// medium (typical 60-180s; ver NOTA en MODELS_CONFIG.strategyDirector).
// Worst case 3-pass: 500s, dentro de los 800s del route con holgura para
// Stage 0 (preprocess) + Stage emit + network.
const NIIF_PASS_TIMEOUT_MS = {
  pass1: 200_000, // Balance + P&L: schema 24K + anti-dup G53 + cascada impuesto + 8 anomalías
  pass2: 160_000, // EFE + ECP: schema 16K + ECP matricial v2.5 + ajuste Cta.3605 v2.4
  pass3: 140_000, // Notas técnicas: schema 16K + 6 disclaimers condicionales + Going Concern
  // Reintento de reparación de Pass-1. Deliberadamente MÁS CORTO que el pase
  // original: el peor caso del pipeline pasa de 500s (200+160+140) a 650s
  // (200+150+160+140), y el techo del route es 800s. Con los 200s del pase
  // completo se iría a 700s y no quedaría holgura para Stage 0 ni para la red.
  // La reparación tiene además menos trabajo que hacer: el modelo ya construyó
  // el estado y sólo tiene que completar los renglones que faltan.
  pass1Repair: 150_000,
} as const;

/**
 * Crea un AbortSignal compuesto que se dispara cuando CUALQUIERA de las
 * señales de entrada se dispara. Filtra undefined para que el caller pueda
 * pasar señales opcionales sin envolver en condicionales.
 *
 * - 0 señales válidas → undefined (sin cancelación)
 * - 1 señal válida    → pasa directa (sin overhead de AbortSignal.any)
 * - 2+ señales        → AbortSignal.any (Node 20+; Vercel Fluid es Node 24 LTS)
 */
function chainSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}

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
  // Why: F4 cablea `reportMode` a los 3 prompt builders para que el bloque
  // "MODO DEL REPORTE" (v8.1 §2) gobierne verbos, layout y secciones
  // condicionales como "Limitaciones de Información". Default
  // `'COMPARATIVO_COMPLETO'` para callers legacy que no propagan el valor.
  reportMode: ReportMode = 'COMPARATIVO_COMPLETO',
): Promise<NiifAnalysisResult> {
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
      system: buildNiifAnalystPass1Prompt(company, language, reportMode, preprocessed, elite),
      userContent,
      ...MODELS_CONFIG.niifAnalystPass1,
      signal: chainSignals(signal, AbortSignal.timeout(NIIF_PASS_TIMEOUT_MS.pass1)),
    });
    pass1 = result.json;
  } catch (err) {
    throw new Error(
      `runNiifAnalyst: Pass 1 (Balance + P&L) falló — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }

  // -- Reconciliación determinista + bucle de reparación ACOTADO -----------
  //
  // Aquí está la frontera entre cálculo y redacción. `reconcileAnchors`
  // sobrescribe con la cifra del preprocesador las anclas que puede sobrescribir
  // sin fabricar una incoherencia interna, y devuelve todo lo que quedó
  // desalineado. Si algo quedó, se reinvoca SÓLO Pass-1 —el pase que produce el
  // Balance y el P&L— con las discrepancias exactas inyectadas. Un reintento y
  // no más: si el modelo no corrige con la brecha en pesos delante, no va a
  // corregir con un tercer intento, y cada pase cuesta ~100s del presupuesto de
  // 800s del route.
  //
  // Por qué aquí y no después del reensamblaje: el desglose que no cuadra nace
  // en Pass-1. Repararlo al final obligaría a repetir los tres pases.
  const anchors = preprocessed
    ? buildReportAnchors(preprocessed.primary, preprocessed.comparative ?? undefined)
    : { primary: null, comparative: null };

  let reconciled = reconcileAnchors(pass1, anchors);
  let repairAttempted = false;

  // -- Completar el desglose con el preprocesador ANTES de pedir nada al modelo
  //
  // Medido (2026-08-08): reinvocar el pase con la brecha exacta en pesos
  // inyectada en el prompt NO repara el desglose — el bucle dispara, cuesta
  // ~110s, y el Balance sigue incompleto. El desglose por grupo PUC no es un
  // juicio contable sino una proyección del balance, así que lo construye el
  // código y suma el total exacto por construcción. Al modelo le queda la
  // clasificación corriente/no corriente, la etiqueta NIIF y la narrativa.
  if (reconciled.lineGaps.length > 0 && preprocessed?.primary) {
    const { json: completedJson, completed } = completeBreakdownFromSnapshot(
      reconciled.json,
      reconciled.lineGaps,
      preprocessed.primary,
    );
    if (completed.length > 0) {
      onProgress?.({
        type: 'stage_progress',
        stage: 1,
        detail:
          `Desglose completado desde el balance preprocesado: ${completed.join(', ')}. ` +
          `El analista había dejado renglones sin listar.`,
      });
      reconciled = reconcileAnchors(completedJson, anchors);
    }
  }

  // Lo que queda tras el completado determinista son desviaciones que el código
  // NO puede corregir sin autorar contabilidad (utilidad neta, efectivo de
  // cierre). Para eso —y sólo para eso— se gasta el reintento.
  if (reconciled.repairInstructions.length > 0) {
    repairAttempted = true;
    onProgress?.({
      type: 'stage_progress',
      stage: 1,
      detail:
        `Reconciliación: ${reconciled.repairInstructions.length} discrepancia(s) contra el ` +
        `balance preprocesado. Reintentando el Balance y el P&L con las cifras exactas...`,
    });
    try {
      const retry = await callFinancialAgent({
        agentName: 'niif-analyst-pass1-repair',
        model: MODELS.FINANCIAL_PIPELINE,
        schema: BalanceAndPnlSubSchema,
        system: buildNiifAnalystPass1Prompt(
          company,
          language,
          reportMode,
          preprocessed,
          elite,
          reconciled.repairInstructions,
        ),
        userContent,
        ...MODELS_CONFIG.niifAnalystPass1,
        signal: chainSignals(signal, AbortSignal.timeout(NIIF_PASS_TIMEOUT_MS.pass1Repair)),
      });
      const retryReconciled = reconcileAnchors(retry.json, anchors);
      // Nos quedamos con el intento que deje MENOS descuadre. Un reintento peor
      // que el original es posible y no tiene sentido premiarlo.
      if (retryReconciled.repairInstructions.length < reconciled.repairInstructions.length) {
        // El reintento puede traer su propio desglose incompleto: se completa
        // igual que el primero antes de aceptarlo.
        const { json: fixedJson, completed } = completeBreakdownFromSnapshot(
          retryReconciled.json,
          retryReconciled.lineGaps,
          preprocessed?.primary,
        );
        reconciled = completed.length > 0 ? reconcileAnchors(fixedJson, anchors) : retryReconciled;
      }
    } catch (err) {
      // La reparación es best-effort: si falla, seguimos con el intento
      // original ya reconciliado. Lo que NO puede pasar es que el descuadre
      // desaparezca de la vista — de eso se encarga `reconciliation` abajo.
      onProgress?.({
        type: 'stage_progress',
        stage: 1,
        detail: `Reintento de reconciliación fallido (${
          err instanceof Error ? err.message : String(err)
        }). Se continúa con el informe marcado.`,
      });
    }
  }

  pass1 = reconciled.json;
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
      system: buildNiifAnalystPass2Prompt(company, language, reportMode, pass1Anchors, preprocessed, elite),
      userContent,
      ...MODELS_CONFIG.niifAnalystPass2,
      signal: chainSignals(signal, AbortSignal.timeout(NIIF_PASS_TIMEOUT_MS.pass2)),
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
        reportMode,
        pass1Anchors,
        pass2Anchors,
        preprocessed,
        elite,
      ),
      userContent,
      ...MODELS_CONFIG.niifAnalystPass3,
      signal: chainSignals(signal, AbortSignal.timeout(NIIF_PASS_TIMEOUT_MS.pass3)),
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

  // Segunda pasada del reconciliador, ahora sobre el reporte completo: Pass-2
  // aporta `cashFlow.cashClosing`, que no existía cuando corrió la primera.
  const finalReconciled = reconcileAnchors(parsed.data, anchors);

  const reconciliation: ReconciliationOutcome = {
    deviations: [...reconciled.deviations, ...finalReconciled.deviations],
    lineGaps: finalReconciled.lineGaps,
    repairAttempted,
    // Lo que decide el artefacto: si al final quedan discrepancias, el informe
    // NO se entrega como limpio. El sello y el bloqueo de descarga cuelgan de
    // este booleano.
    clean:
      finalReconciled.repairInstructions.length === 0 &&
      finalReconciled.deviations.length === 0,
  };

  const rendered = toNiifAnalysisResult(finalReconciled.json);

  // El sello viaja DENTRO del entregable, no como evento SSE: así llega al
  // informe consolidado, al HTML y al PDF sin que cada superficie tenga que
  // acordarse de consultar un flag.
  const seal = buildQualificationSeal(reconciliation, language);
  if (seal) {
    rendered.balanceSheet = `${seal}\n${rendered.balanceSheet}`;
    rendered.fullContent = `${seal}\n${rendered.fullContent}`;
  }

  return { ...rendered, reconciliation };
}

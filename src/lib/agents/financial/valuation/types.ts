// ---------------------------------------------------------------------------
// Types for the 1+1 Business Valuation pipeline
// ---------------------------------------------------------------------------
// Pipeline: [DCF Modeler + Market Comparables] (PARALLEL) -> Valuation Synthesizer
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';
import type { DcfComputed } from './validators/dcf-validator';
import type { ComparablesComputed } from './validators/comparables-validator';
import type { SynthesisComputed } from './validators/synthesis-validator';
import type { ValidationDiscrepancy } from './validators/wacc';
import type { MacroSnapshot } from './macro-context';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ValuationRequest {
  /** Raw financial data (states, trial balance, KPIs, etc.) */
  financialData: string;
  /** Company metadata */
  company: CompanyInfo;
  /** Language for the report */
  language: 'es' | 'en';
  /** Additional instructions or context from the user */
  instructions?: string;
  /** Purpose of the valuation (e.g. M&A, fiscal, internal planning) */
  purpose?: string;
  /**
   * Parámetros macro con valor, fecha de vigencia y fuente por campo
   * (valoracion-18). Ausente → el prompt los declara N/D.
   */
  macro?: MacroSnapshot | null;
}

/** Estado de una metodología tras la validación determinista. */
export type MethodologyStatus = 'ok' | 'blocked' | 'failed';

// ---------------------------------------------------------------------------
// Stage 1a: DCF Modeler Output
// ---------------------------------------------------------------------------

export interface DcfModelResult {
  /** Free cash flow projections (5-10 years) */
  cashFlowProjections: string;
  /** WACC calculation with full breakdown */
  waccCalculation: string;
  /** Terminal value analysis */
  terminalValue: string;
  /** Enterprise value and equity value derivation */
  valuationSummary: string;
  /** Sensitivity analysis (WACC vs growth rate) — calculada en código */
  sensitivityAnalysis: string;
  /** Sección de validación determinista (discrepancias LLM vs recálculo) */
  validationReport: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
  /** 'ok' = cifras recalculadas; 'blocked' = DCF no emitible; 'failed' = agente caído */
  status: MethodologyStatus;
  /** Motivos del bloqueo / fallo (vacío si status = 'ok') */
  blockingReasons: string[];
  /** Cifras recalculadas en código; null si el DCF no es emitible */
  computed: DcfComputed | null;
  /** Diferencias entre lo emitido por el LLM y lo recalculado */
  discrepancies: ValidationDiscrepancy[];
}

// ---------------------------------------------------------------------------
// Stage 1b: Market Comparables Output
// ---------------------------------------------------------------------------

export interface MarketComparablesResult {
  /** Comparable company selection and rationale */
  comparableSelection: string;
  /** Multiples analysis (EV/EBITDA, P/E, P/BV, EV/Revenue) */
  multiplesAnalysis: string;
  /** Implied valuation ranges */
  impliedValuation: string;
  /** Colombian adjustments (size, illiquidity, control) */
  colombianAdjustments: string;
  /** Sección de validación determinista (discrepancias LLM vs recálculo) */
  validationReport: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
  /** 'ok' = valor recalculado; 'blocked' = múltiplos no emitibles; 'failed' = agente caído */
  status: MethodologyStatus;
  /** Motivos del bloqueo / fallo (vacío si status = 'ok') */
  blockingReasons: string[];
  /** Cifras recalculadas en código; null si no es emitible */
  computed: ComparablesComputed | null;
  /** Diferencias entre lo emitido por el LLM y lo recalculado */
  discrepancies: ValidationDiscrepancy[];
}

// ---------------------------------------------------------------------------
// Stage 2: Valuation Synthesizer Output
// ---------------------------------------------------------------------------

export interface ValuationSynthesisResult {
  /** Methodology weighting rationale */
  methodologyWeighting: string;
  /** Final value range (low / mid / high) */
  valueRange: string;
  /** Key assumptions and sensitivities */
  keyAssumptions: string;
  /** Limitations and caveats */
  limitations: string;
  /** Executive summary */
  executiveSummary: string;
  /** Sección de validación determinista (discrepancias LLM vs recálculo) */
  validationReport: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
  /** 'ok' = opinión emitida con cifras recalculadas; 'blocked' = no emitible */
  status: 'ok' | 'blocked';
  /** Motivos del bloqueo (vacío si status = 'ok') */
  blockingReasons: string[];
  /** Cifras recalculadas en código; null si no es emitible */
  computed: SynthesisComputed | null;
  /** Diferencias entre lo emitido por el LLM y lo recalculado */
  discrepancies: ValidationDiscrepancy[];
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface ValuationReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Stage 1a output — DCF model */
  dcfModel: DcfModelResult;
  /** Stage 1b output — Market comparables */
  marketComparables: MarketComparablesResult;
  /**
   * Stage 2 output — Synthesized valuation. null cuando ninguna metodología es
   * válida (valoracion-14): el Sintetizador no se ejecuta.
   */
  synthesis: ValuationSynthesisResult | null;
  /** Estado de la opinión de valor tras la validación determinista */
  valueOpinion: {
    status: 'issued' | 'not_issued';
    /** Metodologías que sustentan la opinión (vacío si no se emite) */
    methodologies: Array<'dcf' | 'market_comparables'>;
    /** Motivos por los que una metodología o la opinión quedaron N/D */
    reasons: string[];
  };
  /** Final consolidated Markdown report */
  consolidatedReport: string;
  /** Purpose of the valuation */
  purpose: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type ValuationProgressEvent =
  | { type: 'valuation_start'; agents: string[] }
  | { type: 'agent_start'; agent: 'dcf' | 'comparables' | 'synthesizer'; name: string }
  | { type: 'agent_progress'; agent: 'dcf' | 'comparables' | 'synthesizer'; detail: string }
  | { type: 'agent_complete'; agent: 'dcf' | 'comparables' | 'synthesizer'; name: string }
  | { type: 'agent_failed'; agent: 'dcf' | 'comparables' | 'synthesizer'; name: string; error: string }
  | { type: 'synthesizing' }
  | { type: 'value_opinion_not_issued'; reasons: string[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ---------------------------------------------------------------------------
// Types for the UtopIA Business Valuation pipeline
// ---------------------------------------------------------------------------
// Pipeline: [DCF Modeler + Market Comparables] (PARALLEL) -> Valuation Synthesizer
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';

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
}

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
  /** Sensitivity analysis (WACC vs growth rate) */
  sensitivityAnalysis: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
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
  /** Raw content as a single Markdown block */
  fullContent: string;
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
  /** Raw content as a single Markdown block */
  fullContent: string;
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
  /** Stage 2 output — Synthesized valuation */
  synthesis: ValuationSynthesisResult;
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
  | { type: 'error'; message: string }
  | { type: 'done'; report: ValuationReport };

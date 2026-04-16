// ---------------------------------------------------------------------------
// Types for the UtopIA Tax Planning (Planeacion Tributaria) pipeline
// ---------------------------------------------------------------------------
// Pipeline: Company Data -> Agent 1 (Tax Optimizer) -> Agent 2 (NIIF Impact)
//           -> Agent 3 (Compliance Validator) -> Consolidation
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface TaxPlanningRequest {
  /** Company metadata */
  company: CompanyInfo;
  /** Raw financial data (CSV, trial balance, or summary) */
  rawData: string;
  /** Language for the report */
  language: 'es' | 'en';
  /** Additional context or instructions from the user */
  instructions?: string;
  /** Current tax regime (if known) */
  currentRegime?: 'ordinario' | 'simple' | 'zona_franca' | 'zomac' | 'economia_naranja';
  /** Gross annual revenue in COP (helps with regime comparison) */
  grossRevenue?: number;
  /** Number of employees */
  employeeCount?: number;
}

// ---------------------------------------------------------------------------
// Stage 1: Tax Optimizer Output
// ---------------------------------------------------------------------------

export interface TaxOptimizerResult {
  /** Analysis of current tax structure and effective rate */
  currentStructureAnalysis: string;
  /** Optimization strategies ranked by impact */
  optimizationStrategies: string;
  /** Projected savings in COP with detailed calculations */
  projectedSavings: string;
  /** Implementation roadmap with timeline */
  implementationRoadmap: string;
  /** Raw content as a single Markdown block for downstream agents */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 2: NIIF Impact Analyst Output
// ---------------------------------------------------------------------------

export interface NiifImpactResult {
  /** NIIF impact assessment for each proposed strategy */
  impactAssessment: string;
  /** Deferred tax implications (NIC 12) */
  deferredTaxImplications: string;
  /** Disclosure and presentation requirements */
  disclosureRequirements: string;
  /** Effects on financial statements */
  financialStatementEffects: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 3: Compliance Validator Output
// ---------------------------------------------------------------------------

export interface ComplianceValidatorResult {
  /** Risk assessment per strategy */
  riskAssessment: string;
  /** Compliance checklist */
  complianceChecklist: string;
  /** Documentation requirements */
  documentationRequirements: string;
  /** Regulatory red flags and anti-abuse considerations */
  regulatoryRedFlags: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface TaxPlanningReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Stage 1 output */
  taxOptimization: TaxOptimizerResult;
  /** Stage 2 output */
  niifImpact: NiifImpactResult;
  /** Stage 3 output */
  complianceValidation: ComplianceValidatorResult;
  /** Final consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type TaxPlanningProgressEvent =
  | { type: 'stage_start'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'stage_progress'; stage: 1 | 2 | 3 | 4; detail: string }
  | { type: 'stage_complete'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'error'; message: string }
  | { type: 'done'; report: TaxPlanningReport };

// ---------------------------------------------------------------------------
// Types for the Tax Reconciliation (Conciliacion Fiscal) pipeline
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (Difference Identifier) -> Agent 2 (Deferred Tax Calculator) -> Consolidation
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface TaxReconciliationRequest {
  /** Raw accounting data (CSV text, trial balance, ERP export) */
  rawData: string;
  /** Company metadata */
  company: CompanyInfo;
  /** Language for the report */
  language: 'es' | 'en';
  /** Additional instructions or context from the user */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Stage 1: Difference Identifier Output
// ---------------------------------------------------------------------------

export interface DifferenceIdentifierResult {
  /** Analisis de diferencias en INGRESOS (NIIF 15 vs Art. 28 ET) */
  revenueDifferences: string;
  /** Analisis de diferencias en COSTOS Y DEDUCCIONES */
  costDeductionDifferences: string;
  /** Analisis de diferencias en ACTIVOS (valor razonable vs costo fiscal) */
  assetDifferences: string;
  /** Analisis de diferencias en PASIVOS */
  liabilityDifferences: string;
  /** Analisis de diferencias en PATRIMONIO (ORI, superavit, reservas) */
  equityDifferences: string;
  /** Cedula puente: patrimonio NIIF a patrimonio fiscal */
  bridgeSchedule: string;
  /** Raw content as a single Markdown block for downstream agents */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 2: Deferred Tax Calculator Output
// ---------------------------------------------------------------------------

export interface DeferredTaxResult {
  /** Hoja de calculo de impuesto diferido por diferencia temporaria */
  deferredTaxWorksheet: string;
  /** Cuadro de activos y pasivos por impuesto diferido (DTA/DTL) */
  dtaDtlSchedule: string;
  /** Desglose gasto corriente vs gasto diferido */
  currentVsDeferredBreakdown: string;
  /** Conciliacion de tasa efectiva de tributacion */
  effectiveTaxRateReconciliation: string;
  /** Mapeo al Formato 2516 DIAN */
  formato2516Mapping: string;
  /** Asientos contables recomendados */
  journalEntries: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface TaxReconciliationReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Stage 1 output */
  differenceAnalysis: DifferenceIdentifierResult;
  /** Stage 2 output */
  deferredTaxCalculation: DeferredTaxResult;
  /** Final consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type TaxReconciliationProgressEvent =
  | { type: 'stage_start'; stage: 1 | 2 | 3; label: string }
  | { type: 'stage_progress'; stage: 1 | 2 | 3; detail: string }
  | { type: 'stage_complete'; stage: 1 | 2 | 3; label: string }
  | { type: 'error'; message: string }
  | { type: 'done'; report: TaxReconciliationReport };

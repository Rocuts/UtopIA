// ---------------------------------------------------------------------------
// Types for the UtopIA Transfer Pricing (Precios de Transferencia) pipeline
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (TP Analyst) -> Agent 2 (Comparable Analysis) -> Agent 3 (Documentation Writer) -> Consolidation
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';

// ---------------------------------------------------------------------------
// Extended Company Info for Transfer Pricing
// ---------------------------------------------------------------------------

export interface TransferPricingParty {
  /** Razon social del vinculado economico */
  name: string;
  /** NIT o Tax ID del vinculado */
  taxId: string;
  /** Jurisdiccion / pais */
  jurisdiction: string;
  /** Tipo de vinculacion (Art. 260-1 ET) */
  relationshipType?: string;
  /** Es paraiso fiscal? (Art. 260-8 ET) */
  isTaxHaven?: boolean;
}

export interface ControlledTransaction {
  /** Descripcion de la transaccion */
  description: string;
  /** Tipo: bienes, servicios, intangibles, financieras, otros */
  type: 'bienes' | 'servicios' | 'intangibles' | 'financieras' | 'otros';
  /** Monto en COP */
  amount: number;
  /** Contraparte vinculada */
  relatedParty: string;
  /** Direccion: importacion o exportacion */
  direction: 'importacion' | 'exportacion';
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface TransferPricingRequest {
  /** Raw data about intercompany transactions */
  rawData: string;
  /** Company metadata */
  company: CompanyInfo;
  /** Related parties involved */
  relatedParties?: TransferPricingParty[];
  /** Controlled transactions to analyze */
  controlledTransactions?: ControlledTransaction[];
  /** Language for the report */
  language: 'es' | 'en';
  /** Additional instructions or context from the user */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Stage 1: TP Analyst Output
// ---------------------------------------------------------------------------

export interface TPAnalysisResult {
  /** Determinacion de obligatoriedad (umbrales Art. 260-1 ET) */
  obligationAssessment: string;
  /** Caracterizacion de transacciones controladas */
  transactionCharacterization: string;
  /** Analisis funcional (funciones, activos, riesgos — FAR) */
  functionalAnalysis: string;
  /** Seleccion y justificacion del metodo de precios de transferencia */
  methodSelection: string;
  /** Analisis preliminar de precios */
  preliminaryPricingAnalysis: string;
  /** Raw content as a single Markdown block for downstream agents */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 2: Comparable Analysis Output
// ---------------------------------------------------------------------------

export interface ComparableAnalysisResult {
  /** Estrategia de busqueda de comparables */
  searchStrategy: string;
  /** Criterios de comparabilidad aplicados */
  comparabilityCriteria: string;
  /** Comparables seleccionados con justificacion */
  selectedComparables: string;
  /** Calculo del rango intercuartil y mediana */
  interquartileRange: string;
  /** Ajustes de comparabilidad aplicados */
  adjustmentsApplied: string;
  /** Conclusion sobre precio de plena competencia */
  armLengthConclusion: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 3: Documentation Writer Output
// ---------------------------------------------------------------------------

export interface TPDocumentationResult {
  /** Resumen ejecutivo */
  executiveSummary: string;
  /** Informe Local (documentacion comprobatoria) */
  localReport: string;
  /** Equivalente a Master File */
  masterFileEquivalent: string;
  /** Conclusiones y recomendaciones */
  conclusions: string;
  /** Formato 1125 DIAN — guia de diligenciamiento */
  formato1125Guide: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface TransferPricingReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Stage 1 output */
  tpAnalysis: TPAnalysisResult;
  /** Stage 2 output */
  comparableAnalysis: ComparableAnalysisResult;
  /** Stage 3 output */
  documentation: TPDocumentationResult;
  /** Final consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type TPProgressEvent =
  | { type: 'stage_start'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'stage_progress'; stage: 1 | 2 | 3 | 4; detail: string }
  | { type: 'stage_complete'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'error'; message: string }
  | { type: 'done'; report: TransferPricingReport };

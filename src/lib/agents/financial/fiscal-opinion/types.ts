// ---------------------------------------------------------------------------
// Types for the 1+1 Fiscal Opinion (Dictamen de Revisoria Fiscal) pipeline
// ---------------------------------------------------------------------------
// Hybrid pipeline: 3 evaluators in PARALLEL → Opinion Drafter sequential
//
// [Going Concern] ──┐
// [Misstatement]  ──┼──→ [Opinion Drafter]
// [Compliance]    ──┘
// ---------------------------------------------------------------------------

import type { FinancialReport, CompanyInfo } from '../types';
import type { AuditReport } from '../audit/types';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface FiscalOpinionRequest {
  /** The complete financial report (output from the 3-agent pipeline) */
  report: FinancialReport;
  /** The audit report (output from the 4-auditor pipeline), if available */
  auditReport?: AuditReport;
  /** Language for the opinion */
  language: 'es' | 'en';
  /** Additional context or instructions */
  instructions?: string;
  /**
   * Snapshot del preprocesador (forma evolutiva). Si esta disponible, el
   * Opinion Drafter detecta `reclasificacionesNoCompensacion` (NIIF for SMEs
   * §2.52 → Parrafo de Enfasis NIA 706 §A1) y `comparativos_impracticables`
   * (NIC 1 par. 38 → Parrafo de Otras Cuestiones).
   * Tipo `unknown` defensivo: el Curator NIIF (sub-agent A) esta extendiendo
   * el shape en paralelo.
   */
  preprocessed?: unknown;
}

// ---------------------------------------------------------------------------
// Evaluator Domain
// ---------------------------------------------------------------------------

export type EvaluatorDomain = 'empresa_en_marcha' | 'incorrecciones' | 'cumplimiento';

// ---------------------------------------------------------------------------
// Agent 1: Going Concern Evaluator Output
// ---------------------------------------------------------------------------

export type GoingConcernConclusion =
  | 'sin_incertidumbre'
  | 'incertidumbre_material'
  | 'base_inadecuada'
  /** El evaluador falló: no hay conclusión NIA 570 (nunca "sin incertidumbre"). */
  | 'no_evaluado';

export interface GoingConcernIndicator {
  /** Indicator category: financial, operational, regulatory */
  category: 'financiero' | 'operacional' | 'regulatorio';
  /** Description of the indicator */
  description: string;
  /** Severity: alto, medio, bajo */
  severity: 'alto' | 'medio' | 'bajo';
  /** Applicable norm (e.g., "NIA 570 par. 16", "Art. 4 Ley 2069/2020") */
  normReference: string;
}

export interface GoingConcernResult {
  /** Overall assessment ('no_evaluado' cuando el evaluador falló). */
  assessment: 'pass' | 'caution' | 'doubt' | 'no_evaluado';
  /** NIA 570 conclusion type */
  conclusion: GoingConcernConclusion;
  /** Supporting indicators found */
  indicators: GoingConcernIndicator[];
  /** Recommended disclosures for the financial statements */
  recommendedDisclosures: string[];
  /** Detailed analysis narrative */
  analysis: string;
  /** Full raw Markdown content */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Agent 2: Material Misstatement Reviewer Output
// ---------------------------------------------------------------------------

export type MisstatementType = 'factual' | 'judgmental' | 'projected';

export interface MaterialityCalculation {
  /** Benchmark used (e.g., "5% utilidad antes de impuestos") */
  benchmark: string;
  /** Base amount in COP (null = N/D, evaluador fallido) */
  baseAmount: number | null;
  /** Materiality threshold in COP (null = N/D) */
  materialityThreshold: number | null;
  /** Performance materiality (typically 50-75% of materiality) */
  performanceMateriality: number | null;
  /** Trivial threshold (clearly trivial misstatements, typically 5% of materiality) */
  trivialThreshold: number | null;
}

export interface IdentifiedMisstatement {
  /** Unique code (e.g., MIS-001) */
  code: string;
  /** Type of misstatement */
  type: MisstatementType;
  /** Description */
  description: string;
  /** Amount in COP (if quantifiable) */
  amount: number;
  /** Whether it was corrected by management */
  corrected: boolean;
  /** Affected financial statement line */
  affectedArea: string;
  /** Applicable norm */
  normReference: string;
}

export interface MisstatementResult {
  /** Materiality calculation */
  materiality: MaterialityCalculation;
  /** Identified misstatements */
  misstatements: IdentifiedMisstatement[];
  /** Total uncorrected misstatements amount (null = N/D, evaluador fallido) */
  totalUncorrected: number | null;
  /** Whether uncorrected misstatements are material individually or in aggregate (null = N/D) */
  materialInAggregate: boolean | null;
  /** Overall assessment ('no_evaluado' cuando el evaluador falló — nunca "immaterial"). */
  assessment: 'material' | 'immaterial' | 'pervasive' | 'no_evaluado';
  /** Detailed analysis narrative */
  analysis: string;
  /** Full raw Markdown content */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Agent 3: Compliance Checker Output
// ---------------------------------------------------------------------------

export type ComplianceStatus = 'cumple' | 'cumple_parcial' | 'no_cumple' | 'no_evaluado';

export interface StatutoryFunction {
  /** Function number (1-10 per Art. 207 C.Co.) */
  number: number;
  /** Description of the statutory function */
  description: string;
  /** Compliance status */
  status: ComplianceStatus;
  /** Observations */
  observations: string;
}

export interface ComplianceItem {
  /** Unique code (e.g., COMP-001) */
  code: string;
  /** Area (SAGRILAFT, tax, corporate, etc.) */
  area: string;
  /** Description of the requirement */
  requirement: string;
  /** Compliance status */
  status: ComplianceStatus;
  /** Applicable norm */
  normReference: string;
  /** Observation or finding detail */
  observation: string;
}

export interface ComplianceResult {
  /** Statutory compliance matrix (Art. 207 C.Co. — 10 functions) */
  statutoryFunctions: StatutoryFunction[];
  /** Regulatory reporting status */
  regulatoryItems: ComplianceItem[];
  /** Independence assessment per Ley 43/1990 */
  independenceAssessment: string;
  /** Identified non-compliance items */
  nonComplianceItems: ComplianceItem[];
  /** Overall compliance score 0-100 (null = N/D, evaluador fallido) */
  complianceScore: number | null;
  /** Detailed analysis narrative */
  analysis: string;
  /** Full raw Markdown content */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Agent 4: Opinion Drafter Output
// ---------------------------------------------------------------------------

export type OpinionType =
  | 'limpia'
  | 'con_salvedades'
  | 'adversa'
  | 'abstencion'
  /**
   * Dictamen BLOQUEADO: algún evaluador (empresa en marcha, incorrecciones,
   * cumplimiento) no completó su análisis. Sin esa evidencia no se emite
   * opinión formal (tributario-modulos-11).
   */
  | 'no_emitida';

export interface KeyAuditMatter {
  /** Title of the key audit matter */
  title: string;
  /** Description of the matter */
  description: string;
  /** How it was addressed in the audit */
  auditResponse: string;
}

export interface FiscalOpinionDictamen {
  /** Type of opinion issued */
  opinionType: OpinionType;
  /** Complete formal dictamen text (Colombian format) */
  dictamenText: string;
  /** Key audit matters (NIA 701) */
  keyAuditMatters: KeyAuditMatter[];
  /** Emphasis of matter paragraphs (NIA 706) */
  emphasisParagraphs: string[];
  /** Other matter paragraphs (NIA 706) */
  otherMatterParagraphs: string[];
  /** Management letter (Carta de Gerencia) with recommendations */
  managementLetter: string;
  /**
   * Sección separada "Incertidumbre material relacionada con empresa en
   * funcionamiento" (NIA 570 revisada par. 22). null si no aplica.
   */
  goingConcernSection?: string | null;
  /** Motivo del bloqueo cuando opinionType = 'no_emitida'. */
  blockedReason?: string | null;
  /** Full raw Markdown content */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface FiscalOpinionReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Going concern evaluation result */
  goingConcern: GoingConcernResult;
  /** Material misstatement review result */
  misstatementReview: MisstatementResult;
  /** Compliance check result */
  complianceCheck: ComplianceResult;
  /** Final dictamen from Opinion Drafter */
  dictamen: FiscalOpinionDictamen;
  /** Evaluadores que no completaron su análisis (dictamen bloqueado si hay alguno). */
  evaluatorsFailed?: EvaluatorDomain[];
  /** Full consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type FiscalOpinionProgressEvent =
  | { type: 'pipeline_start'; evaluators: string[] }
  | { type: 'evaluator_start'; domain: EvaluatorDomain; name: string }
  | { type: 'evaluator_progress'; domain: EvaluatorDomain; detail: string }
  | { type: 'evaluator_complete'; domain: EvaluatorDomain; name: string }
  | { type: 'evaluator_failed'; domain: EvaluatorDomain; name: string; error: string }
  | { type: 'drafter_start'; name: string }
  | { type: 'drafter_progress'; detail: string }
  | { type: 'drafter_complete'; name: string }
  | { type: 'consolidating' }
  | { type: 'error'; message: string }
  | { type: 'done' };

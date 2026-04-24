// ---------------------------------------------------------------------------
// Types for the 1+1 Financial Audit pipeline
// ---------------------------------------------------------------------------
// 4 auditors run IN PARALLEL and produce findings that are consolidated
// into a single audit report with compliance scores and a formal opinion.
// ---------------------------------------------------------------------------

import type { FinancialReport, CompanyInfo } from '../types';

// ---------------------------------------------------------------------------
// Audit Request
// ---------------------------------------------------------------------------

export interface AuditRequest {
  /** The complete financial report to audit (output from the 3-agent pipeline) */
  report: FinancialReport;
  /** Language for the audit report */
  language: 'es' | 'en';
  /** Additional audit focus or instructions */
  auditFocus?: string;
}

// ---------------------------------------------------------------------------
// Audit Findings
// ---------------------------------------------------------------------------

/** Severity of an audit finding */
export type FindingSeverity = 'critico' | 'alto' | 'medio' | 'bajo' | 'informativo';

/** Category of audit domain */
export type AuditDomain = 'niif' | 'tributario' | 'legal' | 'revisoria';

/** A single audit finding (hallazgo) */
export interface AuditFinding {
  /** Unique code for the finding (e.g. NIIF-001, TRIB-003) */
  code: string;
  /** Severity level */
  severity: FindingSeverity;
  /** Which auditor found it */
  domain: AuditDomain;
  /** Title of the finding */
  title: string;
  /** Detailed description of the issue */
  description: string;
  /** Applicable norm / legal basis (e.g. "NIC 1, parrafo 54" or "Art. 647 E.T.") */
  normReference: string;
  /** Specific recommendation to fix the issue */
  recommendation: string;
  /** Impact: what happens if not corrected */
  impact: string;
}

// ---------------------------------------------------------------------------
// Individual Auditor Result
// ---------------------------------------------------------------------------

export interface AuditorResult {
  /** Which auditor produced this */
  domain: AuditDomain;
  /** Display name of the auditor */
  auditorName: string;
  /** Compliance score 0-100 for this domain */
  complianceScore: number;
  /** List of findings */
  findings: AuditFinding[];
  /** Executive summary from this auditor */
  summary: string;
  /** Full raw content (Markdown) */
  fullContent: string;
  /** Whether the auditor encountered an error */
  failed: boolean;
}

// ---------------------------------------------------------------------------
// Consolidated Audit Report
// ---------------------------------------------------------------------------

/** Type of formal audit opinion */
export type AuditOpinionType =
  | 'favorable'           // Sin salvedades — clean opinion
  | 'con_salvedades'      // Con salvedades — qualified opinion
  | 'desfavorable'        // Desfavorable — adverse opinion
  | 'abstension';         // Abstención de opinión — disclaimer

export interface AuditReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Individual auditor results */
  auditorResults: AuditorResult[];
  /** Overall compliance score (weighted average) */
  overallScore: number;
  /** Formal audit opinion type */
  opinionType: AuditOpinionType;
  /** Formal opinion text */
  opinionText: string;
  /** All findings consolidated and sorted by severity */
  consolidatedFindings: AuditFinding[];
  /** Count by severity */
  findingCounts: Record<FindingSeverity, number>;
  /** Executive summary of the full audit */
  executiveSummary: string;
  /** Full consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type AuditProgressEvent =
  | { type: 'audit_start'; auditors: string[] }
  | { type: 'auditor_start'; domain: AuditDomain; name: string }
  | { type: 'auditor_progress'; domain: AuditDomain; detail: string }
  | { type: 'auditor_complete'; domain: AuditDomain; name: string; score: number }
  | { type: 'auditor_failed'; domain: AuditDomain; name: string; error: string }
  | { type: 'consolidating' }
  | { type: 'done' };

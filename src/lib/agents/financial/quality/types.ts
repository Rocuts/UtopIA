// ---------------------------------------------------------------------------
// Types for the Quality & Best Practices Meta-Auditor
// ---------------------------------------------------------------------------

/** Quality dimension score */
export interface QualityDimension {
  /** Dimension name */
  name: string;
  /** Score 0-100 */
  score: number;
  /** Framework reference (ISO, IFRS, etc.) */
  framework: string;
  /** Findings for this dimension */
  findings: string[];
  /** Recommendations */
  recommendations: string[];
}

/** Quality assessment result */
export interface QualityAssessment {
  /** Immutable server snapshot of this meta-audit; absent on browser-only results. */
  qualityVersionId?: string;
  /**
   * False when this meta-audit is not exportable — either its own result is
   * partial, or the audit it read was. A meta-audit never outlives the audit
   * its conclusions rest on.
   */
  qualityComplete?: boolean;
  /** Overall quality score 0-100 */
  overallScore: number;
  /** Quality grade: A+ (95+), A (90+), B (80+), C (70+), D (60+), F (<60) */
  grade: string;
  /** Individual dimension scores */
  dimensions: QualityDimension[];
  /** IFRS 18 readiness assessment */
  ifrs18Readiness: {
    ready: boolean;
    score: number;
    gaps: string[];
  };
  /** Data quality assessment (ISO 25012) */
  dataQuality: {
    completeness: number;
    accuracy: number;
    consistency: number;
    timeliness: number;
    validity: number;
  };
  /** AI governance assessment (ISO 42001) */
  aiGovernance: {
    traceability: number;
    explainability: number;
    antiHallucination: number;
    humanOversight: number;
  };
  /** Executive summary */
  executiveSummary: string;
  /** Full Markdown report */
  fullReport: string;
  /** Timestamp */
  generatedAt: string;
}

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
  /** Referencia del resultado persistido (Parte V por referencia); ausente si no se guardó. */
  qualityRef?: { resultId: string; resultHash: string };
  /**
   * `false` si la meta-auditoría es parcial o leyó una Parte IV parcial: se
   * muestra, pero no entra en una descarga.
   */
  qualityComplete?: boolean;
  /** Si el servidor guardó el resultado y, si no, por qué. */
  persistence?: { status: 'persisted' | 'not_persisted'; reason?: string };
  /**
   * Score global 0-100 DERIVADO por el sistema, no el que emite el LLM
   * (auditoria-calidad-10): score global del sello v2.1 (promedio simple de
   * las dimensiones evaluadas, escala 0-10, un decimal) × 10; topado en 59
   * cuando el sello es "requiere corrección" con bloqueantes
   * (auditoria-calidad-03). Ver `deriveQualityScore` en `agent.ts`.
   */
  overallScore: number;
  /**
   * Grade derivado de `overallScore` con `gradeFromScore`: A+ (95+), A (90+),
   * B (80+), C (70+), D (60+), F (<60). Con los mismos cortes del sello, un
   * grade ≥ B coincide con "certificada" y F con "requiere corrección".
   */
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

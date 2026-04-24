// ---------------------------------------------------------------------------
// Fiscal Opinion Orchestrator — hybrid pipeline coordinator
// ---------------------------------------------------------------------------
// Hybrid: 3 evaluators in PARALLEL (Promise.allSettled) → Opinion Drafter
//
// [Going Concern] ──┐
// [Misstatement]  ──┼──→ [Opinion Drafter]
// [Compliance]    ──┘
// ---------------------------------------------------------------------------

import { runGoingConcernEvaluator } from './agents/going-concern';
import { runMisstatementReviewer } from './agents/misstatement-reviewer';
import { runComplianceChecker } from './agents/compliance-checker';
import { runOpinionDrafter } from './agents/opinion-drafter';
import type { FinancialReport, CompanyInfo } from '../types';
import type {
  FiscalOpinionRequest,
  FiscalOpinionReport,
  FiscalOpinionProgressEvent,
  GoingConcernResult,
  MisstatementResult,
  ComplianceResult,
  OpinionType,
} from './types';

export interface FiscalOpinionOrchestrateOptions {
  onProgress?: (event: FiscalOpinionProgressEvent) => void;
}

const OPINION_LABELS: Record<OpinionType, string> = {
  limpia: 'LIMPIA (Sin Salvedades)',
  con_salvedades: 'CON SALVEDADES',
  adversa: 'ADVERSA (Desfavorable)',
  abstencion: 'ABSTENCION DE OPINION',
};

/**
 * Execute the full Dictamen de Revisoria Fiscal pipeline.
 *
 * Hybrid flow:
 * 1. Three evaluators run in PARALLEL: Going Concern, Misstatement Reviewer, Compliance Checker
 * 2. Opinion Drafter runs SEQUENTIALLY with all three outputs to produce the formal dictamen
 * 3. Orchestrator consolidates everything into one master report
 */
export async function orchestrateFiscalOpinion(
  request: FiscalOpinionRequest,
  options: FiscalOpinionOrchestrateOptions = {},
): Promise<FiscalOpinionReport> {
  const { report, auditReport, language, instructions } = request;
  const { onProgress } = options;

  // Build the content that evaluators will analyze
  const reportContent = buildEvaluationContent(report, auditReport, instructions);

  const evaluatorNames = [
    'Evaluador de Empresa en Marcha (NIA 570)',
    'Revisor de Incorrecciones Materiales (NIA 320/450)',
    'Verificador de Cumplimiento Estatutario (Art. 207 C.Co.)',
  ];

  onProgress?.({ type: 'pipeline_start', evaluators: evaluatorNames });

  // ---------------------------------------------------------------------------
  // Stage 1: Launch all 3 evaluators in PARALLEL
  // ---------------------------------------------------------------------------
  onProgress?.({ type: 'evaluator_start', domain: 'empresa_en_marcha', name: evaluatorNames[0] });
  onProgress?.({ type: 'evaluator_start', domain: 'incorrecciones', name: evaluatorNames[1] });
  onProgress?.({ type: 'evaluator_start', domain: 'cumplimiento', name: evaluatorNames[2] });

  const results = await Promise.allSettled([
    runGoingConcernEvaluator(reportContent, report.company, language, onProgress),
    runMisstatementReviewer(reportContent, report.company, language, onProgress),
    runComplianceChecker(reportContent, report.company, language, onProgress),
  ]);

  // ---------------------------------------------------------------------------
  // Collect evaluator results (handle individual failures gracefully)
  // ---------------------------------------------------------------------------
  let goingConcern: GoingConcernResult;
  let misstatementReview: MisstatementResult;
  let complianceCheck: ComplianceResult;

  // Going Concern
  if (results[0].status === 'fulfilled') {
    goingConcern = results[0].value;
    onProgress?.({ type: 'evaluator_complete', domain: 'empresa_en_marcha', name: evaluatorNames[0] });
  } else {
    const errorMsg = results[0].reason instanceof Error ? results[0].reason.message : 'Error desconocido';
    console.error(`[fiscal-opinion] ${evaluatorNames[0]} failed:`, errorMsg);
    onProgress?.({ type: 'evaluator_failed', domain: 'empresa_en_marcha', name: evaluatorNames[0], error: errorMsg });
    goingConcern = buildFallbackGoingConcern(errorMsg);
  }

  // Misstatement Reviewer
  if (results[1].status === 'fulfilled') {
    misstatementReview = results[1].value;
    onProgress?.({ type: 'evaluator_complete', domain: 'incorrecciones', name: evaluatorNames[1] });
  } else {
    const errorMsg = results[1].reason instanceof Error ? results[1].reason.message : 'Error desconocido';
    console.error(`[fiscal-opinion] ${evaluatorNames[1]} failed:`, errorMsg);
    onProgress?.({ type: 'evaluator_failed', domain: 'incorrecciones', name: evaluatorNames[1], error: errorMsg });
    misstatementReview = buildFallbackMisstatement(errorMsg);
  }

  // Compliance Checker
  if (results[2].status === 'fulfilled') {
    complianceCheck = results[2].value;
    onProgress?.({ type: 'evaluator_complete', domain: 'cumplimiento', name: evaluatorNames[2] });
  } else {
    const errorMsg = results[2].reason instanceof Error ? results[2].reason.message : 'Error desconocido';
    console.error(`[fiscal-opinion] ${evaluatorNames[2]} failed:`, errorMsg);
    onProgress?.({ type: 'evaluator_failed', domain: 'cumplimiento', name: evaluatorNames[2], error: errorMsg });
    complianceCheck = buildFallbackCompliance(errorMsg);
  }

  // ---------------------------------------------------------------------------
  // Stage 2: Opinion Drafter (sequential — needs all evaluator outputs)
  // ---------------------------------------------------------------------------
  onProgress?.({ type: 'drafter_start', name: 'Redactor del Dictamen (NIA 700/705/706)' });

  const dictamen = await runOpinionDrafter(
    reportContent,
    goingConcern,
    misstatementReview,
    complianceCheck,
    report.company,
    language,
    onProgress,
  );

  onProgress?.({ type: 'drafter_complete', name: 'Redactor del Dictamen (NIA 700/705/706)' });

  // ---------------------------------------------------------------------------
  // Stage 3: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({ type: 'consolidating' });

  const consolidatedReport = buildConsolidatedReport(
    report.company,
    goingConcern,
    misstatementReview,
    complianceCheck,
    dictamen.opinionType,
    dictamen.dictamenText,
    dictamen.managementLetter,
    dictamen.keyAuditMatters,
    language,
  );

  const fiscalOpinionReport: FiscalOpinionReport = {
    company: report.company,
    goingConcern,
    misstatementReview,
    complianceCheck,
    dictamen,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({ type: 'done' });

  return fiscalOpinionReport;
}

// ---------------------------------------------------------------------------
// Build evaluation content
// ---------------------------------------------------------------------------

function buildEvaluationContent(
  report: FinancialReport,
  auditReport?: FiscalOpinionRequest['auditReport'],
  instructions?: string,
): string {
  const parts: string[] = [report.consolidatedReport];

  if (auditReport) {
    parts.push('\n\n---\n\nINFORME DE AUDITORIA PREVIA:\n\n' + auditReport.consolidatedReport);
  }

  if (instructions) {
    parts.push('\n\n---\n\nINSTRUCCIONES ADICIONALES:\n\n' + instructions);
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Fallback builders for failed evaluators
// ---------------------------------------------------------------------------

function buildFallbackGoingConcern(error: string): GoingConcernResult {
  return {
    assessment: 'caution',
    conclusion: 'sin_incertidumbre',
    indicators: [],
    recommendedDisclosures: ['No fue posible completar la evaluacion de empresa en marcha debido a un error tecnico.'],
    analysis: `El evaluador de empresa en marcha no pudo completar su analisis: ${error}. Se recomienda una evaluacion manual.`,
    fullContent: '',
  };
}

function buildFallbackMisstatement(error: string): MisstatementResult {
  return {
    materiality: {
      benchmark: 'No determinado (evaluador fallido)',
      baseAmount: 0,
      materialityThreshold: 0,
      performanceMateriality: 0,
      trivialThreshold: 0,
    },
    misstatements: [],
    totalUncorrected: 0,
    materialInAggregate: false,
    assessment: 'immaterial',
    analysis: `El revisor de incorrecciones no pudo completar su analisis: ${error}. Se recomienda una evaluacion manual de materialidad.`,
    fullContent: '',
  };
}

function buildFallbackCompliance(error: string): ComplianceResult {
  return {
    statutoryFunctions: Array.from({ length: 10 }, (_, i) => ({
      number: i + 1,
      description: `Funcion ${i + 1} del Art. 207 C.Co.`,
      status: 'no_evaluado' as const,
      observations: 'No evaluada debido a error tecnico del evaluador.',
    })),
    regulatoryItems: [],
    independenceAssessment: 'No evaluada debido a error tecnico.',
    nonComplianceItems: [],
    complianceScore: 0,
    analysis: `El verificador de cumplimiento no pudo completar su analisis: ${error}. Se recomienda una evaluacion manual.`,
    fullContent: '',
  };
}

// ---------------------------------------------------------------------------
// Build consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: CompanyInfo,
  goingConcern: GoingConcernResult,
  misstatement: MisstatementResult,
  compliance: ComplianceResult,
  opinionType: OpinionType,
  dictamenText: string,
  managementLetter: string,
  keyAuditMatters: { title: string; description: string; auditResponse: string }[],
  language: 'es' | 'en',
): string {
  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  const fmt = (n: number) =>
    (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const gcAssessmentLabel: Record<string, string> = {
    pass: 'Sin dudas significativas',
    caution: 'Precaucion — indicadores a monitorear',
    doubt: 'Duda sustancial sobre empresa en marcha',
  };

  const misstatementLabel: Record<string, string> = {
    material: 'Incorrecciones MATERIALES identificadas',
    immaterial: 'Sin incorrecciones materiales',
    pervasive: 'Incorrecciones MATERIALES y GENERALIZADAS',
  };

  const statutoryTable = compliance.statutoryFunctions.length > 0
    ? [
        '| # | Funcion | Estado | Observaciones |',
        '|---|---------|--------|---------------|',
        ...compliance.statutoryFunctions.map((f) =>
          `| ${f.number} | ${f.description.substring(0, 60)}... | ${f.status.toUpperCase()} | ${f.observations.substring(0, 80)} |`,
        ),
      ].join('\n')
    : '*Matriz no disponible.*';

  const kamSection = keyAuditMatters.length > 0
    ? keyAuditMatters
        .map(
          (m, i) =>
            `### ${i + 1}. ${m.title}\n**Descripcion:** ${m.description}\n**Respuesta de auditoria:** ${m.auditResponse}`,
        )
        .join('\n\n')
    : '*No se identificaron asuntos clave de auditoria.*';

  return `# DICTAMEN DEL REVISOR FISCAL
## ${company.name} — Periodo ${company.fiscalPeriod}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha del Dictamen** | ${date} |
| **Tipo de Opinion** | **${OPINION_LABELS[opinionType]}** |
| **Empresa en Marcha** | ${gcAssessmentLabel[goingConcern.assessment] || goingConcern.assessment} |
| **Incorrecciones** | ${misstatementLabel[misstatement.assessment] || misstatement.assessment} |
| **Cumplimiento Estatutario** | ${compliance.complianceScore}/100 |
| **Sistema** | 1+1 — Fiscal Opinion Pipeline (4 Agentes: 3 Evaluadores + 1 Redactor) |

---

# RESUMEN EJECUTIVO

- **Opinion emitida:** ${OPINION_LABELS[opinionType]}
- **Empresa en marcha (NIA 570):** ${gcAssessmentLabel[goingConcern.assessment]} — Conclusion: ${goingConcern.conclusion}
- **Indicadores de riesgo:** ${goingConcern.indicators.length} encontrados (${goingConcern.indicators.filter((i) => i.severity === 'alto').length} altos)
- **Materialidad global:** ${fmt(misstatement.materiality.materialityThreshold)} (Benchmark: ${misstatement.materiality.benchmark})
- **Incorrecciones no corregidas:** ${fmt(misstatement.totalUncorrected)} — ${misstatement.materialInAggregate ? 'MATERIAL en conjunto' : 'No material en conjunto'}
- **Cumplimiento Art. 207 C.Co.:** ${compliance.complianceScore}/100
- **Funciones con incumplimiento:** ${compliance.statutoryFunctions.filter((f) => f.status === 'no_cumple').length} de 10

---

# DICTAMEN FORMAL

${dictamenText || '*Dictamen no disponible.*'}

---

# ASUNTOS CLAVE DE AUDITORIA (NIA 701)

${kamSection}

---

# EVALUACION DE EMPRESA EN MARCHA (NIA 570)

**Evaluacion:** ${gcAssessmentLabel[goingConcern.assessment]}
**Conclusion NIA 570:** ${goingConcern.conclusion}

${goingConcern.indicators.length > 0 ? '**Indicadores identificados:**' : ''}
${goingConcern.indicators.map((i) => `- [${i.severity.toUpperCase()}] [${i.category}] ${i.description} — ${i.normReference}`).join('\n')}

${goingConcern.recommendedDisclosures.length > 0 ? '**Revelaciones recomendadas:**\n' + goingConcern.recommendedDisclosures.map((d) => `- ${d}`).join('\n') : ''}

---

# EVALUACION DE INCORRECCIONES MATERIALES (NIA 320/450)

| Concepto | Monto |
|----------|-------|
| **Materialidad global** | ${fmt(misstatement.materiality.materialityThreshold)} |
| **Materialidad de ejecucion** | ${fmt(misstatement.materiality.performanceMateriality)} |
| **Umbral de trivialidad** | ${fmt(misstatement.materiality.trivialThreshold)} |
| **Total incorrecciones no corregidas** | ${fmt(misstatement.totalUncorrected)} |
| **Material en conjunto** | ${misstatement.materialInAggregate ? 'SI' : 'NO'} |

${misstatement.misstatements.length > 0
    ? [
        '| Codigo | Tipo | Descripcion | Monto | Corregida | Norma |',
        '|--------|------|-------------|-------|-----------|-------|',
        ...misstatement.misstatements.map((m) =>
          `| ${m.code} | ${m.type} | ${m.description.substring(0, 50)} | ${fmt(m.amount)} | ${m.corrected ? 'Si' : 'No'} | ${m.normReference} |`,
        ),
      ].join('\n')
    : '*No se identificaron incorrecciones.*'}

---

# CUMPLIMIENTO ESTATUTARIO (Art. 207 C.Co.)

**Score de cumplimiento:** ${compliance.complianceScore}/100

## Matriz de 10 Funciones Estatutarias

${statutoryTable}

${compliance.nonComplianceItems.length > 0
    ? '## Incumplimientos Identificados\n\n' +
      compliance.nonComplianceItems
        .map((item) => `- **[${item.code}]** ${item.requirement} — ${item.normReference}: ${item.observation}`)
        .join('\n')
    : ''}

**Evaluacion de independencia:** ${compliance.independenceAssessment || 'No evaluada'}

---

# CARTA DE GERENCIA (Recomendaciones a la Administracion)

${managementLetter || '*Carta de gerencia no disponible.*'}

---

> **Nota Legal:** Este dictamen fue generado por 1+1, un sistema de inteligencia artificial. El dictamen, opiniones y recomendaciones deben ser validados por un Revisor Fiscal independiente con tarjeta profesional vigente antes de su uso oficial. Este documento no constituye un dictamen vinculante conforme a la Ley 43 de 1990 y el Art. 207 del Codigo de Comercio. Requiere firma de Revisor Fiscal designado por la asamblea de accionistas.
`;
}

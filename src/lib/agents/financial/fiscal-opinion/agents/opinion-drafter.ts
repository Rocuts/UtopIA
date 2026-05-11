// ---------------------------------------------------------------------------
// Redactor del Dictamen del Revisor Fiscal (NIA 700/705/706)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `FiscalOpinionDraftSchema` + `MODELS_CONFIG.opinionDrafter`.
//
// Mantiene LITERAL la logica de detectores deterministicos pre-LLM y los
// overrides post-LLM (V14 blocker forza opinion modificada; reclasificacion
// sin emphasis reinjecta el parrafo NIA 706 §A1). El adapter local convierte
// el JSON validado al `FiscalOpinionDictamen` legacy.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import {
  buildOpinionDrafterPrompt,
  type OpinionDrafterPromptHints,
} from '../prompts/opinion-drafter.prompt';
import {
  FiscalOpinionDraftSchema,
  type FiscalOpinionDraftJson,
} from '../../contracts/fiscal-opinion';
import type { CompanyInfo } from '../../types';
import type { AuditReport, AuditFinding } from '../../audit/types';
import type {
  GoingConcernResult,
  MisstatementResult,
  ComplianceResult,
  FiscalOpinionDictamen,
  FiscalOpinionProgressEvent,
} from '../types';

// ---------------------------------------------------------------------------
// Inputs externos opcionales para reforzar la coherencia opinion ↔ hallazgos
// ---------------------------------------------------------------------------

export interface OpinionDrafterExtraContext {
  /** Audit report consolidado (output del 4-auditor pipeline) si esta disponible. */
  auditReport?: AuditReport;
  /**
   * Snapshot del preprocesador para detectar `reclasificacionesNoCompensacion`
   * y `comparativos_impracticables`. Tipo defensivo (`unknown`) porque el
   * preprocesador esta evolucionando en paralelo.
   */
  preprocessed?: unknown;
}

export async function runOpinionDrafter(
  reportContent: string,
  goingConcern: GoingConcernResult,
  misstatementReview: MisstatementResult,
  complianceCheck: ComplianceResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
  extra?: OpinionDrafterExtraContext,
): Promise<FiscalOpinionDictamen> {
  onProgress?.({
    type: 'drafter_progress',
    detail: 'Redactando dictamen formal del revisor fiscal (NIA 700/705/706)...',
  });

  // Build consolidated input from 3 evaluators
  const evaluatorInput = buildEvaluatorSummary(goingConcern, misstatementReview, complianceCheck);

  // Detectores deterministicos pre-LLM (no se confia solo en el modelo).
  const v14State = detectV14Blocker(extra?.auditReport);
  const reclasState = detectReclasificacionesNoCompensacion(extra?.preprocessed);
  const comparativosImpracticables = detectComparativosImpracticables(extra?.preprocessed);

  const hints: OpinionDrafterPromptHints = {
    hasReclasificacionesNoCompensacion: reclasState.hasAny,
    notaReferenceLabel: reclasState.notaLabel,
    comparativosImpracticables,
    hasMaterialMeasurementBlocker: v14State.detected,
  };

  const userContent = [
    'ESTADOS FINANCIEROS ORIGINALES:',
    '',
    reportContent,
    '',
    '---',
    '',
    'RESULTADOS DE LOS EVALUADORES:',
    '',
    evaluatorInput,
  ].join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'opinion-drafter',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: FiscalOpinionDraftSchema,
    system: buildOpinionDrafterPrompt(company, language, hints),
    userContent,
    ...MODELS_CONFIG.opinionDrafter,
  });

  return toLegacyShape(json, v14State, reclasState);
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> FiscalOpinionDictamen legacy
// ---------------------------------------------------------------------------

function toLegacyShape(
  json: FiscalOpinionDraftJson,
  v14State: { detected: boolean; pervasive: boolean },
  reclasState: { hasAny: boolean; notaLabel: string },
): FiscalOpinionDictamen {
  // Override post-LLM: si V14 disparo y el LLM emitio "limpia", forzamos
  // modificada (NIA 705 §7 con_salvedades; o adversa si pervasive).
  let opinionType = json.opinionType;
  if (v14State.detected && opinionType === 'limpia') {
    opinionType = v14State.pervasive ? 'adversa' : 'con_salvedades';
  }

  // Si reclasificaciones-no-compensacion + reveladas → garantizamos parrafo
  // de enfasis NIA 706 §A1 (no override de opinion, solo augment).
  const emphasisParagraphs = [...json.emphasisParagraphs];
  if (reclasState.hasAny && !hasReclasEmphasis(emphasisParagraphs)) {
    // Why: la regla NIA 706 §A1 es vinculante cuando las reclasificaciones
    // estan reveladas en notas. Si el LLM omitio el parrafo, lo reinyectamos
    // con el cierre literal exigido.
    emphasisParagraphs.push(
      `Llamamos la atencion sobre la Nota ${reclasState.notaLabel} a los estados financieros, en la cual se describen las reclasificaciones realizadas sin compensacion conforme a NIIF for SMEs §2.52. Nuestra opinion no se modifica respecto a esta cuestion.`,
    );
  }

  const fullContent = renderOpinionMarkdown({
    ...json,
    opinionType,
    emphasisParagraphs,
  });

  return {
    opinionType,
    dictamenText: json.dictamenText,
    keyAuditMatters: json.keyAuditMatters.map((k) => ({ ...k })),
    emphasisParagraphs,
    otherMatterParagraphs: [...json.otherMatterParagraphs],
    managementLetter: json.managementLetter,
    fullContent,
  };
}

function renderOpinionMarkdown(json: FiscalOpinionDraftJson): string {
  const kamLines = json.keyAuditMatters
    .map((k, idx) => `### ${idx + 1}. ${k.title}\n${k.description}\n\n**Respuesta de auditoria:** ${k.auditResponse}`)
    .join('\n\n');
  const empLines = json.emphasisParagraphs.map((p) => `- ${p}`).join('\n');
  const otherLines = json.otherMatterParagraphs.map((p) => `- ${p}`).join('\n');

  return [
    '## TIPO DE OPINION',
    '',
    json.opinionType,
    '',
    '## DICTAMEN',
    '',
    json.dictamenText,
    '',
    '## ASUNTOS CLAVE DE AUDITORIA',
    '',
    kamLines || '(Ninguno)',
    '',
    '## PARRAFOS DE ENFASIS',
    '',
    empLines || '(No aplica)',
    '',
    '## PARRAFOS DE OTRAS CUESTIONES',
    '',
    otherLines || '(No aplica)',
    '',
    '## CARTA DE GERENCIA',
    '',
    json.managementLetter,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Detectores deterministas (corren ANTES del LLM, override DESPUES)
// ---------------------------------------------------------------------------

function detectV14Blocker(auditReport: AuditReport | undefined): {
  detected: boolean;
  pervasive: boolean;
} {
  if (!auditReport) return { detected: false, pervasive: false };
  const findings: AuditFinding[] = Array.isArray(auditReport.consolidatedFindings)
    ? auditReport.consolidatedFindings
    : [];
  const RX_V14 = /(\bV14\b|margen\s+bruto.*ciiu|gross\s+margin.*ciiu)/i;
  const matches = findings.filter(
    (f) =>
      (typeof f.code === 'string' && RX_V14.test(f.code)) ||
      (typeof f.title === 'string' && RX_V14.test(f.title)),
  );
  if (matches.length === 0) return { detected: false, pervasive: false };

  const pervasive = matches.some(
    (f) =>
      f.severity === 'critico' ||
      (typeof f.description === 'string' &&
        /generaliz|pervasive|materializa[a-z]*\s+y\s+generaliz/i.test(f.description)),
  );

  return { detected: true, pervasive };
}

function detectReclasificacionesNoCompensacion(preprocessed: unknown): {
  hasAny: boolean;
  notaLabel: string;
} {
  if (!preprocessed || typeof preprocessed !== 'object') {
    return { hasAny: false, notaLabel: 'X' };
  }
  const pp = preprocessed as Record<string, unknown>;
  const reclas = pp.reclasificacionesNoCompensacion;
  let arr: unknown[] | null = null;
  if (Array.isArray(reclas)) {
    arr = reclas;
  } else {
    const primary = pp.primary as { reclasificacionesNoCompensacion?: unknown } | undefined;
    if (primary && Array.isArray(primary.reclasificacionesNoCompensacion)) {
      arr = primary.reclasificacionesNoCompensacion;
    }
  }
  if (!arr || arr.length === 0) return { hasAny: false, notaLabel: 'X' };

  let notaLabel = 'X';
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const ref = (item as { notaRef?: unknown; nota?: unknown }).notaRef ??
        (item as { notaRef?: unknown; nota?: unknown }).nota;
      if (typeof ref === 'string' && ref.trim().length > 0) {
        notaLabel = ref.replace(/^Nota\s*/i, '').trim() || ref.trim();
        break;
      }
    }
  }
  return { hasAny: true, notaLabel };
}

function detectComparativosImpracticables(preprocessed: unknown): boolean {
  if (!preprocessed || typeof preprocessed !== 'object') return false;
  const pp = preprocessed as { comparativos_impracticables?: unknown };
  return pp.comparativos_impracticables === true;
}

function hasReclasEmphasis(paragraphs: string[]): boolean {
  return paragraphs.some((p) =>
    /reclasifica|nuestra\s+opinion\s+no\s+se\s+modifica/i.test(p),
  );
}

// ---------------------------------------------------------------------------
// Build summary of evaluator outputs for the drafter
// ---------------------------------------------------------------------------

function buildEvaluatorSummary(
  goingConcern: GoingConcernResult,
  misstatement: MisstatementResult,
  compliance: ComplianceResult,
): string {
  const gcIndicators = goingConcern.indicators
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.description} (${i.normReference})`)
    .join('\n');

  const misstatementList = misstatement.misstatements
    .map((m) => `- [${m.code}] ${m.description} — $${m.amount.toLocaleString('es-CO')} — ${m.corrected ? 'Corregida' : 'NO corregida'} (${m.normReference})`)
    .join('\n');

  const statutoryMatrix = compliance.statutoryFunctions
    .map((f) => `- Funcion ${f.number}: ${f.status.toUpperCase()} — ${f.observations || 'Sin observaciones'}`)
    .join('\n');

  const nonCompliance = compliance.nonComplianceItems
    .map((item) => `- [${item.code}] ${item.requirement} — ${item.normReference}: ${item.observation}`)
    .join('\n');

  const fmt = (n: number) =>
    (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `# EVALUADOR 1: EMPRESA EN MARCHA (NIA 570)
- **Evaluacion:** ${goingConcern.assessment}
- **Conclusion NIA 570:** ${goingConcern.conclusion}
- **Indicadores encontrados:** ${goingConcern.indicators.length}
${gcIndicators || '(Ninguno)'}
- **Revelaciones recomendadas:** ${goingConcern.recommendedDisclosures.length > 0 ? goingConcern.recommendedDisclosures.join('; ') : 'Ninguna'}

**Analisis completo:**
${goingConcern.analysis}

---

# EVALUADOR 2: INCORRECCIONES MATERIALES (NIA 320/450)
- **Materialidad global:** ${fmt(misstatement.materiality.materialityThreshold)} (Benchmark: ${misstatement.materiality.benchmark})
- **Materialidad de ejecucion:** ${fmt(misstatement.materiality.performanceMateriality)}
- **Umbral de trivialidad:** ${fmt(misstatement.materiality.trivialThreshold)}
- **Incorrecciones identificadas:** ${misstatement.misstatements.length}
${misstatementList || '(Ninguna)'}
- **Total incorrecciones no corregidas:** ${fmt(misstatement.totalUncorrected)}
- **Material en conjunto:** ${misstatement.materialInAggregate ? 'SI' : 'NO'}
- **Evaluacion:** ${misstatement.assessment}

**Analisis completo:**
${misstatement.analysis}

---

# EVALUADOR 3: CUMPLIMIENTO ESTATUTARIO (Art. 207 C.Co.)
- **Score de cumplimiento:** ${compliance.complianceScore}/100

**Matriz Estatutaria (10 funciones Art. 207 C.Co.):**
${statutoryMatrix || '(No evaluada)'}

**Items de incumplimiento:**
${nonCompliance || '(Ninguno)'}

**Evaluacion de independencia:**
${compliance.independenceAssessment || 'No evaluada'}

**Analisis completo:**
${compliance.analysis}`;
}

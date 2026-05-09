// ---------------------------------------------------------------------------
// Redactor del Dictamen del Revisor Fiscal (NIA 700/705/706)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import {
  buildOpinionDrafterPrompt,
  type OpinionDrafterPromptHints,
} from '../prompts/opinion-drafter.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type { AuditReport, AuditFinding } from '../../audit/types';
import type {
  GoingConcernResult,
  MisstatementResult,
  ComplianceResult,
  FiscalOpinionDictamen,
  OpinionType,
  KeyAuditMatter,
  FiscalOpinionProgressEvent,
} from '../types';

// ---------------------------------------------------------------------------
// Inputs externos opcionales para reforzar la coherencia opinion ↔ hallazgos
// ---------------------------------------------------------------------------

export interface OpinionDrafterExtraContext {
  /** Audit report consolidado (output del 4-auditor pipeline) si esta disponible. */
  auditReport?: AuditReport;
  /**
   * Snapshot del preprocesador. Lo usamos solo para detectar
   * `reclasificacionesNoCompensacion` (R-NoCompensation) y
   * `comparativos_impracticables` (NIC 1 par. 38). Tipo defensivo: el
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

  // Detectar disparadores de modificacion / parrafo de enfasis ANTES del LLM.
  const v14State = detectV14Blocker(extra?.auditReport);
  const reclasState = detectReclasificacionesNoCompensacion(extra?.preprocessed);
  const comparativosImpracticables = detectComparativosImpracticables(extra?.preprocessed);

  const hints: OpinionDrafterPromptHints = {
    hasReclasificacionesNoCompensacion: reclasState.hasAny,
    notaReferenceLabel: reclasState.notaLabel,
    comparativosImpracticables,
    hasMaterialMeasurementBlocker: v14State.detected,
  };

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: buildOpinionDrafterPrompt(company, language, hints) },
          {
            role: 'user',
            content: [
              'ESTADOS FINANCIEROS ORIGINALES:',
              '',
              reportContent,
              '',
              '---',
              '',
              'RESULTADOS DE LOS EVALUADORES:',
              '',
              evaluatorInput,
            ].join('\n'),
          },
        ],
        temperature: 0.05,
        maxOutputTokens: 8192,
      }),
    { label: 'opinion_drafter', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'opinion_drafter');

  const fullContent = result.text || '';

  // Override post-parse: si V14 disparo y el LLM emitio "limpia", forzamos
  // modificada (NIA 705 §7 con salvedades; o desfavorable si pervasive).
  // Si reclasificaciones-no-compensacion + reveladas → garantizamos parrafo
  // de enfasis NIA 706 §A1 (no override de opinion, solo augment).
  let opinionType = parseOpinionType(fullContent);
  if (v14State.detected && opinionType === 'limpia') {
    opinionType = v14State.pervasive ? 'adversa' : 'con_salvedades';
  }

  let emphasisParagraphs = parseEmphasisParagraphs(fullContent);
  if (reclasState.hasAny && !hasReclasEmphasis(emphasisParagraphs)) {
    // Why: la regla NIA 706 §A1 es vinculante cuando las reclasificaciones
    // estan reveladas en notas. Si el LLM omitio el parrafo, lo reinyectamos
    // con el cierre literal exigido. No alteramos opinionType en este caso.
    emphasisParagraphs = [
      ...emphasisParagraphs,
      `Llamamos la atencion sobre la Nota ${reclasState.notaLabel} a los estados financieros, en la cual se describen las reclasificaciones realizadas sin compensacion conforme a NIIF for SMEs §2.52. Nuestra opinion no se modifica respecto a esta cuestion.`,
    ];
  }

  return {
    opinionType,
    dictamenText: parseDictamen(fullContent),
    keyAuditMatters: parseKeyAuditMatters(fullContent),
    emphasisParagraphs,
    otherMatterParagraphs: parseOtherMatterParagraphs(fullContent),
    managementLetter: parseManagementLetter(fullContent),
    fullContent,
  };
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
  // Capturar V14 (margen bruto fuera de banda CIIU) en code o title.
  // Tambien aceptamos sinonimos comunes que puede emitir el auditor NIIF.
  const RX_V14 = /(\bV14\b|margen\s+bruto.*ciiu|gross\s+margin.*ciiu)/i;
  const matches = findings.filter(
    (f) =>
      (typeof f.code === 'string' && RX_V14.test(f.code)) ||
      (typeof f.title === 'string' && RX_V14.test(f.title)),
  );
  if (matches.length === 0) return { detected: false, pervasive: false };

  // Pervasive si severity critico o si la descripcion menciona "generalizado".
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
  // Aceptamos shape array OR primary.reclasificacionesNoCompensacion (si el
  // preprocesador anida por periodo).
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

  // Si alguno trae { notaRef: 'Nota 12' } usar ese texto, sino label generico.
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

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseOpinionType(content: string): OpinionType {
  const match = content.match(/##\s*TIPO\s+DE\s+OPINION\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (match) {
    const text = match[1].trim().toLowerCase();
    if (text.includes('limpia') || (text.includes('favorable') && !text.includes('desfavorable') && !text.includes('salvedad'))) return 'limpia';
    if (text.includes('con_salvedades') || text.includes('salvedades') || text.includes('qualified')) return 'con_salvedades';
    if (text.includes('adversa') || text.includes('desfavorable')) return 'adversa';
    if (text.includes('abstencion') || text.includes('disclaimer')) return 'abstencion';
  }
  return 'con_salvedades'; // conservative default
}

function parseDictamen(content: string): string {
  const match = content.match(/##\s*DICTAMEN\s*\n+([\s\S]*?)(?=\n##\s)/i);
  return match ? match[1].trim() : '';
}

function parseKeyAuditMatters(content: string): KeyAuditMatter[] {
  const match = content.match(/##\s*ASUNTOS\s+CLAVE\s+DE\s+AUDITORIA\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((m: Record<string, unknown>) => ({
      title: (m.title as string) || '',
      description: (m.description as string) || '',
      auditResponse: (m.auditResponse as string) || '',
    }));
  } catch {
    return [];
  }
}

function parseEmphasisParagraphs(content: string): string[] {
  const match = content.match(/##\s*PARRAFOS\s+DE\s+ENFASIS\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  return match[1]
    .trim()
    .split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((line) => !line.toLowerCase().includes('no aplica'));
}

function parseOtherMatterParagraphs(content: string): string[] {
  const match = content.match(/##\s*PARRAFOS\s+DE\s+OTRAS\s+CUESTIONES\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  return match[1]
    .trim()
    .split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((line) => !line.toLowerCase().includes('no aplica'));
}

function parseManagementLetter(content: string): string {
  const match = content.match(/##\s*CARTA\s+DE\s+GERENCIA\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  return match ? match[1].trim() : '';
}

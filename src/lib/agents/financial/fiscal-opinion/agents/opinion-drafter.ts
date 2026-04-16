// ---------------------------------------------------------------------------
// Redactor del Dictamen del Revisor Fiscal (NIA 700/705/706)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { MODELS } from '@/lib/config/models';
import { buildOpinionDrafterPrompt } from '../prompts/opinion-drafter.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type {
  GoingConcernResult,
  MisstatementResult,
  ComplianceResult,
  FiscalOpinionDictamen,
  OpinionType,
  KeyAuditMatter,
  FiscalOpinionProgressEvent,
} from '../types';

export async function runOpinionDrafter(
  reportContent: string,
  goingConcern: GoingConcernResult,
  misstatementReview: MisstatementResult,
  complianceCheck: ComplianceResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<FiscalOpinionDictamen> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  onProgress?.({
    type: 'drafter_progress',
    detail: 'Redactando dictamen formal del revisor fiscal (NIA 700/705/706)...',
  });

  // Build consolidated input from 3 evaluators
  const evaluatorInput = buildEvaluatorSummary(goingConcern, misstatementReview, complianceCheck);

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: buildOpinionDrafterPrompt(company, language) },
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
        max_tokens: 8192,
      }),
    { label: 'opinion_drafter', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  return {
    opinionType: parseOpinionType(fullContent),
    dictamenText: parseDictamen(fullContent),
    keyAuditMatters: parseKeyAuditMatters(fullContent),
    emphasisParagraphs: parseEmphasisParagraphs(fullContent),
    otherMatterParagraphs: parseOtherMatterParagraphs(fullContent),
    managementLetter: parseManagementLetter(fullContent),
    fullContent,
  };
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

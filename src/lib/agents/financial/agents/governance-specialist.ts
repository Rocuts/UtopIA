// ---------------------------------------------------------------------------
// Agente 3: Especialista en Gobierno Corporativo (Legal & Compliance)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import {
  buildGovernancePrompt,
  type GovernanceEliteContext,
} from '../prompts/governance-specialist.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '../utils/finish-reason-check';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type {
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
  FinancialProgressEvent,
} from '../types';

/**
 * Takes the outputs from Agent 1 (NIIF) and Agent 2 (Strategy) to produce
 * Notes to Financial Statements and Shareholder Assembly Minutes.
 *
 * @param niifOutput      Output del Agente 1.
 * @param strategyOutput  Output del Agente 2.
 * @param company         Metadata de la empresa.
 * @param language        es | en
 * @param instructions    Instrucciones adicionales del usuario (propagacion A2).
 * @param bindingTotals   Totales vinculantes pre-calculados — se antepone al
 *                        contexto para que las Notas citen cifras correctas.
 * @param preprocessed    PreprocessedBalance completo. Activa modo comparativo
 *                        en notas y acta cuando hay >=2 periodos.
 */
export async function runGovernanceSpecialist(
  niifOutput: NiifAnalysisResult,
  strategyOutput: StrategicAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  preprocessed: PreprocessedBalance | undefined,
  onProgress?: (event: FinancialProgressEvent) => void,
  elite?: GovernanceEliteContext,
): Promise<GovernanceResult> {
  const systemPrompt = buildGovernancePrompt(company, language, preprocessed, elite);

  const userContent = [
    bindingTotals,
    '',
    '=== ESTADOS FINANCIEROS NIIF (Agente 1) ===',
    '',
    niifOutput.fullContent,
    '',
    '=== ANALISIS ESTRATEGICO (Agente 2) ===',
    '',
    strategyOutput.fullContent,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({ type: 'stage_progress', stage: 3, detail: 'Redactando notas contables y acta de asamblea...' });

  const generate = () =>
    generateText({
      model: MODELS.FINANCIAL_PIPELINE,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.1,
      // 24576: notas NIIF completas + acta de asamblea + certificación final
      // + bloque de firmas + dictamen del Revisor Fiscal. Los 16384 anteriores
      // cortaban antes de cerrar la sección de Certificación/Firmas (Bug 5).
      maxOutputTokens: 24576,
      seed: 42,
    });

  let result = await withRetry(generate, { label: 'governance_specialist', maxAttempts: 3 });
  assertFinishedCleanlyOrThrow(result, 'Governance Specialist');
  let fullContent = result.text || '';

  // ITEM 3 ORDEN DE CIERRE — validador anti-evasivo (post-generación).
  // El prompt prohíbe explícitamente las frases evasivas, pero los LLMs a
  // veces las cuelan en notas técnicas. Verificamos con regex; si detectamos
  // alguna, re-promptamos UNA vez con corrección dirigida. Tope: 1 reintento.
  // Si persiste, dejamos pasar pero loggeamos para revisión manual.
  const evasiveHits = detectForbiddenPhrases(fullContent);
  if (evasiveHits.length > 0) {
    onProgress?.({
      type: 'stage_progress',
      stage: 3,
      detail: `Detectadas ${evasiveHits.length} frase(s) evasiva(s); re-promptando para corrección...`,
    });

    const correctionPrompt = buildEvasiveCorrectionPrompt(evasiveHits);
    const retry = await generateText({
      model: MODELS.FINANCIAL_PIPELINE,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
        { role: 'assistant', content: fullContent },
        { role: 'user', content: correctionPrompt },
      ],
      temperature: 0.1,
      maxOutputTokens: 24576,
      seed: 43,
    });
    assertFinishedCleanlyOrThrow(retry, 'Governance Specialist (retry anti-evasivo)');
    const retryContent = retry.text || '';
    const retryHits = detectForbiddenPhrases(retryContent);

    if (retryHits.length < evasiveHits.length) {
      // Mejoró — adoptamos el retry.
      result = retry;
      fullContent = retryContent;
    }
    // Si NO mejoró, conservamos el original (a veces el retry empeora el
    // resultado por overcorrection). Loggeamos para diagnóstico.
    if (retryHits.length > 0) {
      console.warn(
        '[governance-specialist] Frases evasivas persistentes tras retry:',
        retryHits.slice(0, 3).map((h) => h.match).join(' | '),
      );
    }
  }

  const sections = parseSections(fullContent);

  return {
    financialNotes: sections['1. NOTAS A LOS ESTADOS FINANCIEROS'] || sections['1'] || '',
    shareholderMinutes: sections['2'] || findSectionByPrefix(sections, '2.') || '',
    fullContent,
  };
}

// ---------------------------------------------------------------------------
// ITEM 3 ORDEN DE CIERRE — detector de frases evasivas (anti-hedging).
// ---------------------------------------------------------------------------
// Regex compilados una sola vez. Cada patrón captura una variante canónica de
// la frase prohibida; el match contiene el span original para incluirlo en el
// prompt de corrección.
//
// Las frases en `### Notas del Preparador` están permitidas — el detector
// SOLO escanea fuera de ese bloque. Why: el preparador SÍ puede listar datos
// faltantes ahí, pero las notas técnicas y el acta NO deben hedgear.
// ---------------------------------------------------------------------------

interface EvasiveHit {
  pattern: string;
  match: string;
  /** Index absoluto en el texto donde aparece la frase. */
  offset: number;
}

const FORBIDDEN_PATTERNS: { id: string; rx: RegExp }[] = [
  { id: 'no_suministro_informacion', rx: /no\s+se\s+suministr[oó]\s+(?:la\s+)?informaci[oó]n/i },
  { id: 'informacion_no_detallada', rx: /informaci[oó]n\s+no\s+(?:detallada|provista|disponible)/i },
  { id: 'datos_no_disponibles', rx: /datos\s+no\s+(?:disponibles|suministrados)(?!\s*\))/i },
  { id: 'falta_totales_vinculantes', rx: /(?:falta|ausencia)\s+de\s+totales\s+vinculantes/i },
  { id: 'totales_no_provistos', rx: /totales\s+vinculantes\s+no\s+(?:provistos|disponibles)/i },
  { id: 'pendiente_validacion', rx: /pendiente\s+de\s+validaci[oó]n/i },
  { id: 'sujeto_verificacion', rx: /sujeto\s+(?:a\s+)?(?:verificaci[oó]n|confirmaci[oó]n)/i },
  { id: 'no_se_conto_datos', rx: /no\s+se\s+cont[oó]\s+con\s+(?:los\s+)?datos/i },
  { id: 'no_se_cuenta_informacion', rx: /no\s+se\s+cuenta\s+con\s+(?:la\s+)?informaci[oó]n/i },
];

function detectForbiddenPhrases(text: string): EvasiveHit[] {
  if (!text) return [];

  // Excluir el bloque "### Notas del Preparador" donde el placeholder
  // `— (dato no suministrado)` está autorizado.
  const preparerSectionRx = /###\s*Notas\s+del\s+Preparador[\s\S]*?(?=\n##\s|$)/i;
  const scanText = text.replace(preparerSectionRx, '');

  const hits: EvasiveHit[] = [];
  for (const { id, rx } of FORBIDDEN_PATTERNS) {
    const m = rx.exec(scanText);
    if (m && typeof m.index === 'number') {
      hits.push({ pattern: id, match: m[0], offset: m.index });
    }
  }
  return hits;
}

function buildEvasiveCorrectionPrompt(hits: EvasiveHit[]): string {
  const samples = hits
    .slice(0, 5)
    .map((h, i) => `${i + 1}. Patrón \`${h.pattern}\` — texto detectado: «${h.match}»`)
    .join('\n');

  return [
    'CORRECCIÓN ANTI-HEDGING — ITEM 3 ORDEN DE CIERRE.',
    '',
    'El output anterior contiene frases evasivas que están EXPRESAMENTE PROHIBIDAS por la',
    'regla R-Élite 0 del system prompt. Frases detectadas:',
    '',
    samples,
    '',
    'INSTRUCCIONES DE REESCRITURA:',
    '',
    '1. Reescribe el output COMPLETO, eliminando TODAS las frases prohibidas.',
    '2. Donde una frase evasiva aparezca, reemplázala por la cifra/dato real del bloque',
    '   `TOTALES VINCULANTES` (que SÍ se entregó) o por la cita normativa de',
    '   impracticabilidad correspondiente (NIIF for SMEs §3.14 / §10.21 / §29.27).',
    '3. El placeholder `— (dato no suministrado)` SÓLO se permite dentro de la sección',
    '   `### Notas del Preparador`, NUNCA en notas técnicas ni en el acta.',
    '4. Conserva la estructura `## 1. NOTAS A LOS ESTADOS FINANCIEROS` y',
    '   `## 2. ACTA DE ASAMBLEA ...` EXACTAMENTE como antes. Mantén las cifras numéricas.',
    '5. NO inventes datos nuevos — sólo reemplaza el hedging por afirmaciones',
    '   firmes basadas en los TOTALES VINCULANTES ya entregados.',
    '',
    'Devuelve SOLO el output corregido (Markdown completo), sin meta-comentario.',
  ].join('\n');
}

function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const pattern = /^##\s+(\d+\.?\s*[^\n]*)/gm;
  const matches = [...content.matchAll(pattern)];

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    sections[key] = content.slice(start, end).trim();
    const numMatch = key.match(/^(\d+)/);
    if (numMatch) sections[numMatch[1]] = sections[key];
  }

  return sections;
}

function findSectionByPrefix(sections: Record<string, string>, prefix: string): string {
  const key = Object.keys(sections).find((k) => k.startsWith(prefix));
  return key ? sections[key] : '';
}

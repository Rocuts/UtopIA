// ---------------------------------------------------------------------------
// Agente final: Editor Jefe HTML (Wave 4.F7 — cap-stone visual)
// ---------------------------------------------------------------------------
//
// Recibe los JSONs consolidados de los 3 agentes anteriores + metadata
// pre-cocinada (hash determinístico, cobertura por clase PUC, confianza
// global agregada) y produce HTML 12-slide auto-contenido siguiendo
// `docs/spec/financial-report-v8.1.md` verbatim como system prompt.
//
// Diferencias respecto a los 3 agentes anteriores:
//
//   1. NO usa `callFinancialAgent` (que asume Zod-validated JSON output). El
//      output es HTML, no JSON, por lo que `experimental_output: Output.object`
//      no aplica — se invoca `generateText` directo del SDK.
//
//   2. Validación post-emisión liviana: `lightweightChecklist` cubre los 4
//      checks más críticos del §10/§1.6/§5 sin parser DOM. El validador
//      profundo con linkedom (23 viñetas §11) se difiere a Wave 4.F9 cuando
//      los snapshots de regression aún no existen y meter linkedom en el
//      build path sin necesidad sería overengineering.
//
//   3. `MODELS.FINANCIAL_PIPELINE` (gpt-5.5 premium por default según
//      models.ts post-2026-05-13) — el HTML de 32K tokens necesita el ceiling
//      de 128K de gpt-5.5; gpt-5.4-mini se quedaría sin budget con prompt
//      cache miss en cold start.
//
// SSE: emite un único `stage_progress` antes de invocar el modelo. El consumer
// (`/api/financial-report/html`) lo reenvía como `event: progress` al cliente.
//
// Refs:
//   - docs/spec/financial-report-v8.1.md §10 §11 §1.6 §5
//   - CLAUDE.md §"Prompt patterns GPT-5.4 (outcome-first)"
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import {
  HtmlEditorInputSchema,
  type HtmlEditorInput,
  type HtmlEditorMetadata,
  type HtmlEditorOutput,
} from '../contracts/html-editor';
import {
  buildHtmlEditorSystemPrompt,
  buildHtmlEditorUserContent,
} from '../prompts/html-editor.prompt';
import type { FinancialProgressEvent } from '../types';
import { withRetry } from '@/lib/agents/utils/retry';

/**
 * Editor Jefe HTML — agente cap-stone del pipeline 1+1 v8.1.
 *
 * @param input     - HtmlEditorInput validado por Zod (niif + strategy +
 *                    governance + company + metadata + language).
 * @param onProgress - callback SSE opcional. Recibe un único `stage_progress`
 *                    en stage 4 antes de la llamada al LLM. F8/F9 pueden
 *                    extender con eventos `agent_telemetry` si conviene.
 * @param signal    - AbortSignal opcional para cancelación temprana
 *                    (timeout SSE, cierre del cliente).
 *
 * @returns HtmlEditorOutput con `html` (string), echo de `metadata` y
 *          `checklistFailures` del linter post-emisión.
 *
 * @throws Error si:
 *   - el input no pasa `HtmlEditorInputSchema.safeParse`,
 *   - el modelo emite un output vacío o sin DOCTYPE,
 *   - el provider OpenAI lanza error no-retriable.
 */
export async function runHtmlEditor(
  input: HtmlEditorInput,
  onProgress?: (event: FinancialProgressEvent) => void,
  signal?: AbortSignal,
): Promise<HtmlEditorOutput> {
  // Why validamos aquí aunque el endpoint también lo haga: este agente debe
  // ser invocable directamente por orchestrators internos (futuro Wave 4.F8
  // wiring del frontend a Quality → HTML como 4ª sub-fase) sin pasar por el
  // endpoint. La doble validación garantiza que el contrato se enforce
  // independientemente del callsite.
  const parsed = HtmlEditorInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `runHtmlEditor: input failed validation — ${parsed.error.message}`,
    );
  }

  const system = buildHtmlEditorSystemPrompt();
  const userContent = buildHtmlEditorUserContent(parsed.data);

  onProgress?.({
    type: 'stage_progress',
    stage: 4,
    detail: 'Editor Jefe HTML — componiendo 12 slides según spec v8.1...',
  });

  // 2 attempts en lugar de 3 (default `withRetry`): el HTML de ~28K tokens
  // tarda 30-60s; 3 reintentos × 60s = 180s sólo en LLM, comiendo el budget
  // de maxDuration=800. 2 attempts cubren los transients (429/5xx) sin
  // explotar el timeout.
  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        maxOutputTokens: MODELS_CONFIG.htmlEditor.maxOutputTokens,
        abortSignal: signal,
        providerOptions: {
          openai: {
            store: true,
            reasoningEffort: MODELS_CONFIG.htmlEditor.reasoningEffort,
            textVerbosity: MODELS_CONFIG.htmlEditor.textVerbosity,
          },
        },
      }),
    { maxAttempts: 2, label: 'html-editor', signal },
  );

  const html = result.text ?? '';
  if (!html.trim() || !html.includes('<!DOCTYPE html>')) {
    throw new Error(
      `runHtmlEditor: output inválido — sin DOCTYPE html ` +
        `(finishReason=${result.finishReason}, textLen=${html.length}). ` +
        `Probable causa: prompt cache miss + budget insuficiente. ` +
        `Subir MODELS_CONFIG.htmlEditor.maxOutputTokens o cambiar a FINANCIAL_PIPELINE_PREMIUM.`,
    );
  }

  // Validación post-emisión liviana — §10 + §1.6 + §5 hash. F9 amplía a §11
  // completo con parser DOM.
  const checklistFailures = lightweightChecklist(html, parsed.data.metadata);

  return {
    html,
    metadata: parsed.data.metadata,
    checklistFailures,
  };
}

/**
 * Linter de DOM básico — verifica los 4 checks más críticos sin linkedom.
 *
 * Cubre:
 *   - §10 mandatory HTML comments (REPORT_MODE, ENTITY, AGENT_VERSION).
 *   - §1.6 vocabulario prohibido (lista de adjetivos de marketing).
 *   - §5 Slide 12 hash verificación coincide con metadata.reportHashSha256.
 *
 * Lo que NO cubre (F9 lo añade con linkedom):
 *   - Estructura de las 12 slides en orden.
 *   - Tabular-nums aplicado a columnas numéricas.
 *   - WCAG AA contrast verificado en oro sobre blanco.
 *   - Cero $0 huérfanos sin nota.
 *
 * Why regex y no string contains naive: las palabras prohibidas (Élite,
 * Sólido) pueden aparecer como substring de palabras legítimas (e.g.
 * "establece" contiene "estable" pero NO "Sólido"). El regex `\b…\b` evita
 * falsos positivos limitando a word boundaries.
 */
function lightweightChecklist(
  html: string,
  metadata: HtmlEditorMetadata,
): HtmlEditorOutput['checklistFailures'] {
  const failures: HtmlEditorOutput['checklistFailures'] = [];

  // §10 mandatory HTML comments — buscamos la presencia LITERAL de los
  // valores declarados en metadata, no patrones genéricos. Si el LLM omite
  // o cambia un valor, el linter lo detecta como BLOCK.
  const requiredComments = [
    { needle: `REPORT_MODE: ${metadata.reportMode}`, label: 'REPORT_MODE' },
    { needle: `ENTITY: ${metadata.entityNit}`, label: 'ENTITY' },
    { needle: 'AGENT_VERSION: 1+1 v8.1', label: 'AGENT_VERSION' },
  ];
  for (const { needle, label } of requiredComments) {
    if (!html.includes(needle)) {
      failures.push({
        rule: '§10 mandatory HTML comments',
        detail: `Falta comentario ${label} con valor literal "${needle}"`,
        severity: 'block',
      });
    }
  }

  // §1.6 vocabulario prohibido — case-insensitive, palabra completa. La lista
  // está en el spec verbatim, pero la espejamos aquí para que el linter sea
  // self-contained y no requiera parsear el spec cada vez.
  //
  // Tildes: regex `é` y `É` se manejan con flag /i. "Único" se cubre con la
  // alternancia `Ú|U` para tolerar entradas sin tilde.
  const forbiddenWords: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b[ÉéEe]lite\b/, label: 'Élite' },
    { pattern: /\bExcelencia\b/i, label: 'Excelencia' },
    { pattern: /\bPremium\b/i, label: 'Premium' },
    { pattern: /\bExcepcional\b/i, label: 'Excepcional' },
    { pattern: /\b[ÚUúu]nico\b/, label: 'Único' },
    { pattern: /\bMejor\b/i, label: 'Mejor' },
    { pattern: /\b[SsÓóOo]lido\b/, label: 'Sólido' },
    { pattern: /\bRobusto\b/i, label: 'Robusto' },
    { pattern: /\bExtraordinario\b/i, label: 'Extraordinario' },
  ];
  for (const { pattern, label } of forbiddenWords) {
    const match = html.match(pattern);
    if (match) {
      failures.push({
        rule: '§1.6 vocabulario prohibido',
        detail: `Palabra prohibida detectada: "${match[0]}" (lista: ${label})`,
        severity: 'block',
      });
    }
  }

  // §5 Slide 12 — hash declarado coincide con metadata.reportHashSha256. El
  // hash es un SHA-256 hex de 64 chars; si el LLM lo trunca o inventa, no
  // coincidirá con el helper determinístico.
  if (!html.includes(metadata.reportHashSha256)) {
    failures.push({
      rule: '§5 Slide 12 — hash verificación',
      detail: `Hash SHA-256 ${metadata.reportHashSha256} no encontrado en HTML output`,
      severity: 'block',
    });
  }

  return failures;
}

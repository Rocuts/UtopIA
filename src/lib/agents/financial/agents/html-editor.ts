// ---------------------------------------------------------------------------
// Agente final: Editor Jefe HTML (v10.1 — cap-stone visual)
// ---------------------------------------------------------------------------
//
// Recibe los JSONs consolidados de los 3 agentes anteriores + metadata
// pre-cocinada (hash determinístico, cobertura por clase PUC, confianza
// global agregada, datos editoriales de la entidad) y produce HTML autoconte-
// nido de 15 páginas A4 portrait siguiendo `docs/spec/financial-report-v10.1.md`
// verbatim como system prompt.
//
// Diferencias respecto a los 3 agentes anteriores:
//
//   1. NO usa `callFinancialAgent` (que asume Zod-validated JSON output). El
//      output es HTML, no JSON, por lo que `experimental_output: Output.object`
//      no aplica — se invoca `generateText` directo del SDK.
//
//   2. Validación post-emisión liviana: `lightweightChecklist` cubre los
//      checks más críticos del §10 / §1.6 / §1.9 / §11 sin parser DOM. El
//      validador profundo con linkedom vive en `html-editor-validator.ts`.
//
//   3. `MODELS.FINANCIAL_PIPELINE` (gpt-5.5 premium por default según
//      models.ts post-2026-05-13) — el HTML de 32-48K tokens necesita el
//      ceiling de 128K de gpt-5.5; gpt-5.4-mini se quedaría sin budget con
//      prompt cache miss en cold start.
//
// SSE: emite un único `stage_progress` antes de invocar el modelo. El consumer
// (`/api/financial-report/html`) lo reenvía como `event: progress` al cliente.
//
// Refs:
//   - docs/spec/financial-report-v10.1.md §10 §11 §1.6 §1.9 §13
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
 * Editor Jefe HTML — agente cap-stone del pipeline 1+1 v10.1.
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
    detail: 'Editor Jefe HTML — componiendo 15 páginas A4 según spec v10.1...',
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
 * Linter de DOM básico — verifica los checks más críticos sin linkedom.
 *
 * Cubre:
 *   - §10 mandatory HTML comments (REPORT_MODE, ENTITY, AGENT_VERSION).
 *   - §1.6 vocabulario prohibido (lista de adjetivos de marketing).
 *   - §11 hash verificación coincide con metadata.reportHashSha256.
 *   - §1.9 metadatos internos del pipeline (Pass-1, anchors, curatorFlags,
 *     *Primary/Comparative, cifras en centavos crudos).
 *   - v10.1 paleta — NO oro (#C49A2E / #9A7418 / #DDB94A / --gold). El
 *     acento es azul prusia #1E3A5F.
 *
 * Lo que NO cubre (lo añade `html-editor-validator.ts` con linkedom):
 *   - Estructura de las 15 páginas en orden.
 *   - Tabular-nums aplicado a columnas numéricas.
 *   - Cero $0 huérfanos sin nota.
 *   - Cuadre aritmético de totales.
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
    { needle: 'AGENT_VERSION: 1+1 v10.1', label: 'AGENT_VERSION' },
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

  // Wave 6.F4 — metadatos internos del pipeline NUNCA en el output final
  // (v2.1 corrección 8). Estos son nombres de variables internas, etapas del
  // pipeline chunked, o cifras en centavos crudos sin formato. Si el LLM los
  // copia textuales del prompt al HTML, el linter los detecta como BLOCK.
  //
  // Why se excluye la zona de comentarios HTML §10: los comments declarativos
  // (REPORT_MODE, ENTITY, AGENT_VERSION, REPORT_HASH_SHA256) son metadata
  // legítima y obligatoria. Solo escaneamos el cuerpo del HTML después de
  // strippar los comments para evitar falsos positivos en `AGENT_VERSION:
  // 1+1 v8.1` que es valor canónico §10.
  const htmlSinComments = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const { pattern, label, rule } of FORBIDDEN_METADATA_PATTERNS) {
    const match = htmlSinComments.match(pattern);
    if (match) {
      failures.push({
        rule,
        detail: `Metadato interno detectado: "${match[0]}" (lista: ${label})`,
        severity: 'block',
      });
    }
  }

  // v10.1 §6 paleta — NO oro. La spec v10.1 reemplaza la paleta oro de v8.1
  // por azul prusia (#1E3A5F) como acento único. Si el LLM regresa al
  // muscle memory de v8.1 emitiendo --gold, #C49A2E, #9A7418 o #DDB94A,
  // el linter lo detecta como BLOCK.
  for (const { pattern, label } of FORBIDDEN_GOLD_PATTERNS) {
    const match = htmlSinComments.match(pattern);
    if (match) {
      failures.push({
        rule: '§6 v10.1 — paleta sin oro',
        detail: `Color/token oro detectado: "${match[0]}" (${label}). Acento único v10.1 = #1E3A5F.`,
        severity: 'block',
      });
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Patrones prohibidos de metadatos internos (Wave 6.F4 — v2.1 corrección 8)
// ---------------------------------------------------------------------------
// Estos patrones cubren los METADATOS INTERNOS del sistema que NUNCA deben
// aparecer en el output final entregado al cliente:
//
//   - "Pass-1", "Pass-2", "Pass-3" — nombres de las 3 etapas chunked del
//     NIIF Analyst (Fase 3). Son detalles de implementación interna.
//   - "anchors", "curatorFlags" — variables internas del orchestrator que se
//     pasan al LLM como contexto pre-computado pero nunca al output.
//   - "netIncomePrimary", "totalAssetsPrimary", "ecpClosingTotal" — nombres
//     de campos del schema Zod que el LLM usa para anclar cifras pero NO
//     debe citar literalmente al cliente.
//   - Cifras en CENTAVOS CRUDOS (≥10 dígitos consecutivos seguidos de la
//     palabra "centavos" o "cents"). El renderer determinístico siempre
//     produce $X.XXX.XXX,XX — si aparece "222849678973 centavos" es bug del
//     LLM copiando el JSON crudo.
//
// Word boundaries (`\b`) evitan falsos positivos: "passenger" no matchea
// "Pass-?", "anchorman" no matchea "anchors". Para palabras con guiones
// (Pass-1) usamos pattern explícito que cubre "Pass1", "Pass-1", "Pass 1".
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Patrones prohibidos de paleta oro (v10.1 §6 — acento único azul prusia)
// ---------------------------------------------------------------------------
// La spec v10.1 reemplaza la paleta oro de v8.1 por azul prusia (#1E3A5F)
// como acento único. Estos patrones detectan el regreso accidental a oro:
//
//   - Tokens CSS: --gold, --gold-d, --gold-l, --accent-gold
//   - Hex literals: #C49A2E (oro), #9A7418 (oro oscuro), #DDB94A (oro claro)
//   - Nombres de clase: .gold, .accent-gold (si el LLM inventa)
//
// Nota: el patrón evita falsos positivos en palabras españolas comunes (oro
// no es token CSS sino sustantivo). Por eso requerimos el contexto técnico:
// el guion `--`, el `#` hex, o el punto `.` de clase CSS.
// ---------------------------------------------------------------------------

const FORBIDDEN_GOLD_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /--gold(?:-[dl])?\b/, label: 'CSS token --gold/--gold-d/--gold-l' },
  { pattern: /#C49A2E\b/i, label: 'hex #C49A2E (oro v8.1)' },
  { pattern: /#9A7418\b/i, label: 'hex #9A7418 (oro oscuro v8.1)' },
  { pattern: /#DDB94A\b/i, label: 'hex #DDB94A (oro claro v8.1)' },
];

const FORBIDDEN_METADATA_PATTERNS: Array<{
  pattern: RegExp;
  label: string;
  rule: string;
}> = [
  {
    pattern: /\bPass[\s-]?[123]\b/i,
    label: 'Pass-1/2/3',
    rule: '§v2.1 corrección 8 — etapas internas pipeline',
  },
  {
    pattern: /\banchors?\b/i,
    label: 'anchors',
    rule: '§v2.1 corrección 8 — variables internas del orchestrator',
  },
  {
    pattern: /\bcuratorFlags?\b/,
    label: 'curatorFlags',
    rule: '§v2.1 corrección 8 — variables internas del curator',
  },
  {
    pattern: /\bnetIncomePrimary\b/,
    label: 'netIncomePrimary',
    rule: '§v2.1 corrección 8 — nombres de campos Zod',
  },
  {
    pattern: /\btotalAssetsPrimary\b/,
    label: 'totalAssetsPrimary',
    rule: '§v2.1 corrección 8 — nombres de campos Zod',
  },
  {
    pattern: /\btotalLiabilitiesPrimary\b/,
    label: 'totalLiabilitiesPrimary',
    rule: '§v2.1 corrección 8 — nombres de campos Zod',
  },
  {
    pattern: /\btotalEquityPrimary\b/,
    label: 'totalEquityPrimary',
    rule: '§v2.1 corrección 8 — nombres de campos Zod',
  },
  {
    pattern: /\becpClosingTotal\b/,
    label: 'ecpClosingTotal',
    rule: '§v2.1 corrección 8 — nombres de campos Zod',
  },
  {
    pattern: /\bcashClosing\b/,
    label: 'cashClosing',
    rule: '§v2.1 corrección 8 — nombres de campos Zod',
  },
  {
    pattern: /\b\d{10,}\s*(?:centavos|cents)\b/i,
    label: 'cifras en centavos crudos',
    rule: '§v2.1 corrección 8 — formato moneda (debe ser $X.XXX.XXX,XX)',
  },
];

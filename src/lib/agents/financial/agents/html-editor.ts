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
  type HtmlEditorOutput,
} from '../contracts/html-editor';
import {
  buildHtmlEditorSystemPrompt,
  buildHtmlEditorUserContent,
} from '../prompts/html-editor.prompt';
import type { FinancialProgressEvent } from '../types';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '../utils/finish-reason-check';
import {
  reconcileBindingFigures,
  validateHtmlChecklist,
  type ChecklistFailure,
} from './html-editor-validator';

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
 * @returns HtmlEditorOutput con `html` (string), echo de `metadata`,
 *          `checklistFailures` de los 3 linters y `emittable`.
 *
 * @throws Error si:
 *   - el input no pasa `HtmlEditorInputSchema.safeParse`,
 *   - el modelo trunca el output (`finishReason !== 'stop'`),
 *   - el HTML no abre con DOCTYPE o no cierra con </html>,
 *   - el provider OpenAI lanza error no-retriable.
 *
 * ## Política de `severity: 'block'` (decisión 2026-08)
 *
 * Antes de esta ola, `block` no significaba nada: ni la route ni el viewer lo
 * consultaban, así que un reporte con el Activo inflado 100× se servía y se
 * descargaba con un banner que el usuario podía ignorar. La política ahora es:
 *
 *   1. Un reintento correctivo, con los fallos concretos inyectados en el
 *      prompt. Se conserva la mejor de las dos emisiones.
 *   2. Si sobrevive algún `block`, el HTML se estampa como BORRADOR (banner en
 *      pantalla + marca de agua al imprimir) y `emittable` viaja en `false`.
 *
 * Por qué NO se responde 422 y se deja al cliente sin documento: los checks
 * incluyen heurísticas y un falso positivo dejaría al contador sin entregable
 * después de ~10 minutos de pipeline. El estampado degrada en vez de romper, y
 * a diferencia de un banner viaja DENTRO del artefacto: quien lo imprima o lo
 * reenvíe ve que no es firmable.
 */
export async function runHtmlEditor(
  input: HtmlEditorInput,
  onProgress?: (event: FinancialProgressEvent) => void,
  signal?: AbortSignal,
  hechosEmpresa?: string,
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
  const userContent = buildHtmlEditorUserContent(parsed.data, hechosEmpresa);

  onProgress?.({
    type: 'stage_progress',
    stage: 4,
    detail: 'Editor Jefe HTML — componiendo 15 páginas A4 según spec v10.1...',
  });

  // 2 attempts en lugar de 3 (default `withRetry`): el HTML de ~28K tokens
  // tarda 30-60s; 3 reintentos × 60s = 180s sólo en LLM, comiendo el budget
  // de maxDuration=800. 2 attempts cubren los transients (429/5xx) sin
  // explotar el timeout.
  const emit = (content: string) =>
    withRetry(
      () =>
        generateText({
          model: MODELS.FINANCIAL_PIPELINE,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
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

  const result = await emit(userContent);

  // Why FUERA del closure de `withRetry`: con `temperature: 0`, reintentar una
  // truncación por presupuesto reproduce el mismo corte y quema 60s del
  // maxDuration=800 sin ganancia. Es un fallo de configuración, no un
  // transient.
  //
  // Why aquí y no sólo el check de DOCTYPE: el DOCTYPE es el PRIMER byte que
  // emite el modelo, de modo que un informe cortado a mitad de la Página 09
  // lo contiene siempre y pasaba el gate. El hash tampoco lo atrapa: va en la
  // portada. Sin este assert, un entregable premium incompleto llegaba al
  // cliente sin una sola advertencia.
  assertFinishedCleanlyOrThrow(result, 'html-editor');
  const html = assertWellFormedHtml(result.text ?? '', result.finishReason);

  let checklistFailures = runAllChecks(html, parsed.data);
  let finalHtml = html;

  // Reintento correctivo — ver "Política de severity: 'block'" en el docblock.
  if (countBlocking(checklistFailures) > 0) {
    onProgress?.({
      type: 'stage_progress',
      stage: 4,
      detail: 'Editor Jefe HTML — corrigiendo fallos de verificación numérica...',
    });

    try {
      const retryResult = await emit(
        `${userContent}\n\n${buildCorrectionBlock(checklistFailures)}`,
      );
      assertFinishedCleanlyOrThrow(retryResult, 'html-editor(corrección)');
      const retryHtml = assertWellFormedHtml(
        retryResult.text ?? '',
        retryResult.finishReason,
      );
      const retryFailures = runAllChecks(retryHtml, parsed.data);

      // Se conserva la emisión con MENOS fallos bloqueantes. Sin esta guarda,
      // un reintento peor sustituiría a un original casi correcto.
      if (countBlocking(retryFailures) < countBlocking(checklistFailures)) {
        finalHtml = retryHtml;
        checklistFailures = retryFailures;
      }
    } catch (err) {
      // El reintento es una mejora best-effort, no un gate: si falla, se
      // conserva la primera emisión (que se estampará como BORRADOR). Tumbar
      // la request dejaría al usuario sin nada tras ~10 min de pipeline.
      if (signal?.aborted) throw err; // salvo cancelación explícita del cliente
      console.warn(
        `[html-editor] el reintento correctivo falló (${err instanceof Error ? err.message : String(err)}); ` +
          'se conserva la emisión original, estampada como BORRADOR.',
      );
    }
  }

  const emittable = countBlocking(checklistFailures) === 0;
  if (!emittable) {
    // El estampado ocurre DESPUÉS de validar: la marca es nuestra, no del
    // modelo, y no debe influir en ningún check.
    finalHtml = stampAsDraft(finalHtml, checklistFailures);
  }

  return {
    html: finalHtml,
    metadata: parsed.data.metadata,
    checklistFailures,
    emittable,
  };
}

function countBlocking(failures: ChecklistFailure[]): number {
  return failures.filter((f) => f.severity === 'block').length;
}

/**
 * Verifica que el HTML abra y CIERRE. El check anterior sólo miraba el DOCTYPE
 * — el primer byte emitido —, así que no distinguía un documento completo de
 * uno cortado a la mitad.
 *
 * `endsWith` y no `includes('</html>')`: un `</html>` dentro de un ejemplo o de
 * un comentario no prueba que el documento haya terminado.
 */
function assertWellFormedHtml(html: string, finishReason?: string): string {
  const trimmed = html.trim();
  if (!trimmed || !trimmed.includes('<!DOCTYPE html>')) {
    throw new Error(
      `runHtmlEditor: output inválido — sin DOCTYPE html ` +
        `(finishReason=${finishReason}, textLen=${html.length}). ` +
        `Probable causa: prompt cache miss + budget insuficiente. ` +
        `Subir MODELS_CONFIG.htmlEditor.maxOutputTokens o cambiar a FINANCIAL_PIPELINE_PREMIUM.`,
    );
  }
  if (!trimmed.endsWith('</html>')) {
    throw new Error(
      `runHtmlEditor: output TRUNCADO — el documento no cierra con </html> ` +
        `(finishReason=${finishReason}, textLen=${html.length}). ` +
        `Un HTML cortado a mitad de página se vería completo en el visor: no se sirve. ` +
        `Subir MODELS_CONFIG.htmlEditor.maxOutputTokens o cambiar a FINANCIAL_PIPELINE_PREMIUM.`,
    );
  }
  return trimmed;
}

/**
 * Corre los tres linters sobre el HTML emitido:
 *
 *   1. `validateHtmlChecklist` — §11 completo con parser DOM (estructura,
 *      15 páginas, aritmética por columna, vocabulario, paleta, hash).
 *   2. `reconcileBindingFigures` — HTML contra el JSON de origen.
 *   3. `internalMetadataChecklist` — §1.9, metadatos internos del pipeline.
 *
 * Why (1) no se solapa con (3): hasta esta ola producción sólo corría un
 * linter ligero que duplicaba §10/§1.6/§5/§6 del validador profundo — y ese
 * validador profundo, el único con aritmética, no lo importaba ningún archivo
 * de producción. En vez de fusionar y deduplicar strings, se eliminó el
 * solapamiento: el profundo es superconjunto en todo salvo §1.9, que es lo
 * único que queda en el linter local.
 */
function runAllChecks(html: string, input: HtmlEditorInput): ChecklistFailure[] {
  const failures: ChecklistFailure[] = [];

  // Un HTML tan malformado que linkedom no pueda parsearlo es, por sí mismo,
  // un entregable inválido: se reporta en vez de tumbar la request.
  try {
    failures.push(...validateHtmlChecklist(html, input.metadata));
  } catch (err) {
    failures.push({
      rule: '§11 — validador profundo',
      detail: `El HTML no pudo parsearse como DOM: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'block',
    });
  }

  try {
    failures.push(...reconcileBindingFigures(html, input));
  } catch (err) {
    failures.push({
      rule: '§1.1 · Reconciliación JSON↔HTML',
      detail: `La reconciliación no pudo ejecutarse: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'block',
    });
  }

  failures.push(...internalMetadataChecklist(html));
  return failures;
}

/**
 * Bloque correctivo para el reintento. Enumera los fallos concretos en vez de
 * pedir genéricamente "revisa las cifras": el modelo corrige lo que se le
 * nombra.
 */
function buildCorrectionBlock(failures: ChecklistFailure[]): string {
  const blocking = failures.filter((f) => f.severity === 'block');
  const lines = blocking.map((f) => `- [${f.rule}] ${f.detail}`).join('\n');
  return `<correcciones_obligatorias>
La emisión anterior de este mismo informe falló la verificación determinística en los puntos siguientes. Vuelve a emitir el documento COMPLETO corrigiéndolos, sin alterar nada más.

${lines}

Las cifras de <cifras_vinculantes> se copian carácter por carácter: si una de ellas falta en el HTML, es que fue reescrita o reconvertida.
</correcciones_obligatorias>`;
}

/**
 * Estampa el HTML como BORRADOR cuando sobrevive un fallo bloqueante.
 *
 * Es el gate real: un banner en el visor se ignora y no sobrevive a la
 * descarga; esto viaja dentro del artefacto y se imprime en cada página.
 *
 * Paleta: azul prusia `#1E3A5F` (acento único v10.1 §6). No se usa rojo ni
 * oro — el oro está prohibido por el propio checklist.
 */
function stampAsDraft(html: string, failures: ChecklistFailure[]): string {
  const blocking = countBlocking(failures);
  const style = `<style>
  .utopia-borrador{position:relative;z-index:9999;margin:0;padding:10px 16px;background:#1E3A5F;color:#FFFFFF;font-family:Inter,system-ui,sans-serif;font-size:12px;line-height:1.45;letter-spacing:.02em;text-align:center}
  .utopia-borrador strong{letter-spacing:.14em}
  @media print{
    .utopia-borrador{position:fixed;top:0;left:0;right:0}
    .page::after{content:"BORRADOR";position:absolute;top:45%;left:0;right:0;text-align:center;font-family:Inter,system-ui,sans-serif;font-size:96pt;font-weight:700;color:rgba(30,58,95,.10);letter-spacing:.18em;pointer-events:none;z-index:9998}
  }
</style>`;
  const banner = `<div class="utopia-borrador"><strong>BORRADOR</strong> — este documento no superó la verificación numérica automática (${blocking} hallazgo${blocking === 1 ? '' : 's'} bloqueante${blocking === 1 ? '' : 's'}). No es apto para firma ni para presentación ante terceros hasta su revisión.</div>`;

  // Inserta tras la etiqueta <body ...>. Si por lo que sea no aparece, se
  // antepone: es preferible un banner desubicado a un borrador sin marcar.
  const bodyOpen = html.match(/<body[^>]*>/i);
  if (!bodyOpen) return `${style}${banner}${html}`;
  const at = (bodyOpen.index ?? 0) + bodyOpen[0].length;
  return `${html.slice(0, at)}${style}${banner}${html.slice(at)}`;
}

/**
 * Linter local §1.9 — metadatos internos del pipeline que jamás deben llegar
 * al cliente (nombres de variables, etapas del chunking, centavos crudos).
 *
 * Why sólo §1.9: hasta la ola 2026-08 esta función era `lightweightChecklist`
 * y comprobaba además §10 comments, §1.6 vocabulario, §5 hash y §6 paleta —
 * exactamente los mismos cuatro checks que ya implementa `validateHtmlChecklist`
 * (Checks 1, 15, 13 y 16). Al cablear el validador profundo en producción esos
 * checks salían DUPLICADOS en el banner. En lugar de deduplicar strings a
 * posteriori se eliminó el solapamiento en origen: el validador profundo es
 * superconjunto salvo en §1.9, que vive aquí porque no necesita DOM.
 */
function internalMetadataChecklist(
  html: string,
): HtmlEditorOutput['checklistFailures'] {
  const failures: HtmlEditorOutput['checklistFailures'] = [];

  // Wave 6.F4 — metadatos internos del pipeline NUNCA en el output final
  // (v2.1 corrección 8). Estos son nombres de variables internas, etapas del
  // pipeline chunked, o cifras en centavos crudos sin formato. Si el LLM los
  // copia textuales del prompt al HTML, el linter los detecta como BLOCK.
  //
  // Why se excluye la zona de comentarios HTML §10: los comments declarativos
  // (REPORT_MODE, ENTITY, AGENT_VERSION, REPORT_HASH_SHA256) son metadata
  // legítima y obligatoria. Solo escaneamos el cuerpo del HTML después de
  // strippar los comments para evitar falsos positivos en `AGENT_VERSION:
  // 1+1 v10.1` que es valor canónico §10.
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

  // Fuga de CENTAVOS CRUDOS sin la palabra "centavos" al lado.
  //
  // Why además del patrón `\d{10,}\s*centavos` de arriba: ese patrón exige la
  // palabra literal, que es justo lo que NO aparece cuando el modelo copia un
  // MoneyCop del JSON o un token `[MoneyCop: N]` del bloque de cifras
  // vinculantes. Es decir, no cubría el caso real.
  //
  // Why 11 dígitos y no 9: un NIT colombiano son 9-10 dígitos y un teléfono
  // 10. A partir de 11 dígitos seguidos sin separador en texto visible ya no
  // hay identificador legítimo — sólo un monto en centavos sin formatear.
  //
  // Se escanea sobre texto visible y con el hash SHA-256 removido: un hash hex
  // real puede contener rachas largas de dígitos.
  const visibleText = htmlSinComments
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b[0-9a-f]{64}\b/gi, ' ');

  if (/\bMoneyCop\b/.test(visibleText)) {
    failures.push({
      rule: '§v2.1 corrección 8 — formato moneda (debe ser $X.XXX.XXX,XX)',
      detail:
        'Token interno "MoneyCop" detectado en el cuerpo del informe: el modelo copió el ancla en vez de la cifra formateada.',
      severity: 'block',
    });
  }

  const rawCents = visibleText.match(/(?<![\d.,-])\d{11,}(?![\d.,])/);
  if (rawCents) {
    failures.push({
      rule: '§v2.1 corrección 8 — formato moneda (debe ser $X.XXX.XXX,XX)',
      detail: `Entero de ${rawCents[0].length} dígitos sin separadores detectado ("${rawCents[0]}") — cifra en centavos crudos sin formatear.`,
      severity: 'block',
    });
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

// La paleta oro (§6, Check 16) y el vocabulario prohibido (§1.6, Check 15) ya
// no se comprueban aquí: los cubre `validateHtmlChecklist`, ahora cableado en
// producción. Duplicarlos sólo producía fallos dobles en el banner.

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
    // Lookbehind (?<![\w-]) en lugar de \b: el atributo SVG `text-anchor`
    // (obligatorio en el waterfall de la Página 05, spec §5) contiene la
    // subcadena "anchor" precedida de guion — con \b cada reporte
    // spec-compliant disparaba un falso BLOCK.
    pattern: /(?<![\w-])anchors?\b/i,
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

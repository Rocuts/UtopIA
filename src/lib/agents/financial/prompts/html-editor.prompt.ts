// ---------------------------------------------------------------------------
// System prompt del Editor Jefe HTML (Wave 4.F7)
// ---------------------------------------------------------------------------
//
// Embebe `docs/spec/financial-report-v8.1.md` VERBATIM como instrucción de
// sistema. La especificación es authoritative — cualquier divergencia entre
// spec y comportamiento es BUG del prompt o del modelo, NO del agente.
//
// Diseño cache-friendly (regla GPT-5.4 §4):
//
//   - El spec verbatim (~541 líneas, ~14K tokens) es ESTÁTICO e idéntico en
//     cada llamada. Va arriba del system prompt → el prompt cache automático
//     de GPT-5.4 lo reutiliza con >95% hit rate después del primer warmup.
//   - El payload dinámico (metadata + 3 JSONs) va en el user content → no
//     contamina el cache del system.
//
// Lectura del fichero: `readFileSync` con memoización en módulo. Una sola I/O
// por proceso. `resolve(process.cwd(), …)` funciona en Vercel Fluid Compute
// porque el spec viaja con el bundle (`docs/spec/*.md` está en el repo, no
// excluido del build).
//
// Refs:
//   - docs/spec/financial-report-v8.1.md (toda la spec)
//   - CLAUDE.md §"Prompt patterns GPT-5.4 (outcome-first)" — cache layout
// ---------------------------------------------------------------------------

import type { HtmlEditorInput } from '../contracts/html-editor';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Memoización proceso-locales del spec verbatim. Una sola I/O síncrona por
 * arranque de proceso (cold start en Vercel = 1 lectura; warm requests = 0).
 *
 * Why síncrono y no async: este builder es invocado dentro de un `await`
 * sobre `generateText`, no en el critical path de arranque. La I/O ocurre la
 * primera vez que se compone un HTML — momento en que ya estamos en una
 * función async, con el orchestrator esperando. Cargar async añade
 * complejidad sin beneficio: el archivo pesa ~28 KB y Vercel lo tiene en el
 * filesystem local.
 */
let cachedSpec: string | null = null;
function loadSpecVerbatim(): string {
  if (cachedSpec === null) {
    const specPath = resolve(process.cwd(), 'docs/spec/financial-report-v8.1.md');
    cachedSpec = readFileSync(specPath, 'utf-8');
  }
  return cachedSpec;
}

/**
 * Builder del system prompt. NO toma argumentos porque el spec es 100%
 * estático — todo lo dinámico va en el user content (`buildHtmlEditorUserContent`).
 * Esta separación es lo que permite cache hit rate >95%.
 */
export function buildHtmlEditorSystemPrompt(): string {
  return loadSpecVerbatim();
}

/**
 * Builder del user content. Compone el payload con XML tags estructurados
 * (CTCO + XML, regla GPT-5.4 §1) y rules duras en ALWAYS/NEVER (reservado a
 * safety rails, regla GPT-5.4 §2):
 *
 *   - ALWAYS: emit DOCTYPE, los 8 comentarios HTML §10, declarar
 *             metadata.reportMode + reportHashSha256.
 *   - NEVER : incluir vocabulario prohibido §1.6, emitir $0 huérfanos sin
 *             nota (§1.2), inventar valores fuera del JSON payload.
 *
 * Los `<success_criteria>` codifican el §11 checklist en formato outcome-first
 * — el reasoning model encuentra mejor ruta cuando lee criterios de éxito
 * verificables, no procedimiento procedural ("Paso 1 / Paso 2 / Paso 3" está
 * prohibido por la regla GPT-5.4 §1).
 *
 * Why pasamos los 3 JSONs como `JSON.stringify(..., null, 2)`:
 *   - Indentación legible mantiene el prompt parseable si Johan lo inspecciona.
 *   - El modelo cita los path por keys (`niif_report.balanceSheet.assets[0]`)
 *     con menos errores cuando el JSON está bien formateado.
 *   - El overhead de tokens es marginal (~10%) comparado con `JSON.stringify`
 *     sin indent.
 */
export function buildHtmlEditorUserContent(input: HtmlEditorInput): string {
  return `<task>Genera el HTML autocontenido v8.1 de 12 slides según el spec del system prompt.</task>

<context>
<metadata>
${JSON.stringify(input.metadata, null, 2)}
</metadata>

<niif_report>
${JSON.stringify(input.niifReport, null, 2)}
</niif_report>

<strategy_report>
${JSON.stringify(input.strategyReport, null, 2)}
</strategy_report>

<governance_report>
${JSON.stringify(input.governanceReport, null, 2)}
</governance_report>

<language>${input.language}</language>
</context>

<constraints>
- ALWAYS: emit valid HTML5 starting with <!DOCTYPE html>.
- ALWAYS: emit the 8 mandatory HTML comments at the top of <head> (§10 spec): REPORT_MODE, ENTITY, PERIOD, GENERATED_AT, AGENT_VERSION, CONFIDENCE_GLOBAL, ALERTS_HIGH, ALERTS_MEDIUM.
- ALWAYS: declare metadata.reportMode LITERAL en el comentario <!-- REPORT_MODE: ... -->.
- ALWAYS: declare metadata.reportHashSha256 LITERAL en el bloque de verificación del Slide 12.
- ALWAYS: declare metadata.entityNit en <!-- ENTITY: ... --> y metadata.agentVersion en <!-- AGENT_VERSION: 1+1 v8.1 -->.
- NEVER: include adjetivos prohibidos de la lista §1.6 (Élite, Excelencia, Premium, Excepcional, Único, Mejor, Sólido, Robusto, Extraordinario).
- NEVER: emit $0 huérfanos sin nota explicativa (§1.2) — usa "—" con marca [i] referenciada en "Limitaciones de Información".
- NEVER: invent values not present in the JSON payloads; only cite numbers from niif_report / strategy_report / governance_report / metadata.
- If unsure about a presentation decision not covered by the spec, default to the §12 principio de incertidumbre y omite el dato con marca <!-- DECISION_REQUIRED -->.
</constraints>

<success_criteria>
- §11 checklist completo: 23 viñetas verificables al emitir.
- Hash declarado en Slide 12 coincide literal con metadata.reportHashSha256 (64 chars hex).
- reportMode declarado en HTML comments coincide con metadata.reportMode.
- Plus Jakarta Sans loaded from Google Fonts CDN único.
- CSS embebido en <style>, no externo.
- @media print configurado para impresión carta horizontal.
- aspect-ratio: 16/9 y max-width: 1440px aplicados al selector .slide.
- Tabular-nums aplicado a toda columna numérica.
- 12 slides en orden estricto (§4): Portada → Mensaje RL → Resumen Ejecutivo → KPIs → Cascada → Balance → Resultados → Flujo+ECP → Notas 1 → Notas 2 → Recomendaciones → Cierre.
</success_criteria>`;
}

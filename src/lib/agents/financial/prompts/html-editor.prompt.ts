// ---------------------------------------------------------------------------
// System prompt del Editor Jefe HTML (v10.1)
// ---------------------------------------------------------------------------
//
// Embebe `docs/spec/financial-report-v10.1.md` VERBATIM como instrucción de
// sistema. La especificación es authoritative — cualquier divergencia entre
// spec y comportamiento es BUG del prompt o del modelo, NO del agente.
//
// Diseño cache-friendly (regla GPT-5.4 §4):
//
//   - El spec verbatim (~700 líneas, ~20K tokens) es ESTÁTICO e idéntico en
//     cada llamada. Va arriba del system prompt → el prompt cache automático
//     de GPT-5.4/5.5 lo reutiliza con >95% hit rate después del primer warmup.
//   - El payload dinámico (metadata + 3 JSONs) va en el user content → no
//     contamina el cache del system.
//
// Lectura del fichero: `readFileSync` con memoización en módulo. Una sola I/O
// por proceso. `resolve(process.cwd(), …)` funciona en Vercel Fluid Compute
// porque el spec viaja con el bundle (`docs/spec/*.md` está en el repo, no
// excluido del build).
//
// Refs:
//   - docs/spec/financial-report-v10.1.md (toda la spec)
//   - CLAUDE.md §"Prompt patterns GPT-5.4 (outcome-first)" — cache layout
// ---------------------------------------------------------------------------

import type { HtmlEditorInput } from '../contracts/html-editor';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Memoización proceso-local del spec verbatim. Una sola I/O síncrona por
 * arranque de proceso (cold start en Vercel = 1 lectura; warm requests = 0).
 *
 * Why síncrono y no async: este builder es invocado dentro de un `await`
 * sobre `generateText`, no en el critical path de arranque. La I/O ocurre la
 * primera vez que se compone un HTML — momento en que ya estamos en una
 * función async, con el orchestrator esperando. Cargar async añade
 * complejidad sin beneficio: el archivo pesa ~30 KB y Vercel lo tiene en el
 * filesystem local.
 */
let cachedSpec: string | null = null;
function loadSpecVerbatim(): string {
  if (cachedSpec === null) {
    const specPath = resolve(process.cwd(), 'docs/spec/financial-report-v10.1.md');
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
 *             metadata.reportMode + reportHashSha256 + agentVersion.
 *   - NEVER : incluir vocabulario prohibido §1.6, emitir $0 huérfanos sin
 *             nota (§1.2), inventar valores fuera del JSON payload, usar
 *             paleta oro (la spec v10.1 reemplaza oro por azul prusia).
 *
 * Los `<success_criteria>` codifican el §11 checklist en formato outcome-first
 * — el reasoning model encuentra mejor ruta cuando lee criterios de éxito
 * verificables, no procedimiento procedural ("Paso 1 / Paso 2 / Paso 3" está
 * prohibido por la regla GPT-5.4 §1).
 */
export function buildHtmlEditorUserContent(input: HtmlEditorInput): string {
  return `<task>Genera el HTML autocontenido v10.1 de 15 páginas A4 portrait según la plantilla maestra del system prompt (§13). Reemplaza los placeholders {{...}} con los valores del payload JSON. Estética: Berkshire Hathaway / Financial Times / Bloomberg Markets — austeridad como señal de autoridad.</task>

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
- ALWAYS: declare metadata.reportHashSha256 LITERAL en (a) la portada inferior + (b) la tabla de trazabilidad de la Página 14.
- ALWAYS: declare metadata.entityNit en <!-- ENTITY: ... --> y la línea literal "AGENT_VERSION: 1+1 v10.1".
- ALWAYS: incluir Source Serif 4 + Inter + IBM Plex Mono desde Google Fonts CDN único (un solo <link href="..." rel="stylesheet">).
- ALWAYS: 15 páginas en orden estricto (§4): Portada, TOC, 02..14. Cada una en su propio <article class="page">.
- ALWAYS: aplicar break-after: page; page-break-after: always; a cada .page.
- ALWAYS: logo "1+1" aparece UNA SOLA VEZ, en la esquina inferior derecha de la Página 14 (§1 R10).
- NEVER: include adjetivos prohibidos de la lista §1.6 (Élite, Excelencia, Premium, Excepcional, Único, Mejor, Sólido, Robusto, Extraordinario).
- NEVER: usar paleta oro (#C49A2E / #9A7418 / #DDB94A / --gold / --gold-d / --gold-l). El acento único es azul prusia #1E3A5F (--accent).
- NEVER: emit $0 huérfanos sin nota explicativa (§1.2) — usa "—" o "No disponible" en muted italic con marca [i] referenciada en "Limitaciones de Información".
- NEVER: emitir metadatos internos del pipeline en el output final (§1.9): "Pass-1", "Pass-2", "Pass-3", "anchors", "curatorFlags", "netIncomePrimary", "totalAssetsPrimary", "ecpClosingTotal", "cashClosing", ni cifras en centavos crudos.
- NEVER (REFUERZO v2.2 — correcciones #6, #11, #12). El cliente firmable JAMÁS lee:
  - Identificadores de pases internos: "Pass-1", "Pass-2", "Pass-3", "anchor Pass-N", "primer pase del agente".
  - Nombres de variables del sistema: netIncomePrimary, totalEquityPrimary, totalAssetsPrimary, totalLiabilitiesPrimary, amountPrimary, amountComparative, curatorFlags, equityConvergenceApplied, cashFlowClosureForced, negativeAssetReclassified, presumedCostWarning, reclassifiedAmountCop.
  - Cuentas virtuales del curator: "2810ZZ" o cualquier código con sufijo ZZ/XX/transitorio/virtual.
  - Movimientos internos: "3605-movimiento-periodo", "varCuentasPorCobrar"/"varInventarios"/"varCuentasPorPagar" (los conceptos contables sí son válidos; los nombres de variables NO).
  - Referencias a la maquinaria: "el orquestador indicó", "el preprocesador reporta", "binding totals", "controlTotals", "según el sistema interno".
  - Encabezados del preparador: "NOTAS INTERNAS DEL PREPARADOR", "NO incluir en EEFF firmables", "Advertencia interna de Valoración", "Notas del Preparador".
  - Cifras en formato técnico: enteros de 9+ dígitos sin separadores ("241367788864"), notación científica ($2.23E9), "X centavos" donde X es un entero crudo de 9+ dígitos.
  Si una nota técnica contiene cualquiera de los patrones anteriores, reescribirla en términos contables del cliente o omitirla. Toda cifra se renderiza en formato $1.234.567,89.
- NEVER: invent values not present in the JSON payloads; only cite numbers from niif_report / strategy_report / governance_report / metadata.
- NEVER: usar Plus Jakarta Sans, Geist, Helvetica, ni ninguna otra familia tipográfica fuera de Source Serif 4 / Inter / IBM Plex Mono.
- If unsure about a presentation decision not covered by the spec, default to §12 principio de incertidumbre y omite el dato con marca <!-- DECISION_REQUIRED -->.
</constraints>

<success_criteria>
- §11 checklist completo: 30 viñetas verificables al emitir.
- Hash declarado en portada + Página 14 coincide literal con metadata.reportHashSha256 (64 chars hex).
- reportMode declarado en HTML comments coincide con metadata.reportMode.
- Source Serif 4 + Inter + IBM Plex Mono cargados desde Google Fonts CDN único.
- CSS embebido en <style>, no externo.
- @page A4 portrait + @media print configurado para impresión vertical.
- Activo total = Pasivo total + Patrimonio total (tolerancia $0 centavos).
- Variación resultadoEjercicio en ECP == netIncomePrimary del P&L (tolerancia 0.5%).
- EFE: efectivo inicial = saldo PUC 11 real (NO total activos); NUNCA Cta.3605 como comodín (§5 Página 07).
- ROE consistente: KPIs, executiveDashboard, dupontAnalysis, trends, recommendations usan TODOS la fórmula única de controlTotals.roe.
- Tablas Markdown reales (no inline pipe-separated) en estados financieros.
- Devoluciones Cta.4175 en LÍNEA SEPARADA del P&L (NIIF 15 §47).
- Defensa Art.647 E.T. en UNA SOLA nota consolidada al final de Notas Parte 2.
- Numeración de notas secuencial 1..N sin saltos.
- Cero adjetivos prohibidos §1.6 en el cuerpo.
- Cero metadatos internos del pipeline (§1.9).
- Tagline de portada coincide con el modo (§3): LINEA_BASE / TRANSICION / COMPARATIVO_COMPLETO.
- 15 páginas en orden estricto (§4).
- Logo 1+1 una sola vez (Página 14).
</success_criteria>`;
}

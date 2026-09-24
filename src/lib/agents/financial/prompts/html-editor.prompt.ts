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

import {
  collectBindingFigures,
  collectActaBindingFigures,
  type BindingFigure,
  type HtmlEditorInput,
} from '../contracts/html-editor';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildResilienceSection0 } from './resilience-section0';
import { applyKpiAnchors, strategyAnchorSources } from '../validators/strategy-anchors';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import type { NiifReportJson } from '../contracts/niif-report';
import { cashFlowHasComparativeColumn, comparativeStatementLegend } from '@/lib/export/statement-presentation';

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
  return `${buildResilienceSection0()}\n\n${loadSpecVerbatim()}`;
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
/**
 * Bloque de cifras ya convertidas a pesos.
 *
 * Why existe: el payload lleva cada monto como MoneyCop en CENTAVOS
 * (`"241367788864"`) y la constraint de presentación exige `$1.234.567,89`.
 * Eso obligaba al modelo a dividir entre 100 y a insertar separadores para
 * ~200 cifras del documento que el cliente firma ante la DIAN — y un solo
 * desliz de escala produce un informe impecable con el Activo inflado 100×.
 *
 * La conversión la hace ahora `collectBindingFigures` en TypeScript, una vez.
 * El modelo COPIA. Y `reconcileBindingFigures` exige después que estas mismas
 * cadenas aparezcan literalmente en el HTML, así que prompt y validador no
 * pueden divergir: comparten la función.
 *
 * Se emite el valor ABSOLUTO: el signo es una decisión de presentación NIIF
 * (paréntesis para negativos) que la spec §13 ya gobierna.
 */
function buildBindingFiguresBlock(figures: BindingFigure[]): string {
  if (figures.length === 0) return '';
  const rows = figures
    .map(
      (f) =>
        `${f.label}: ${f.formatted}${f.isNegative ? '  (valor negativo — preséntalo entre paréntesis)' : ''}  ← ${f.path}`,
    )
    .join('\n');
  return `<cifras_vinculantes>
Estas cifras YA están convertidas a pesos y formateadas en convención COP. Se copian carácter por carácter en el HTML; NO se reconvierten desde los centavos del JSON, NO se redondean y NO se abrevian en los estados financieros.

${rows}
</cifras_vinculantes>`;
}

/** Cifra de un MoneyCop en pesos COP, en valor absoluto y con la marca de signo del bloque vinculante. */
function comparativeFigure(label: string, cents: string | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  let value: bigint;
  try {
    value = parseMoneyCop(cents);
  } catch {
    return null;
  }
  const negative = value < BigInt(0);
  return `${label}: ${formatCopFromCents(negative ? -value : value, true)}${negative ? '  (valor negativo — preséntalo entre paréntesis)' : ''}`;
}

const CASH_FLOW_SECTION_LABELS: Record<string, string> = {
  operating: 'Flujo neto de actividades de operación',
  investing: 'Flujo neto de actividades de inversión',
  financing: 'Flujo neto de actividades de financiación',
};

const EQUITY_COLUMN_LABELS: Array<[keyof NiifReportJson['equityChanges']['rows'][number], string]> = [
  ['capitalSocial', 'capital'],
  ['primaColocacion', 'prima en colocación'],
  ['reservaLegal', 'reserva legal'],
  ['otrasReservas', 'otras reservas'],
  ['resultadosAcumulados', 'resultados acumulados'],
  ['resultadoEjercicio', 'resultado del ejercicio'],
  ['ori', 'ORI'],
  ['total', 'total'],
];

/**
 * Comparativos del EFE y del ECP (pendiente #3; integración I2). Los calcula
 * el código desde el corte anterior al comparativo o los deja sin presentar
 * con una nota determinista (`cashFlow.comparativeNote`,
 * `equityChanges.comparativeNote`). El Editor Jefe los COPIA: las cifras ya
 * vienen en pesos y el validador (`reconcileBindingFigures`) bloquea una cifra
 * comparativa del EFE/ECP que no esté en el JSON.
 */
function buildComparativeStatementsBlock(niif: NiifReportJson | null | undefined): string {
  const cp = niif?.company?.comparativePeriod ?? null;
  if (!niif || !cp || !niif.cashFlow || !niif.equityChanges) return '';
  const lines: string[] = [];
  const cf = niif.cashFlow;
  if (cashFlowHasComparativeColumn(cf)) {
    lines.push(`EFE ${cp} (segunda columna del EFE, después de la del periodo actual):`);
    for (const section of cf.sections) {
      for (const line of section.lines) {
        const f = comparativeFigure(`- ${line.label} ${cp}`, line.amountComparative);
        if (f) lines.push(f);
      }
      const subtotal = comparativeFigure(
        `- ${CASH_FLOW_SECTION_LABELS[section.section] ?? section.section} ${cp}`,
        section.netFlowComparative,
      );
      if (subtotal) lines.push(subtotal);
    }
    for (const f of [
      comparativeFigure(`- Aumento (disminución) neto en efectivo ${cp}`, cf.netChangeComparative),
      comparativeFigure(`- Efectivo al inicio del período ${cp}`, cf.cashOpeningComparative),
      comparativeFigure(`- Efectivo al final del período ${cp}`, cf.cashClosingComparative),
    ]) {
      if (f) lines.push(f);
    }
  } else {
    const note = comparativeStatementLegend('cashFlow', niif);
    lines.push(`EFE ${cp}: no se presenta. Nota para copiar literal bajo el EFE:`, note ?? '');
  }
  lines.push('');
  const rows = niif.equityChanges.comparativeRows ?? null;
  if (rows && rows.length > 0) {
    lines.push(`ECP ${cp} (filas del periodo ${cp}, antes de las del periodo actual):`);
    for (const row of rows) {
      const cells = EQUITY_COLUMN_LABELS.map(([key, label]) => {
        const f = comparativeFigure(label, row[key] as string);
        return f ? f.replace(': ', ' ').replace('  (valor negativo — preséntalo entre paréntesis)', ' (negativo)') : null;
      }).filter((c): c is string => c !== null);
      lines.push(`- ${row.label}: ${cells.join(' · ')}`);
    }
  } else {
    const note = comparativeStatementLegend('equity', niif);
    lines.push(`ECP ${cp}: no se presenta. Nota para copiar literal bajo el ECP:`, note ?? '');
  }
  return `<comparativos_efe_ecp>
Comparativos del EFE y del ECP calculados por el código desde el balance de prueba, o la nota de comparativo no presentado. Las cifras ya están en pesos: se copian carácter por carácter.

${lines.join('\n')}
</comparativos_efe_ecp>`;
}

/**
 * KPIs de la Parte II tal como deben imprimirse (pendiente #2 de la auditoría
 * integral 2026-09-24): un KPI sin ancla determinista viaja como "ND" con su
 * motivo y uno recomputable con el valor del preprocesador, aunque el JSON del
 * cliente sea anterior al cambio. El Editor Jefe nunca ve la cifra del modelo.
 */
function strategyForPrompt(input: HtmlEditorInput): HtmlEditorInput['strategyReport'] {
  let preprocessed = null;
  try {
    preprocessed = input.preprocessed ? revivePreprocessedBalance(input.preprocessed) : null;
  } catch {
    preprocessed = null;
  }
  return applyKpiAnchors(
    input.strategyReport,
    strategyAnchorSources(preprocessed ?? undefined, input.niifReport),
    { language: input.language, keepWhenNoSource: true },
  ).json;
}

export function buildHtmlEditorUserContent(input: HtmlEditorInput, hechosEmpresa?: string): string {
  // Las cifras del acta también viajan preformateadas (auditoría 2026-09,
  // pipeline-flujo-09): el validador las exige literalmente.
  const bindingFigures = buildBindingFiguresBlock([
    ...collectBindingFigures(input.niifReport),
    ...collectActaBindingFigures(input.governanceReport),
  ]);

  const comparativeStatements = buildComparativeStatementsBlock(input.niifReport);

  return `<task>Genera el HTML autocontenido v10.1 de 15 páginas A4 portrait según la plantilla maestra del system prompt (§13). Reemplaza los placeholders {{...}} con los valores del payload JSON. Estética: Berkshire Hathaway / Financial Times / Bloomberg Markets — austeridad como señal de autoridad.</task>

<context>
<metadata>
${JSON.stringify(input.metadata, null, 2)}
</metadata>

${bindingFigures}

${comparativeStatements}

<niif_report>
${JSON.stringify(input.niifReport, null, 2)}
</niif_report>

<strategy_report>
${JSON.stringify(strategyForPrompt(input), null, 2)}
</strategy_report>

<governance_report>
${JSON.stringify(input.governanceReport, null, 2)}
</governance_report>

<language>${input.language}</language>

${hechosEmpresa ?? ''}
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
- ALWAYS: las cifras del bloque <cifras_vinculantes> se COPIAN literalmente en los estados financieros. Ya vienen en pesos: no se convierten desde los centavos del JSON, no se redondean, no se abrevian.
- If una cifra del JSON no está en <cifras_vinculantes>, entonces conviértela dividiendo los centavos entre 100 y formatea $1.234.567,89; si además es una magnitud de contexto narrativo (no una línea de estado financiero), puedes abreviarla como $X.XXX M según §1.9/L38. If la magnitud llega a miles de millones then se escribe igual en millones ($2.429 M), otherwise $X,X M: la forma "$2,4 B" de §5 no se usa en español, porque un billón es un millón de millones (10^12).
- NEVER: invent values not present in the JSON payloads; only cite numbers from niif_report / strategy_report / governance_report / metadata.
- NEVER: calcular, redactar ni completar cifras comparativas del EFE o del ECP: sólo existen las del bloque <comparativos_efe_ecp> (el validador bloquea una cifra comparativa del EFE/ECP que no esté en el JSON).
- If <comparativos_efe_ecp> trae el EFE del periodo comparativo then el EFE se presenta a dos columnas (periodo actual | comparativo) con esas cifras, otherwise el EFE va a una sola columna y su nota se copia literal debajo del estado.
- If <comparativos_efe_ecp> trae filas del ECP del periodo comparativo then el ECP presenta primero esas filas y después las del periodo actual, otherwise el ECP presenta sólo el periodo actual y su nota se copia literal debajo del estado.
- Las devoluciones en ventas (cuenta 4175) se restan de los ingresos (ingresos netos = 41 − 4175) y su cifra se revela en su propia línea "(−) Devoluciones y descuentos en ventas": es un criterio de presentación de UtopIA. NEVER atribuirlo a una norma (NIIF 15 u otra) en el HTML.
- ALWAYS: cada nota en prosa tomada del JSON NIIF o de Gobierno (notas de los estados, notas técnicas, notas a los estados financieros del gobierno) lleva al inicio la leyenda visible "Narrativa generada por IA — no auditada" (misma leyenda que el PDF y el Excel).
- NEVER: imprimir una cifra para un KPI cuyo resultPrimary/resultComparative sea "ND": se presenta "N/D" con el motivo de su diagnosis. If un KPI trae "ND" then la tarjeta, la tabla y la prosa dicen N/D, otherwise se copia el valor del JSON.
- NEVER: citar montos en esas notas en prosa salvo las cifras de <cifras_vinculantes>. If una nota trae un monto que no está en <cifras_vinculantes> then remite al estado financiero correspondiente sin repetir la cifra, otherwise copia la cifra vinculante literal.
- NEVER: usar Plus Jakarta Sans, Geist, Helvetica, ni ninguna otra familia tipográfica fuera de Source Serif 4 / Inter / IBM Plex Mono.
- If unsure about a presentation decision not covered by the spec, default to §12 principio de incertidumbre y omite el dato con marca <!-- DECISION_REQUIRED -->.
</constraints>

<success_criteria>
- §11 checklist completo: 30 viñetas verificables al emitir.
- Cada cifra de <cifras_vinculantes> aparece LITERAL en el HTML (verificación determinística post-emisión: si falta una, el informe se estampa como BORRADOR).
- Hash declarado en portada + Página 14 coincide literal con metadata.reportHashSha256 (64 chars hex).
- reportMode declarado en HTML comments coincide con metadata.reportMode.
- Source Serif 4 + Inter + IBM Plex Mono cargados desde Google Fonts CDN único.
- CSS embebido en <style>, no externo.
- @page A4 portrait + @media print configurado para impresión vertical.
- Activo total = Pasivo total + Patrimonio total (tolerancia $0 centavos).
- Variación resultadoEjercicio en ECP == netIncomePrimary del P&L (tolerancia 0.5%).
- EFE: efectivo inicial = saldo PUC 11 real (NO total activos); NUNCA Cta.3605 como comodín (§5 Página 07).
- ROE consistente: KPIs, executiveDashboard, dupontAnalysis, trends, recommendations usan TODOS la fórmula única de controlTotals.roe.
- Tablas HTML reales (<table class="ft"> según §6/§13) en estados financieros — NUNCA sintaxis Markdown ni texto pipe-separated dentro del HTML.
- Ingresos netos de devoluciones con la cifra de la Cta. 4175 revelada en su propia línea del P&L (criterio de presentación de UtopIA, sin cita normativa).
- EFE y ECP del periodo comparativo = las cifras de <comparativos_efe_ecp>, o su nota literal cuando no se presentan.
- Criterios contables aplicados en UNA SOLA nota consolidada al final de Notas Parte 2 (Corrección 9 v2.1); el Art. 647 E.T. sólo se menciona respecto de declaraciones tributarias, sin afirmar que una diferencia de criterio "anula" la sanción.
- Numeración de notas secuencial 1..N sin saltos.
- Toda nota en prosa del JSON NIIF / Gobierno lleva la leyenda "Narrativa generada por IA — no auditada" y sólo cita montos que están en <cifras_vinculantes>.
- Cero adjetivos prohibidos §1.6 en el cuerpo.
- Cero metadatos internos del pipeline (§1.9).
- Tagline de portada coincide con el modo (§3): LINEA_BASE / TRANSICION / COMPARATIVO_COMPLETO.
- 15 páginas en orden estricto (§4).
- Logo 1+1 una sola vez (Página 14).
</success_criteria>`;
}

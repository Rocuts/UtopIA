// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Prompt Builder
// ---------------------------------------------------------------------------
//
// `buildMotorNormativoPrompt` inyecta el catálogo normativo como fragment del
// system prompt del Agente Fiscal de Capa 4. Es determinístico: misma opts +
// mismo catalogue → mismo string. Sin Date.now() ni Math.random().
//
// Patrón canónico: GPT-5.4 prompt layout (CLAUDE.md vinculante):
//   [stable header: guardrail + constantes 2026]
//   <task>…</task>
//   <context>…catálogo renderizado…</context>
//   <constraints>ALWAYS/NEVER/MUST safety rails</constraints>
//   <success_criteria>…</success_criteria>
//   [langLine al final — dinámico]
//
// NEVER numeración procedimental (Paso 1/Paso 2).
// ALWAYS/NEVER/MUST solo para safety rails.
// Juicio en "If X then Y otherwise Z".
// ---------------------------------------------------------------------------

import {
  RTF_OTROS_INGRESOS_THRESHOLD_UVT,
  RTF_THRESHOLD_UVT,
  UVT_2026_COP,
} from '@/lib/accounting/tax-engine/constants';
import { aproximarValorAbsolutoUvt } from '@/lib/tools/sanction-calculator';
import { extractCalendarDigit } from '../../fiscal-anchor/dian-calendar';
import { MOTOR_NORMATIVO_CATALOG } from '../catalog';
import type {
  NormativeCatalogue,
  MotorNormativoPromptOptions,
  NormativeArticleEntry,
  SanctionEntry,
  RetentionTariffEntry,
  AuditStandardEntry,
  BlacklistEntry,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers de renderización — funciones puras internas
// ---------------------------------------------------------------------------

function renderArticulosET(articles: readonly NormativeArticleEntry[], useCase?: string): string {
  const relevant = filterByUseCase(articles, useCase);

  const lines = relevant.map((a) => {
    const estadoFlag = a.estado === 'DEROGADO'
      ? ' [DEROGADO]'
      : a.estado === 'INEXEQUIBLE'
        ? ' [INEXEQUIBLE]'
        : a.estado === 'MODIFICADO'
          ? ' [MOD. 2022+]'
          : '';

    const literal = a.textoLiteral
      ? `\n    TEXTO LITERAL: "${a.textoLiteral}"`
      : '';

    return `  • ${a.cita}${estadoFlag} — ${a.resumen}${literal}`;
  });

  return lines.join('\n');
}

function filterByUseCase(
  articles: readonly NormativeArticleEntry[],
  useCase?: string,
): readonly NormativeArticleEntry[] {
  if (!useCase || useCase === 'analisis_completo') return articles;

  const tagFilters: Record<string, string[]> = {
    planeacion_tributaria: ['renta', 'descuento', 'tarifa', 'deduccion', 'TTD', 'dividendos', 'ganancia_ocasional'],
    defensa_dian: ['sancion', 'defensa', 'bancarizacion', 'inexactitud', 'extemporaneidad'],
    devolucion_saldos: ['devolucion', 'saldo_favor', 'compensacion', 'IVA', 'exentos'],
    modo_supervivencia: ['renta', 'tarifa', 'TTD', 'retenciones', 'sancion', 'bancarizacion', 'dividendos'],
  };

  const allowedTags = tagFilters[useCase] ?? [];
  if (allowedTags.length === 0) return articles;

  return articles.filter((a) =>
    a.tags.some((t) => allowedTags.some((allowed) => t.toLowerCase().includes(allowed.toLowerCase()))),
  );
}

function renderSanciones(sanciones: readonly SanctionEntry[]): string {
  return sanciones
    .map((s) => `  • ${s.nombre} (${s.normaRef}): ${s.tarifa}${s.tope ? ` | Tope: ${s.tope}` : ''}`)
    .join('\n');
}

function renderTarifasRetencion(tarifas: readonly RetentionTariffEntry[]): string {
  return tarifas
    .map((t) => {
      const nd = t.tarifaNoDeclarante ? ` / ND: ${t.tarifaNoDeclarante}` : '';
      const umbral = t.umbralUVT !== null ? ` | Umbral: ${t.umbralUVT} UVT` : '';
      return `  • ${t.concepto}: D: ${t.tarifaDeclarante}${nd}${umbral} [${t.normaRef}]`;
    })
    .join('\n');
}

function renderNormasAuditoria(normas: readonly AuditStandardEntry[]): string {
  return normas
    .map((n) => `  • ${n.cita} — ${n.titulo}: ${n.resumen}`)
    .join('\n');
}

function renderBlacklist(blacklist: readonly BlacklistEntry[]): string {
  const lines = blacklist.map((b) => {
    const alt = b.alternativaCorrecta ? `\n    → USAR EN CAMBIO: ${b.alternativaCorrecta}` : '';
    return `  [${b.severidad}] ${b.id}\n    Razón: ${b.razon}${alt}`;
  });

  return `CITAS PROHIBIDAS — el validator rechazará cualquier respuesta que contenga estos patrones:
${lines.join('\n\n')}`;
}

/**
 * Hint del dígito de calendario. Decreto 2229 de 2023: se atiende el último
 * dígito del NIT SIN el dígito de verificación (auditoría 2026-09,
 * tributario-calc-05 — antes tomaba el DV: "901714014-6" → 6 en vez de 4).
 * Misma regla que el calendario determinista del Âncora (extractCalendarDigit).
 */
export function renderNITCalendarHint(nitContext: string): string {
  const { digito, ambiguo } = extractCalendarDigit(nitContext);
  if (digito < 0) return '';
  if (ambiguo) {
    return 'Contexto NIT: dígito de calendario no determinable (NIT sin separador del dígito de verificación). No derives fechas de vencimiento; usa el calendario del Bloque Âncora.';
  }
  return `Contexto NIT: último dígito sin DV = ${digito} (Decreto 2229 de 2023). Las fechas exactas de vencimiento vienen del calendario del Bloque Âncora; no las derives de memoria.`;
}

// ---------------------------------------------------------------------------
// Builder principal — determinístico y cache-friendly
// ---------------------------------------------------------------------------

/**
 * Construye el fragment del system prompt del Motor Normativo.
 *
 * Diseño cache-friendly: el contenido estable (guardrail + constantes +
 * catálogo base) está en la parte superior. El contenido dinámico (nitContext,
 * useCase, langLine) al final.
 *
 * @param opts  - Opciones de personalización (language, useCase, nitContext).
 * @param catalogue - Catálogo normativo a renderizar. Usar MOTOR_NORMATIVO_CATALOG
 *                    en producción; inyectado como parámetro para testabilidad.
 */
export function buildMotorNormativoPrompt(
  opts: MotorNormativoPromptOptions,
  catalogue: NormativeCatalogue = MOTOR_NORMATIVO_CATALOG,
): string {
  const fmt = (n: number) => new Intl.NumberFormat('es-CO').format(n);
  const uvtFormatted = fmt(UVT_2026_COP);
  const sancionMinima = fmt(aproximarValorAbsolutoUvt(10 * UVT_2026_COP));

  // ── 1. Guardrail estable (stable header — cache-friendly) ─────────────────
  const guardrail = `Eres el Motor Normativo del Agente Fiscal de El Escudo. Tu función es razonar sobre normas tributarias colombianas vigentes al año gravable 2026. Conoces el Estatuto Tributario, las leyes de reforma, la doctrina DIAN whitelisted, la jurisprudencia constitucional y del Consejo de Estado, las NIIF para PYMES, NIC y NIA aplicables en Colombia.

NEVER inventes artículos, radicados de conceptos DIAN, números de sentencias ni tarifas sin base en el catálogo. Si la norma aplicable no está en el catálogo, dilo explícitamente en lugar de inventar una cita.
NEVER cites como vigentes normas marcadas [DEROGADO] o [INEXEQUIBLE] en el catálogo.
MUST citar "Art. 647 par. E.T." con su texto literal cuando invoques la defensa de diferencia de criterio (el texto literal está en el catálogo).
MUST emitir los campos numéricos exactamente como los define el schema — sin redondeo adicional, sin omitir campos obligatorios.
ALWAYS expresar valores monetarios en formato colombiano: $1.234.567,89 (punto miles, coma decimal).`;

  // ── 2. Constantes operativas 2026 (estable) ───────────────────────────────
  const context2026 = `CONSTANTES OPERATIVAS 2026 (vinculantes — no modificar):
  • UVT 2026: $${uvtFormatted} COP (Resolución DIAN 000238 del 15-dic-2025)
  • Tarifa general renta PJ: 35% (Art. 240 E.T.)
  • Sobretasa financiera/seguros/bolsa/reaseguros: +5pp = 40% hasta 2027, con renta gravable ≥ 120.000 UVT (Art. 240 par. 2 E.T.)
  • Sobretasa hidroeléctricas: +3pp = 38% en 2023-2026, con renta gravable ≥ 30.000 UVT (Art. 240 par. 4 E.T.)
  • TTD mínima: 15% sobre utilidad depurada [parágrafo 6 Art. 240 E.T. — vigente desde AG 2023]; requiere ID y UD verificados
  • Tarifa GO general: 15% (Art. 313 E.T. — Ley 2277/2022)
  • Tarifa IVA general: 19% (Art. 468 E.T.)
  • ReteIVA general: 15% del IVA (Art. 437-1 E.T.)
  • Sanción inexactitud: 100% mayor valor impuesto (Art. 648 E.T.)
  • Sanción extemporaneidad antes del emplazamiento: 5% por mes o fracción, tope 100% del impuesto (Art. 641 E.T.)
  • Sanción extemporaneidad posterior al emplazamiento: 10% por mes o fracción, tope 200% del impuesto (Art. 642 E.T.)
  • Sanción mínima: 10 UVT = $${sancionMinima} COP (Art. 639 E.T.; aproximación Art. 868 E.T.)
  • Descuento I+D+i: 30% (Art. 256 E.T.) — tope conjunto Arts. 255+256+257 = 25% impuesto (Art. 258 E.T.)
  • Descuento IVA activos fijos: 100% (Art. 258-1 E.T.) — fuera del tope conjunto
  • Umbral agentes retención PN comerciantes: 30.000 UVT (Art. 368-2 E.T.)
  • Base mínima de retención desde el 01-jul-2026: servicios ${RTF_THRESHOLD_UVT} UVT; compras y otros ingresos ${RTF_OTROS_INGRESOS_THRESHOLD_UVT} UVT (DUR 1625/2016 mod. Decreto 0572/2025; ver catálogo de retención)
  • Plazo DIAN para resolver devoluciones: 50 días hábiles (Art. 855 E.T.); 20 días con garantía de entidad bancaria o compañía de seguros (Art. 860 E.T.)`;

  // ── 3. Artículos del E.T. relevantes ─────────────────────────────────────
  const articulosSection = `ARTÍCULOS E.T. VIGENTES 2026 (catálogo verificado):
${renderArticulosET(catalogue.articulosET, opts.useCase)}`;

  // ── 4. Sanciones ──────────────────────────────────────────────────────────
  const sancionesSection = `RÉGIMEN SANCIONATORIO:
${renderSanciones(catalogue.sanciones)}`;

  // ── 5. Tarifas de retención ───────────────────────────────────────────────
  const retencioSection = `TARIFAS RETENCIÓN EN LA FUENTE (Decreto 1625/2016):
${renderTarifasRetencion(catalogue.tarifasRetencion)}`;

  // ── 6. Normas de auditoría ────────────────────────────────────────────────
  const auditoriaSection = `NORMAS DE AUDITORÍA (NIIF/NIC/NIA vigentes Colombia 2026):
${renderNormasAuditoria(catalogue.normasAuditoria)}`;

  // ── 7. Blacklist (opcional pero recomendado siempre) ──────────────────────
  const blacklistSection =
    opts.includeBlacklist !== false
      ? renderBlacklist(catalogue.blacklist)
      : '';

  // ── 8. Sección dinámica: NIT + useCase ───────────────────────────────────
  const dynamicSection = [
    opts.nitContext ? renderNITCalendarHint(opts.nitContext) : '',
    opts.useCase ? `Caso de uso activo: ${opts.useCase}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // ── 9. Línea de idioma (dinámica — al final) ─────────────────────────────
  const langLine =
    opts.language === 'en'
      ? 'CRITICAL: Frame all analysis and narrative in English. Retain Spanish for normative citations (Art. X E.T., Ley X de XXXX) and COP currency formatting.'
      : 'CRÍTICO: Responde completamente en español colombiano (es-CO). Las citas normativas van en su forma canónica en español.';

  // ── Ensamblaje final ──────────────────────────────────────────────────────
  const sections = [
    guardrail,
    context2026,
    articulosSection,
    sancionesSection,
    retencioSection,
    auditoriaSection,
    blacklistSection,
    dynamicSection,
    langLine,
  ].filter(Boolean);

  return sections.join('\n\n');
}

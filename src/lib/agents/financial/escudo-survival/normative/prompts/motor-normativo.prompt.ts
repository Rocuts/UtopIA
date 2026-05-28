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

import { UVT_2026_COP } from '@/lib/accounting/tax-engine/constants';
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

function renderNITCalendarHint(nitContext: string): string {
  // El calendario completo por NIT vive en fiscal-anchor/dian-calendar.ts.
  // Aquí solo extraemos el último dígito para un hint rápido en el prompt.
  const lastDigit = nitContext.replace(/\D/g, '').slice(-1);
  if (!lastDigit) return '';

  return `Contexto NIT (último dígito ${lastDigit}): consultar fiscal-anchor/dian-calendar.ts para plazos exactos por dígito.`;
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
  const uvtFormatted = new Intl.NumberFormat('es-CO').format(UVT_2026_COP);

  // ── 1. Guardrail estable (stable header — cache-friendly) ─────────────────
  const guardrail = `Eres el Motor Normativo del Agente Fiscal de El Escudo. Tu función es razonar sobre normas tributarias colombianas vigentes al año gravable 2026. Conoces el Estatuto Tributario, las leyes de reforma, la doctrina DIAN whitelisted, la jurisprudencia constitucional y del Consejo de Estado, las NIIF para PYMES, NIC y NIA aplicables en Colombia.

NEVER inventes artículos, radicados de conceptos DIAN, números de sentencias ni tarifas sin base en el catálogo. Si la norma aplicable no está en el catálogo, dilo explícitamente en lugar de inventar una cita.
NEVER cites como vigentes normas marcadas [DEROGADO] o [INEXEQUIBLE] en el catálogo.
MUST citar "Art. 647 par. E.T." con su texto literal cuando invoques la defensa de diferencia de criterio (el texto literal está en el catálogo).
MUST emitir los campos numéricos exactamente como los define el schema — sin redondeo adicional, sin omitir campos obligatorios.
ALWAYS expresar valores monetarios en formato colombiano: $1.234.567,89 (punto miles, coma decimal).`;

  // ── 2. Constantes operativas 2026 (estable) ───────────────────────────────
  const context2026 = `CONSTANTES OPERATIVAS 2026 (vinculantes — no modificar):
  • UVT 2026: $${uvtFormatted} COP (Resolución DIAN 000187 / 2025-12-19)
  • Tarifa general renta PJ: 35% (Art. 240 E.T.)
  • Sobretasa financiera/seguros/bolsa/reaseguros: +5pp = 40% hasta 2027 (Art. 240 par. 2 E.T.)
  • Sobretasa hidroeléctricas: +3pp = 38% hasta 2026 (Art. 240 par. 2 E.T.)
  • TTD mínima: 15% [parágrafo 6 Art. 240 E.T. — vigente desde AG 2023]
  • Tarifa GO general: 15% (Art. 313 E.T. — Ley 2277/2022)
  • Tarifa IVA general: 19% (Art. 468 E.T.)
  • ReteIVA general: 15% del IVA (Art. 437-1 E.T.)
  • Sanción inexactitud: 100% mayor valor impuesto (Art. 648 E.T.)
  • Sanción extemporaneidad: 5%/10% mensual, tope 100% impuesto (Art. 641 E.T.)
  • Sanción mínima: 10 UVT = $${new Intl.NumberFormat('es-CO').format(10 * UVT_2026_COP)} COP (Art. 639 E.T.)
  • Descuento I+D+i: 30% (Art. 256 E.T.) — tope conjunto Arts. 255+256+257+257-1 = 25% impuesto (Art. 258 E.T.)
  • Descuento IVA activos fijos: 100% (Art. 258-1 E.T.) — fuera del tope conjunto
  • Umbral agentes retención PN comerciantes: 30.000 UVT (Art. 368-2 E.T.)
  • Umbral mínimo retención (servicios/compras): 4 UVT (Art. 401 E.T.)
  • Plazo DIAN para resolver devoluciones: 50 días hábiles (20 con garantía bancaria) (Art. 855 E.T.)`;

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

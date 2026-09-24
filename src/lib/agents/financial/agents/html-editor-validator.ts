// ---------------------------------------------------------------------------
// Validador profundo §11 spec v10.1 — checks con linkedom DOM parser
// ---------------------------------------------------------------------------
//
// Amplía el linter ligero de `agents/html-editor.ts:lightweightChecklist`
// (que cubre §10 comments + §1.6 vocabulary + §1.9 metadatos internos +
// §6 paleta sin oro) hacia el checklist completo §11. Usa linkedom para
// parsear el HTML como DOM real, permitiendo queries por selector, conteo de
// celdas y validación estructural.
//
// Severidades:
//   'block' — el HTML NO debe servirse. El agente debe regenerar la sección.
//   'warn'  — el HTML es servible pero tiene un issue cosmético o parcialmente
//             no-chequeables programáticamente (contraste, verbos contextuales,
//             ortografía sutil). Se anota para revisión editorial.
//
// NOTA sobre checks best-effort:
//   Algunos items del §11 son inherentemente subjetivos o requieren browser
//   real (WCAG color contrast, verbos semánticos por modo, ortografía fina).
//   Estos se implementan como heurísticas documentadas con severity='warn'.
//
// Refs:
//   - docs/spec/financial-report-v10.1.md §11 (checklist completo)
//   - docs/spec/financial-report-v10.1.md §1.6 (vocabulario prohibido)
//   - docs/spec/financial-report-v10.1.md §1.9 (sin metadatos internos)
//   - docs/spec/financial-report-v10.1.md §3 (narrativa por modo)
//   - docs/spec/financial-report-v10.1.md §4 (15 páginas A4 portrait)
//   - docs/spec/financial-report-v10.1.md §6 (paleta sin oro)
//   - docs/spec/financial-report-v10.1.md §7 (Source Serif 4 + Inter + Mono)
// ---------------------------------------------------------------------------

import { parseHTML } from 'linkedom';
import {
  collectBindingFigures,
  collectActaBindingFigures,
  type BindingFigure,
  type HtmlEditorMetadata,
} from '../contracts/html-editor';
import type { NiifReportJson } from '../contracts/niif-report';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import {
  buildNarrativeConcepts,
  checkNarrativeUnits,
  checkRoeUnits,
  findForeignCutoffYears,
  narrativeSourcesFromPreprocessed,
  type NarrativeCheckOptions,
  type NarrativeUnit,
} from '../validators/narrative-anchors';
import {
  applyKpiAnchors,
  discardedFigureHits,
  discardedKpiFigures,
  kpiMentionWindow,
  kpiNamePattern,
  strategyAnchorSources,
  type DiscardedKpiFigure,
} from '../validators/strategy-anchors';
import { StrategyReportSchema } from '../contracts/strategy-report';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

type ParsedDocument = ReturnType<typeof parseHTML>['document'];

export interface ChecklistFailure {
  rule: string;
  detail: string;
  severity: 'block' | 'warn';
}

/**
 * Validador profundo §11 spec v10.1.
 *
 * @param html     - HTML completo emitido por el agente Editor Jefe.
 * @param metadata - HtmlEditorMetadata pre-cocinada (echo del orchestrator).
 * @returns        Array de ChecklistFailure. Vacío si todo pasó.
 */
export function validateHtmlChecklist(
  html: string,
  metadata: HtmlEditorMetadata,
): ChecklistFailure[] {
  const failures: ChecklistFailure[] = [];
  const { document } = parseHTML(html);
  const htmlLower = html.toLowerCase();

  // ── Check 1 · §10 mandatory HTML comments ─────────────────────────────────
  //
  // REPORT_MODE / ENTITY / AGENT_VERSION son obligatorios. Severity: block —
  // sin estas declaraciones el consumer no puede rutear el renderizado por
  // modo ni verificar la versión del agente.
  if (!html.includes(`REPORT_MODE: ${metadata.reportMode}`)) {
    failures.push({
      rule: '§10 · Check 1 — REPORT_MODE comment',
      detail: `Falta comentario <!-- REPORT_MODE: ${metadata.reportMode} --> en el HTML`,
      severity: 'block',
    });
  }

  if (!html.includes(`ENTITY: ${metadata.entityNit}`)) {
    failures.push({
      rule: '§10 · Check 1 — ENTITY comment',
      detail: `Falta comentario <!-- ENTITY: ${metadata.entityNit} --> en el HTML`,
      severity: 'block',
    });
  }

  if (!html.includes('AGENT_VERSION: 1+1 v10.1')) {
    failures.push({
      rule: '§10 · Check 1 — AGENT_VERSION comment',
      detail: 'Falta comentario <!-- AGENT_VERSION: 1+1 v10.1 --> en el HTML',
      severity: 'block',
    });
  }

  // ── Check 2 · §3 Verbos del cuerpo coinciden con modo ─────────────────────
  //
  // best-effort: detectar verbos prohibidos en modo LINEA_BASE (verbos
  // comparativos sin referencia previa son falsos sin período anterior).
  // La lista proviene de §3 tabla "Verbos PROHIBIDOS" para LINEA_BASE.
  // Severity: warn — la semántica fina requiere revisión editorial humana.
  if (metadata.reportMode === 'LINEA_BASE') {
    // Espeja la tabla §3 verbatim ("evolucionó", no el sustantivo "evolución"
    // — el sustantivo es legítimo en frases prospectivas como "evolución
    // esperada del siguiente cierre").
    const prohibitedVerbsLinea = [
      /\bmejoró\b/i,
      /\bcreció\b/i,
      /\baumentó\b/i,
      /\bse redujo\b/i,
      /\bevolucionó\b/i,
      /\bvarió respecto a\b/i,
    ];
    for (const pattern of prohibitedVerbsLinea) {
      if (pattern.test(html)) {
        failures.push({
          rule: '§3 · Check 2 — verbos prohibidos LINEA_BASE',
          detail: `Modo LINEA_BASE: verbo comparativo detectado ("${pattern.source}") — requiere referencia previa que no existe`,
          severity: 'warn',
        });
        break;
      }
    }
  }

  // ── Check 3 · §3 Tagline de portada coincide con modo ─────────────────────
  //
  // best-effort: verificar que el tagline canónico por modo esté presente.
  // En v10.1 el tagline va en la portada en serif italic 12pt.
  // Severity: warn — la frase exacta puede ser adaptada a la entidad.
  const taglinesByMode: Record<string, string[]> = {
    LINEA_BASE: ['línea base', 'primer cierre', 'punto cero'],
    TRANSICION: ['transición', 'comparabilidad parcial', 'donde es comparable'],
    COMPARATIVO_COMPLETO: ['el año en una frase', 'ejercicio en perspectiva'],
  };
  const expectedTaglines = taglinesByMode[metadata.reportMode] ?? [];
  const hasTagline = expectedTaglines.some((phrase) =>
    htmlLower.includes(phrase.toLowerCase()),
  );
  if (expectedTaglines.length > 0 && !hasTagline) {
    failures.push({
      rule: '§3 · Check 3 — tagline portada coincide con modo',
      detail: `Modo ${metadata.reportMode}: ningún tagline canónico detectado. Esperados: ${expectedTaglines.join(' | ')}`,
      severity: 'warn',
    });
  }

  // ── Check 4 · §3 Resumen ejecutivo titulado según modo ────────────────────
  //
  // El resumen ejecutivo de Página 03 lleva un título que depende del modo.
  // LINEA_BASE: "El ejercicio YYYY en cifras" o "Composición del Período".
  // TRANSICION: "Lo comparable y lo nuevo del período".
  // COMPARATIVO_COMPLETO: "Movimientos del año".
  // Informes en inglés (fase 2, F-html): el Editor Jefe traduce los títulos;
  // sin sus equivalentes, un HTML honesto en inglés quedaba BORRADOR.
  const titlesByMode: Record<string, string[]> = {
    LINEA_BASE: [
      'el ejercicio',
      'composición del período',
      'composicion del periodo',
      'fiscal year in figures',
      'the year in figures',
      'composition of the period',
    ],
    TRANSICION: [
      'lo comparable y lo nuevo',
      'lo comparable y lo establecido',
      'what is comparable and what is new',
      'comparable and new',
    ],
    COMPARATIVO_COMPLETO: [
      'movimientos del año',
      'movimientos del ano',
      'tres movimientos clave',
      'movements of the year',
      'key movements',
    ],
  };
  const expectedTitles = titlesByMode[metadata.reportMode] ?? [];
  const hasModeTitle = expectedTitles.some((t) => htmlLower.includes(t.toLowerCase()));
  if (expectedTitles.length > 0 && !hasModeTitle) {
    failures.push({
      rule: '§3 · Check 4 — título resumen ejecutivo',
      detail: `Modo ${metadata.reportMode}: título del resumen ejecutivo no coincide. Esperados: ${expectedTitles.join(' | ')}`,
      severity: 'block',
    });
  }

  // ── Check 5 · §3 Layout EEFF coincide con modo ────────────────────────────
  //
  // COMPARATIVO_COMPLETO → debe tener columna Δ% en algún encabezado de tabla
  // LINEA_BASE → typically NO trae columna comparativa (sólo 2025); el
  //              caption suele decir "Sin período comparativo".
  // Severity: warn — depende de cómo renderizó el agente.
  if (metadata.reportMode === 'COMPARATIVO_COMPLETO') {
    const hasDelta =
      html.includes('Δ%') || html.includes('Δ %') || htmlLower.includes('variación');
    if (!hasDelta) {
      failures.push({
        rule: '§3 · Check 5 — layout EEFF modo COMPARATIVO_COMPLETO',
        detail: 'Modo COMPARATIVO_COMPLETO: columna Δ% no detectada en estados financieros',
        severity: 'warn',
      });
    }
  }

  if (metadata.reportMode === 'LINEA_BASE') {
    const hasNoComparativeNotice =
      htmlLower.includes('sin período comparativo') ||
      htmlLower.includes('sin periodo comparativo') ||
      htmlLower.includes('primer cierre');
    if (!hasNoComparativeNotice) {
      failures.push({
        rule: '§3 · Check 5 — LINEA_BASE sin aviso de período comparativo',
        detail: 'Modo LINEA_BASE: aviso "Sin período comparativo" no detectado en estados financieros',
        severity: 'warn',
      });
    }
  }

  // ── Check 6 · §1.2 Cero $0 huérfanos sin nota ────────────────────────────
  //
  // Busca el patrón "$0" o "$0,00" sin nota referencial. best-effort: regex
  // + contexto de fila; no detecta todos los casos de layout.
  // Severity: block — §1.2 es regla inviolable del spec.
  //
  // Why contexto de fila y no solo lookahead: la spec §5 (P07/P08) MANDA
  // renderizar ceros materiales en `var(--muted)` / italic con marcador
  // `<sup class="n">†</sup>` que suele preceder a la cifra en la misma fila
  // (la plantilla canónica §13 lo hace 19 veces). El lookahead-solo-después
  // marcaba como huérfano todo $0 correctamente anotado → falso BLOCK en
  // reportes visualmente correctos.
  const orphanZeroPattern = /\$0(?:[,.]00)?\b(?!\s*(?:\[i\]|<sup|footnote|nota|note))/gi;
  let orphanZeroCount = 0;
  let ozMatch: RegExpExecArray | null;
  while ((ozMatch = orphanZeroPattern.exec(html)) !== null) {
    // §1.2 aplica a líneas de DATOS (celdas de tabla). Un "$0" en prosa
    // narrativa ES la nota explicativa ("El capital social de $0 requiere
    // documentación formal…") — no un cero huérfano.
    const lastTdOpen = html.lastIndexOf('<td', ozMatch.index);
    const lastTdClose = html.lastIndexOf('</td>', ozMatch.index);
    const insideCell = lastTdOpen !== -1 && lastTdOpen > lastTdClose;
    if (!insideCell) continue;
    // Contexto: desde el inicio de la fila contenedora hasta el match.
    const rowStart = Math.max(html.lastIndexOf('<tr', ozMatch.index), lastTdOpen, 0);
    const context = html.slice(rowStart, ozMatch.index + ozMatch[0].length);
    const isNoted = /var\(--muted\)|<sup class="n">|font-style:\s*italic|†/i.test(context);
    if (!isNoted) orphanZeroCount++;
  }
  if (orphanZeroCount > 0) {
    failures.push({
      rule: '§1.2 · Check 6 — $0 huérfanos sin nota',
      detail: `${orphanZeroCount} ocurrencia(s) de "$0" sin nota referencial detectadas`,
      severity: 'block',
    });
  }

  // ── Check 7 · §1.1 Toda suma cuadra aritméticamente ──────────────────────
  //
  // Suma VERTICAL por columna. Ver `checkColumnArithmetic` para el porqué del
  // cambio respecto a la versión horizontal (que era un no-op en el layout
  // real de los estados financieros).
  failures.push(...checkColumnArithmetic(document));

  // ── Check 8 · §1.3 Ratios fuera de banda con △ ──────────────────────────
  //
  // Si hay alguna sección de ratios, debería existir al menos un marcador △
  // para outliers (la spec exige flagging explícito). best-effort.
  const hasRatioSection =
    htmlLower.includes('razón corriente') ||
    htmlLower.includes('margen') ||
    htmlLower.includes('ebitda') ||
    htmlLower.includes('endeudamiento');
  const hasAnomalyFlag =
    html.includes('△') ||
    htmlLower.includes('anomalía') ||
    htmlLower.includes('anomalia');
  if (hasRatioSection && !hasAnomalyFlag) {
    failures.push({
      rule: '§1.3 · Check 8 — △ Anomalía para ratios fuera de banda',
      detail: 'Ratios detectados pero ningún flag △ presente. Si hay outliers sectoriales, deben marcarse.',
      severity: 'warn',
    });
  }

  // ── Check 9 · §1.5 Confianza dot/texto en cifras medium/low ───────────────
  //
  // v10.1 usa texto adyacente "Confianza media · conciliar" en lugar de
  // dots CSS (.conf.medium / .conf.low) de v8.1. best-effort: buscar palabras
  // "confianza" / "conciliar" / sub.n para marcadores †.
  const hasKpiSection =
    htmlLower.includes('indicador') ||
    htmlLower.includes('kpi') ||
    htmlLower.includes('razón') ||
    htmlLower.includes('utilidad neta');
  const hasConfMarker =
    htmlLower.includes('confianza') ||
    htmlLower.includes('conciliar') ||
    html.includes('<sup class="n">†</sup>') ||
    html.includes('<sup class="n">');
  if (hasKpiSection && !hasConfMarker) {
    failures.push({
      rule: '§1.5 · Check 9 — confianza dot/texto en cifras medium/low',
      detail: 'Sección de KPIs detectada pero ningún marcador de confianza presente',
      severity: 'warn',
    });
  }

  // ── Check 10 · §5 Página 07 — EFE: cashOpening ≠ total activos ────────────
  //
  // Severity: block — §5 Página 07 explicita que el efectivo inicial del EFE
  // debe ser el saldo efectivo real (PUC 11), NO el total de activos.
  const efeOpeningMatch = html.match(
    /(?:efectivo al inicio|cash opening|saldo inicial de efectivo|efectivo inicial)[^\n]{0,80}?(\$[\d.,]+)/i,
  );
  const totalActivosMatch = html.match(
    /(?:total activo|total activos|total assets)[^\n]{0,80}?(\$[\d.,]+)/i,
  );
  if (efeOpeningMatch && totalActivosMatch) {
    const efeVal = efeOpeningMatch[1];
    const activosVal = totalActivosMatch[1];
    if (efeVal === activosVal) {
      failures.push({
        rule: '§5 P07 · Check 10 — EFE cashOpening ≠ total activos',
        detail: `EFE saldo inicial (${efeVal}) coincide con Total Activos — posible error: debe ser saldo de efectivo (PUC 11), no total activos`,
        severity: 'block',
      });
    }
  }

  // ── Check 11 · §11 Sección "Limitaciones de Información" ──────────────────
  //
  // Severity: block — §11 lo lista como requisito explícito en LINEA_BASE /
  // TRANSICION. Sin esta sección el lector no puede evaluar el alcance.
  if (
    metadata.reportMode === 'LINEA_BASE' ||
    metadata.reportMode === 'TRANSICION'
  ) {
    const hasLimitaciones =
      htmlLower.includes('limitaciones de información') ||
      htmlLower.includes('limitaciones de informacion') ||
      htmlLower.includes('information limitations');
    if (!hasLimitaciones) {
      failures.push({
        rule: '§11 · Check 11 — sección Limitaciones de Información',
        detail: `Modo ${metadata.reportMode}: sección "Limitaciones de Información" ausente`,
        severity: 'block',
      });
    }
  }

  // ── Check 12 · §1.8 Bloque "Cómo se construyó este informe" Página 14 ─────
  //
  // Severity: block — §1.8 "Transparencia sobre la generación" es regla
  // inviolable. El bloque debe existir en la Página 14 (cierre + trazabilidad).
  const hasHowBuilt =
    htmlLower.includes('cómo se construyó este informe') ||
    htmlLower.includes('como se construyo este informe') ||
    htmlLower.includes('cómo se construyó este reporte') ||
    htmlLower.includes('como se construyo este reporte') ||
    htmlLower.includes('how this report was built');
  if (!hasHowBuilt) {
    failures.push({
      rule: '§1.8 · Check 12 — bloque "Cómo se construyó este informe"',
      detail: 'Bloque de transparencia "Cómo se construyó este informe" ausente en Página 14',
      severity: 'block',
    });
  }

  // ── Check 13 · §11 Hash SHA-256 en HTML output ────────────────────────────
  //
  // Severity: block — §11 exige hash verificable que coincida con la metadata.
  if (!html.includes(metadata.reportHashSha256)) {
    failures.push({
      rule: '§11 · Check 13 — hash SHA-256 en bloque transparencia',
      detail: `Hash SHA-256 "${metadata.reportHashSha256}" no encontrado en HTML output`,
      severity: 'block',
    });
  }

  // ── Check 14 · §11 Disclaimer positivo en Página 14 ───────────────────────
  //
  // best-effort: verificar que NO use lenguaje negativo genérico ("este
  // informe no garantiza", "sin responsabilidad").
  const hasNegativeDisclaimer =
    /este (?:reporte|informe|documento) no garantiza/i.test(html) ||
    /sin responsabilidad/i.test(html) ||
    /exención de responsabilidad/i.test(html);
  if (hasNegativeDisclaimer) {
    failures.push({
      rule: '§11 · Check 14 — disclaimer positivo',
      detail: 'Disclaimer con formulación negativa detectado. La spec exige versión positiva.',
      severity: 'warn',
    });
  }

  // ── Check 15 · §1.6 Cero adjetivos prohibidos en cuerpo ──────────────────
  //
  // Severity: block — §1.6 es regla inviolable. La lista está en la spec
  // verbatim; la espejamos para que el validador sea self-contained.
  //
  // Why lookahead en lugar de \b para É/Ú/Ó:
  //   `\b` en JavaScript solo reconoce [a-zA-Z0-9_] como word chars. Los
  //   caracteres con tilde (É, Ú, Ó) no son \w, por lo que `\bÉlite\b` no
  //   funciona si É va precedida de espacio. Se usa lookbehind/lookahead
  //   negativos Unicode para detectar inicio/fin de palabra con cobertura
  //   de tildes.
  //
  // Why "Único"/"Mejor" solo capitalizados: la spec §1.6 prohíbe adjetivos
  // de MARKETING. En prosa técnica española "único"/"mejor" minúsculas son
  // legítimos ("dato único defensible" — spec §5 P07; "mejor estimación" —
  // NIIF Pymes Sec. 21). El case-insensitive bloqueaba reportes que siguen
  // la plantilla canónica §13 al pie de la letra.
  //
  // Why se escanea sin <style>/<script>/comments: los comentarios CSS de la
  // plantilla §13 ("azul prusia — acento único") no son texto visible.
  const visibleHtml = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const forbiddenWords: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])[EÉeé]lite(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Élite' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])excelencia(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Excelencia' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])premium(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Premium' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])excepcional(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Excepcional' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])[UÚ]nico(?![a-zA-ZÀ-ÖØ-öø-ÿ])/, label: 'Único' },
    { pattern: /\bMejor\b/, label: 'Mejor' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])[SsÓóOo]lido(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Sólido' },
    { pattern: /\brobusto\b/i, label: 'Robusto' },
    { pattern: /\bextraordinario\b/i, label: 'Extraordinario' },
  ];
  for (const { pattern, label } of forbiddenWords) {
    const match = visibleHtml.match(pattern);
    if (match) {
      failures.push({
        rule: '§1.6 · Check 15 — vocabulario prohibido',
        detail: `Palabra prohibida detectada: "${match[0]}" (${label})`,
        severity: 'block',
      });
    }
  }

  // ── Check 16 · §6 Paleta v10.1 — NO oro ───────────────────────────────────
  //
  // Severity: block — la spec v10.1 reemplaza la paleta oro de v8.1 por azul
  // prusia (#1E3A5F) como acento único. Tokens --gold / hex oro están
  // prohibidos. Espejamos el patrón del linter ligero para que el validador
  // profundo sea exhaustivo e independiente.
  const htmlSinComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const forbiddenGoldPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /--gold(?:-[dl])?\b/, label: 'CSS token --gold/--gold-d/--gold-l' },
    { pattern: /#C49A2E\b/i, label: 'hex #C49A2E (oro v8.1)' },
    { pattern: /#9A7418\b/i, label: 'hex #9A7418 (oro oscuro v8.1)' },
    { pattern: /#DDB94A\b/i, label: 'hex #DDB94A (oro claro v8.1)' },
  ];
  for (const { pattern, label } of forbiddenGoldPatterns) {
    const match = htmlSinComments.match(pattern);
    if (match) {
      failures.push({
        rule: '§6 · Check 16 — paleta sin oro (v10.1)',
        detail: `Color/token oro detectado: "${match[0]}" (${label}). Acento único v10.1 = #1E3A5F.`,
        severity: 'block',
      });
    }
  }

  // ── Check 17 · §7 Tipografía — Source Serif 4 + Inter + IBM Plex Mono ─────
  //
  // Severity: warn — la spec v10.1 declara que la familia tipográfica es
  // Source Serif 4 + Inter + IBM Plex Mono. Si el HTML no carga al menos
  // Source Serif 4 + Inter desde Google Fonts, el rendering será incorrecto.
  // No es block porque algunos clientes pueden tener override de fuentes.
  const hasSourceSerif = html.includes('Source+Serif+4') || html.includes('Source Serif 4');
  const hasInter = html.includes('family=Inter') || html.includes("'Inter'") || html.includes('"Inter"');
  if (!hasSourceSerif || !hasInter) {
    failures.push({
      rule: '§7 · Check 17 — tipografía v10.1 (Source Serif 4 + Inter)',
      detail: `Faltan familias tipográficas v10.1: ${!hasSourceSerif ? 'Source Serif 4' : ''}${!hasSourceSerif && !hasInter ? ' + ' : ''}${!hasInter ? 'Inter' : ''}. La spec exige carga desde Google Fonts CDN.`,
      severity: 'warn',
    });
  }

  // Plus Jakarta Sans (v8.1) NO debería aparecer — si lo hace, regresó al
  // muscle memory de v8.1.
  if (html.includes('Plus Jakarta Sans') || html.includes('Plus+Jakarta+Sans')) {
    failures.push({
      rule: '§7 · Check 17 — tipografía v10.1 (sin Plus Jakarta Sans)',
      detail: 'Plus Jakarta Sans detectada — esa era la fuente v8.1. v10.1 usa Source Serif 4 + Inter + IBM Plex Mono.',
      severity: 'block',
    });
  }

  // ── Check 18 · §10 @page A4 portrait + .page width 210mm ──────────────────
  //
  // Severity: warn — la spec v10.1 exige A4 portrait. Si el CSS declara
  // landscape o un tamaño distinto, la impresión falla.
  const hasA4Portrait =
    htmlLower.includes('size: a4 portrait') ||
    htmlLower.includes('size:a4 portrait') ||
    htmlLower.includes('210mm');
  if (!hasA4Portrait) {
    failures.push({
      rule: '§10 · Check 18 — @page A4 portrait',
      detail: '@page A4 portrait o width: 210mm no detectado. La spec v10.1 exige A4 vertical.',
      severity: 'warn',
    });
  }

  // Si v8.1 16:9 / aspect-ratio:16/9 leaked, es regresión.
  if (htmlLower.includes('aspect-ratio: 16/9') || htmlLower.includes('aspect-ratio:16/9')) {
    failures.push({
      rule: '§10 · Check 18 — aspect-ratio v8.1 detectado',
      detail: 'aspect-ratio: 16/9 detectado — esa era la geometría v8.1. v10.1 usa A4 portrait.',
      severity: 'block',
    });
  }

  // ── Check 19 · §11 Tabular-nums en columnas numéricas ─────────────────────
  //
  // Severity: warn — `font-variant-numeric: tabular-nums` alinea los dígitos
  // en columnas financieras. Si el CSS no lo declara, las cifras se descuadran.
  const hasTabularNums =
    html.includes('tabular-nums') || html.includes('tabular_nums');
  if (!hasTabularNums) {
    failures.push({
      rule: '§11 · Check 19 — tabular-nums en columnas numéricas',
      detail: 'font-variant-numeric: tabular-nums no detectado en el HTML. Las columnas numéricas pueden desalinearse.',
      severity: 'warn',
    });
  }

  // ── Check 20 · §11 Formato numérico consistente ──────────────────────────
  //
  // best-effort DOM: verificar que las celdas numéricas usen el mismo
  // separador (punto para miles, coma para decimales — convención COP). Si
  // aparecen formatos mixtos ("1,000.00" junto a "1.000,00"), es error de
  // consistencia.
  // Severity: warn.
  let hasCommaDecimal = false;
  let hasDotDecimal = false;
  const allText = document.body?.textContent ?? '';
  if (/\d{1,3}(?:\.\d{3})+,\d{2}/.test(allText)) hasCommaDecimal = true;
  if (/\d{1,3}(?:,\d{3})+\.\d{2}/.test(allText)) hasDotDecimal = true;
  if (hasCommaDecimal && hasDotDecimal) {
    failures.push({
      rule: '§11 · Check 20 — formato numérico consistente',
      detail: 'Formatos numéricos mixtos detectados: COP (punto-miles/coma-decimal) y US (coma-miles/punto-decimal) coexisten.',
      severity: 'warn',
    });
  }

  // ── Check 21 · §11 Ortografía términos sensibles ──────────────────────────
  //
  // best-effort: busca errores comunes de ortografía en términos técnicos
  // financieros que cambiarían el significado o la credibilidad del reporte.
  // Severity: warn — la ortografía fina requiere revisión humana.
  const spellingPatterns: Array<{ wrong: RegExp; correct: string }> = [
    { wrong: /\bpatrimono\b/i, correct: 'patrimonio' },
    { wrong: /\bbalance de prueba\b/i, correct: 'balance de comprobación' },
    { wrong: /\bvulneracion\b/i, correct: 'vulneración' },
    { wrong: /\bcontabilizacion\b/i, correct: 'contabilización' },
  ];
  for (const { wrong, correct } of spellingPatterns) {
    if (wrong.test(html)) {
      failures.push({
        rule: '§11 · Check 21 — ortografía términos sensibles',
        detail: `Posible error de ortografía: "${wrong.source}" — considerar "${correct}"`,
        severity: 'warn',
      });
    }
  }

  // ── Check 22 · §4 — 15 páginas en orden ──────────────────────────────────
  //
  // Severity: warn — la spec v10.1 §4 exige 15 páginas A4 (Portada + TOC +
  // 02..14 = 15 articles). Contamos <article class="page">.
  // Umbral = 15 exacto (Portada + TOC + páginas 02..14). El `< 14` anterior
  // dejaba pasar silenciosamente reportes con una página faltante.
  // Severity: block (antes 'warn'). Un HTML truncado por presupuesto de
  // tokens degrada monótonamente en este contador y en ningún otro check —
  // todos los demás miran la portada o el <head>, que se emiten primero. Con
  // 'warn' un informe cortado a mitad de la Página 09 llegaba al cliente sin
  // una sola señal. Ver `runHtmlEditor`: un fallo block estampa BORRADOR.
  const articles = document.querySelectorAll('article.page');
  if (articles.length < 15) {
    failures.push({
      rule: '§4 · Check 22 — 15 páginas A4 portrait',
      detail: `Encontradas ${articles.length} páginas <article class="page">. Spec v10.1 exige 15 (Portada + TOC + 02..14).`,
      severity: 'block',
    });
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Check 7 — aritmética de totales POR COLUMNA
// ---------------------------------------------------------------------------
//
// La versión anterior sumaba las celdas de la MISMA fila y las comparaba
// contra la última. En un estado financiero real —`| Rubro | 2025 | 2024 |`—
// eso o no dispara nunca (queda un solo valor tras descartar la etiqueta) o
// compara el saldo de 2025 contra el de 2024. Es decir: el único check
// aritmético del pipeline no podía detectar un total mal sumado.
//
// Los totales de un EEFF se acumulan VERTICALMENTE: la fila TOTAL de cada
// columna es la suma de las filas de detalle de esa misma columna.
//
// Tres interpretaciones admitidas para una fila de total, porque una tabla
// canónica encadena subtotales y total general en el mismo <table>:
//
//   (a) suma de las filas de detalle DESDE EL ÚLTIMO TOTAL  → subtotal de sección
//   (b) suma de TODAS las filas de detalle de la tabla      → total general
//   (c) suma de las filas de TOTAL anteriores               → total de totales
//
// Sólo se reporta fallo cuando NINGUNA de las tres cuadra: un total correcto
// jamás cae fuera de las tres, y un total inventado difícilmente cae dentro.
//
// Sólo se consideran celdas que contienen `$`. Es lo que la spec §1.9 exige
// para toda cifra monetaria y lo que separa las columnas de dinero de las de
// ratios (`2,13×`), porcentajes y conteos, que no son sumables.

const ARITHMETIC_TOLERANCE_COP = 1;

/**
 * Parsea una celda con formato COP (`$1.234.567,89`, `($1.234,56)`, `-$1.234`).
 * Devuelve `null` si la celda no es una cifra monetaria sumable.
 */
export function parseCopCell(raw: string): number | null {
  const text = (raw ?? '').replace(/ /g, ' ').trim();
  if (!text.includes('$')) return null;
  // Un porcentaje no es sumable aunque venga acompañado de `$` en la misma
  // celda (celdas "Δ $ / Δ %" combinadas).
  if (text.includes('%')) return null;
  // Convención contable NIIF: negativo entre paréntesis. Sin esto, un EEFF
  // con costos entre paréntesis producía un BLOCK falso en cada tabla.
  const isNegative = /\(\s*-?\s*\$/.test(text) || /^-/.test(text) || /\$\s*-/.test(text);
  const digits = text.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(digits)) return null;
  const normalized = digits.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return isNegative ? -Math.abs(n) : Math.abs(n);
}

/** ¿La fila es una fila de total/subtotal? (clase, etiqueta o <tfoot>) */
function isTotalRow(row: Element): boolean {
  const rowClass = (row.getAttribute('class') ?? '').toLowerCase();
  if (rowClass.includes('total')) return true;
  if (row.parentElement?.tagName?.toLowerCase() === 'tfoot') return true;
  const cells = Array.from(row.querySelectorAll('th, td'));
  if (cells.some((c) => (c.getAttribute('class') ?? '').toLowerCase().includes('total'))) {
    return true;
  }
  const label = (cells[0]?.textContent ?? '').trim().toLowerCase();
  // "Total comprehensive income" / "Total resultado integral" es utilidad +
  // ORI, no la suma de la columna: R4 lo concilia contra el JSON NIIF.
  if (/^total\s+(?:comprehensive\s+income|(?:del\s+)?resultado\s+integral)\b/.test(label)) return false;
  return /^(sub)?total\b/.test(label) || label.startsWith('total ');
}

function checkColumnArithmetic(document: ParsedDocument): ChecklistFailure[] {
  const failures: ChecklistFailure[] = [];

  for (const table of Array.from(document.querySelectorAll('table'))) {
    // Acumuladores por índice de columna.
    const local = new Map<number, { sum: number; count: number }>();
    const global = new Map<number, { sum: number; count: number }>();
    const subtotals = new Map<number, { sum: number; count: number }>();
    let reported = false;

    const add = (
      acc: Map<number, { sum: number; count: number }>,
      idx: number,
      value: number,
    ) => {
      const cur = acc.get(idx) ?? { sum: 0, count: 0 };
      acc.set(idx, { sum: cur.sum + value, count: cur.count + 1 });
    };

    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const values = cells.map((c) => parseCopCell(c.textContent ?? ''));
      const totalRow = isTotalRow(row);

      if (!totalRow) {
        values.forEach((v, idx) => {
          if (v === null) return;
          add(local, idx, v);
          add(global, idx, v);
        });
        continue;
      }

      // Fila de total: contrasta cada columna contra las tres lecturas.
      values.forEach((v, idx) => {
        if (v === null || reported) return;
        const candidates: number[] = [];
        const l = local.get(idx);
        const g = global.get(idx);
        const s = subtotals.get(idx);
        if (l && l.count >= 2) candidates.push(l.sum);
        if (g && g.count >= 2) candidates.push(g.sum);
        if (s && s.count >= 2) candidates.push(s.sum);
        if (candidates.length === 0) return;
        const cuadra = candidates.some(
          (c) => Math.abs(c - v) <= ARITHMETIC_TOLERANCE_COP,
        );
        if (cuadra) return;
        const label = (cells[0]?.textContent ?? '').trim().slice(0, 60);
        failures.push({
          rule: '§1.1 · Check 7 — aritmética de totales',
          detail:
            `Fila "${label}" columna ${idx + 1}: total declarado ${v.toFixed(2)} ` +
            `no coincide con ninguna suma de la columna (${candidates
              .map((c) => c.toFixed(2))
              .join(' | ')}).`,
          severity: 'block',
        });
        // Un solo fallo por tabla: un descuadre suele arrastrar a todas las
        // columnas y el banner se volvería ilegible.
        reported = true;
      });

      values.forEach((v, idx) => {
        if (v !== null) add(subtotals, idx, v);
      });
      local.clear();
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Reconciliación HTML ↔ JSON — la pieza que faltaba
// ---------------------------------------------------------------------------
//
// Ningún check anterior comparaba el HTML contra el JSON de origen: el Check 7
// suma dentro del propio HTML, así que un juego de cifras internamente
// coherente pero equivocado (el clásico desliz de escala centavos→pesos)
// pasaba entero.
//
// Dirección del check — importa:
//
//   R1 (block) PRESENCIA: toda cifra vinculante del JSON debe aparecer
//       literalmente en el HTML. Alta precisión: si el Activo Total del JSON
//       no está impreso en ninguna parte, el documento es otro documento.
//
//   R2 (warn) AUSENCIA DE CIFRAS AJENAS: toda cifra monetaria dentro de una
//       celda debería poder rastrearse a algún monto del payload. Es 'warn' y
//       no 'block' a propósito: el informe contiene legítimamente cifras
//       derivadas (variaciones, subtotales por rubro) y la spec §1.9/L38
//       autoriza el abreviado `$X.XXX M`. Como bloqueo sería un generador de
//       falsos positivos masivos; como aviso, es la red que caza la cifra
//       inventada.

/** Renderizaciones COP aceptables para un monto en centavos (valor absoluto). */
function acceptableRenderings(cents: bigint): string[] {
  const HUNDRED = BigInt(100);
  const abs = cents < BigInt(0) ? -cents : cents;
  const exact = formatCopFromCents(abs, true);
  // Presentación en pesos enteros: la plantilla puede omitir los centavos.
  // Se admiten truncado y redondeado para no bloquear por el último centavo.
  const truncated = formatCopFromCents(abs - (abs % HUNDRED), true).replace(/,\d{2}$/, '');
  const rounded = formatCopFromCents(
    abs + (HUNDRED - BigInt(1)) - ((abs + (HUNDRED - BigInt(1))) % HUNDRED),
    true,
  ).replace(/,\d{2}$/, '');
  return Array.from(new Set([exact, truncated, rounded]));
}

/**
 * Texto plano normalizado del HTML para búsqueda de cifras: sin etiquetas, sin
 * `&nbsp;` y sin el espacio que algunas plantillas dejan entre `$` y el número.
 */
function normalizedText(html: string, document: ParsedDocument): string {
  const raw = document.body?.textContent ?? html.replace(/<[^>]+>/g, ' ');
  return raw.replace(/ /g, ' ').replace(/\$\s+/g, '$');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ¿Aparece `candidate` como cifra completa? El lookahead evita que
 * `$1.234.567` valide por estar contenido en `$1.234.567.890`.
 */
function containsFigure(text: string, candidate: string): boolean {
  return new RegExp(`${escapeRegExp(candidate)}(?![.,]?\\d)`).test(text);
}

/** Recolecta todo monto del payload como conjunto de renderizaciones válidas. */
function collectPayloadRenderings(payload: unknown): Set<string> {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const HUNDRED = BigInt(100);

  const addCents = (cents: bigint) => {
    for (const r of acceptableRenderings(cents)) out.add(r);
  };

  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      // MoneyCop: entero serializado. ≥4 dígitos ⇒ ≥ $10,00; por debajo son
      // códigos PUC y años, no montos.
      if (/^-?\d{4,}$/.test(node)) {
        try {
          addCents(parseMoneyCop(node));
        } catch {
          /* no es MoneyCop — se ignora */
        }
      }
      return;
    }
    if (typeof node === 'number') {
      if (!Number.isFinite(node) || Math.abs(node) < 1000) return;
      // Los reportes de strategy/governance manejan pesos como `number`. Se
      // admiten ambas lecturas (pesos y centavos) porque este conjunto sólo
      // se usa para PERMITIR cifras: sobre-incluir nunca genera un falso aviso.
      addCents(BigInt(Math.round(node)) * HUNDRED);
      addCents(BigInt(Math.round(node)));
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
      walk(value, depth + 1);
    }
  };

  walk(payload, 0);
  return out;
}

/** Payload mínimo que necesita el reconciliador. */
export interface ReconciliationInput {
  niifReport: NiifReportJson;
  strategyReport?: unknown;
  governanceReport?: unknown;
  /**
   * Preprocesado del mismo balance (el que usó /niif). Habilita R6 sobre los
   * conceptos que el JSON NIIF no trae (ingresos, EBITDA, ROE).
   */
  preprocessed?: PreprocessedBalance | null;
}

const ZERO_CENTS = BigInt(0);

function moneyCents(v: string | null | undefined): bigint | null {
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return null;
  return BigInt(v);
}

function bindingFigure(path: string, label: string, cents: bigint): BindingFigure {
  return {
    path,
    label,
    cents: cents.toString(),
    formatted: formatCopFromCents(cents < ZERO_CENTS ? -cents : cents, true),
    isNegative: cents < ZERO_CENTS,
  };
}

/**
 * ORI y resultado integral total (utilidad + ORI) de cada periodo como cifras
 * vinculantes, con signo (re-auditoría fase 2, e2e-niif2-03): el ERI del HTML
 * imprimía el ORI sin conciliarlo contra el JSON NIIF, así que un ORI con el
 * signo invertido o con otro importe salía emitible. Sin ORI (cero o nulo) no
 * se añade nada: el resultado integral total es la utilidad neta, que ya es
 * vinculante. El prompt del Editor Jefe las publica en `<cifras_vinculantes>`.
 */
export function comprehensiveIncomeFigures(niif: NiifReportJson | null | undefined): BindingFigure[] {
  const is = niif?.incomeStatement;
  if (!is) return [];
  const out: BindingFigure[] = [];
  const periods: Array<[string, string, string | null | undefined, string | null | undefined]> = [
    ['Primary', 'período actual', is.oriPrimary, is.netIncomePrimary],
    ['Comparative', 'período comparativo', is.oriComparative, is.netIncomeComparative],
  ];
  for (const [suffix, period, oriRaw, netRaw] of periods) {
    const ori = moneyCents(oriRaw);
    if (ori === null || ori === ZERO_CENTS) continue;
    out.push(bindingFigure(`incomeStatement.ori${suffix}`, `Otro Resultado Integral — ${period}`, ori));
    const net = moneyCents(netRaw);
    if (net !== null && net + ori !== ZERO_CENTS) {
      out.push(
        bindingFigure(`incomeStatement.netIncome${suffix}+ori${suffix}`, `Resultado Integral Total — ${period}`, net + ori),
      );
    }
  }
  return out;
}

/**
 * Reconcilia el HTML emitido contra el JSON de origen.
 *
 * @param html  - HTML completo emitido por el Editor Jefe.
 * @param input - JSONs vinculantes (niif + strategy + governance).
 */
export function reconcileBindingFigures(
  html: string,
  input: ReconciliationInput,
): ChecklistFailure[] {
  const failures: ChecklistFailure[] = [];
  const { document } = parseHTML(html);
  const text = normalizedText(html, document);
  const figures: BindingFigure[] = [
    ...collectBindingFigures(input.niifReport),
    ...comprehensiveIncomeFigures(input.niifReport),
  ];

  // ── R1 · presencia literal de cada cifra vinculante ──────────────────────
  const HUNDRED = BigInt(100);
  for (const fig of figures) {
    const cents = parseMoneyCop(fig.cents);
    const abs = cents < BigInt(0) ? -cents : cents;
    if (acceptableRenderings(abs).some((r) => containsFigure(text, r))) continue;

    // Diagnóstico del error más frecuente al reformatear: el factor 100.
    const slipUp = acceptableRenderings(abs * HUNDRED).some((r) => containsFigure(text, r));
    const slipDown = acceptableRenderings(abs / HUNDRED).some((r) => containsFigure(text, r));
    const diagnostico = slipUp
      ? ' Se detectó la misma cifra multiplicada por 100 — desliz de escala centavos→pesos.'
      : slipDown
        ? ' Se detectó la misma cifra dividida entre 100 — desliz de escala pesos→centavos.'
        : '';

    failures.push({
      rule: '§1.1 · Reconciliación JSON↔HTML — cifra vinculante ausente',
      detail:
        `${fig.label} vale ${fig.formatted} en el reporte NIIF, pero esa cifra no ` +
        `aparece en el HTML emitido.${diagnostico}`,
      severity: 'block',
    });
  }

  // ── R1b · cifras vinculantes del ACTA (auditoría pipeline-flujo-09) ──────
  // El acta es el documento que se firma e inscribe: un desliz ×100 en su
  // tabla de destinación sólo generaba el aviso R2. Si el HTML incluye el
  // acta, sus cifras se exigen literalmente, igual que las del NIIF.
  if (/\bacta\b/i.test(text)) {
    for (const fig of collectActaBindingFigures(input.governanceReport)) {
      const cents = parseMoneyCop(fig.cents);
      const abs = cents < BigInt(0) ? -cents : cents;
      if (acceptableRenderings(abs).some((r) => containsFigure(text, r))) continue;
      const slipUp = acceptableRenderings(abs * HUNDRED).some((r) => containsFigure(text, r));
      const slipDown = acceptableRenderings(abs / HUNDRED).some((r) => containsFigure(text, r));
      failures.push({
        rule: '§1.1 · Reconciliación JSON↔HTML — cifra del acta ausente',
        detail:
          `${fig.label} vale ${fig.formatted} en el reporte de Gobierno, pero esa cifra no aparece ` +
          `en el HTML emitido.` +
          (slipUp
            ? ' Se detectó la misma cifra multiplicada por 100 — desliz de escala centavos→pesos.'
            : slipDown
              ? ' Se detectó la misma cifra dividida entre 100 — desliz de escala pesos→centavos.'
              : ''),
        severity: 'block',
      });
    }
  }

  // ── R3 · signo de las cifras vinculantes (auditoría pipeline-flujo-09) ────
  // R1 compara valores absolutos: una pérdida presentada como utilidad pasaba.
  failures.push(...checkBindingSigns(text, figures));

  // ── R4/R5 · columna y periodo (auditoría pipeline-flujo-08) ──────────────
  failures.push(...checkPeriodColumns(document, input.niifReport));

  // ── R8 · comparativos del EFE y del ECP (integración I2, pendiente #3) ────
  failures.push(...checkComparativeStatements(document, text, input.niifReport));

  // ── R6 · conceptos anclados citados en prosa o abreviados (e2e-niif-11) ──
  failures.push(...checkAnchoredConceptsInText(document, input));

  // El Editor Jefe recibe los KPIs de la Parte II ya anclados (recalculados
  // por el sistema o N/D, pendiente #2 de la auditoría integral 2026-09-24).
  const strategy = StrategyReportSchema.safeParse(input.strategyReport);
  const anchoredStrategy = strategy.success
    ? applyKpiAnchors(
        strategy.data,
        strategyAnchorSources(input.preprocessed ?? undefined, input.niifReport),
        { keepWhenNoSource: true },
      ).json
    : null;

  // ── R7 · KPI publicado N/D (o recalculado) con la cifra del modelo ───────
  if (strategy.success && anchoredStrategy) {
    failures.push(...checkDiscardedKpiFigures(document, discardedKpiFigures(strategy.data, anchoredStrategy)));
  }

  // ── R2 · cifras del HTML que no se rastrean al payload ───────────────────
  // Sobre el payload tal como lo recibió el Editor Jefe: la cifra del modelo de
  // un KPI publicado N/D o recalculado ya no es rastreable.
  const allowed = collectPayloadRenderings(
    anchoredStrategy ? { ...input, strategyReport: anchoredStrategy } : input,
  );
  const figurePattern = /\$\d{1,3}(?:\.\d{3})+(?:,\d{2})?/g;
  const untraceable: string[] = [];
  const seenUntraceable = new Set<string>();

  for (const cell of Array.from(document.querySelectorAll('td'))) {
    const cellText = (cell.textContent ?? '').replace(/ /g, ' ').replace(/\$\s+/g, '$');
    // Abreviado autorizado por §1.9/L38 — `$4.196 M` no es la cifra exacta.
    if (/\$[\d.,]+\s*(?:M{1,2}\b|mil(?:es)?\b|millones\b)/i.test(cellText)) continue;
    for (const match of cellText.match(figurePattern) ?? []) {
      if (seenUntraceable.has(match)) continue;
      if (allowed.has(match)) continue;
      // Cifras chicas (< $1.000.000) suelen ser desgloses de nota o unidades;
      // el ruido no compensa. El error de escala vive en las magnitudes altas.
      const pesos = Number.parseFloat(
        match.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.'),
      );
      if (!Number.isFinite(pesos) || pesos < 1_000_000) continue;
      seenUntraceable.add(match);
      untraceable.push(match);
    }
  }

  if (untraceable.length > 0) {
    failures.push({
      rule: '§1.1 · Reconciliación JSON↔HTML — cifra no rastreable',
      detail:
        `${untraceable.length} cifra(s) en celdas de tabla no corresponden a ningún ` +
        `monto del payload: ${untraceable.slice(0, 5).join(', ')}` +
        `${untraceable.length > 5 ? ' …' : ''}. Pueden ser variaciones derivadas legítimas o cifras inventadas.`,
      severity: 'warn',
    });
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Signo, columna y periodo de las cifras vinculantes (auditoría 2026-09)
// ---------------------------------------------------------------------------

/** Palabras que, antes de una cifra sin signo, la presentan como positiva/negativa. */
const POSITIVE_CONTEXT = /(utilidad|ganancia|super[aá]vit|excedente|aument[oó]|incremento)[^$]{0,60}$/i;
const NEGATIVE_CONTEXT = /(p[eé]rdida|d[eé]ficit|negativ|disminu|reducci|ca[ií]da)[^$]{0,60}$/i;

function figureOccurrences(text: string, candidate: string): Array<{ negative: boolean; index: number }> {
  const re = new RegExp(`(\\(\\s*|[-−]\\s*)?${escapeRegExp(candidate)}(?![.,]?\\d)`, 'g');
  const out: Array<{ negative: boolean; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ negative: m[1] !== undefined, index: m.index });
  }
  return out;
}

/**
 * R3 — Una cifra vinculante NEGATIVA no puede presentarse sin signo como
 * utilidad/ganancia, ni aparecer SIEMPRE sin signo; una POSITIVA no puede
 * aparecer SIEMPRE entre paréntesis o con signo menos.
 */
function checkBindingSigns(text: string, figures: BindingFigure[]): ChecklistFailure[] {
  const out: ChecklistFailure[] = [];
  for (const fig of figures) {
    const cents = parseMoneyCop(fig.cents);
    const abs = cents < BigInt(0) ? -cents : cents;
    const occ = acceptableRenderings(abs).flatMap((r) => figureOccurrences(text, r));
    if (occ.length === 0) continue; // la ausencia ya la reporta R1
    if (fig.isNegative) {
      const unsigned = occ.filter((o) => !o.negative);
      const asProfit = unsigned.filter((o) => {
        const before = text.slice(Math.max(0, o.index - 80), o.index);
        return POSITIVE_CONTEXT.test(before) && !NEGATIVE_CONTEXT.test(before);
      });
      if (unsigned.length === occ.length || asProfit.length > 0) {
        out.push({
          rule: '§1.1 · Reconciliación JSON↔HTML — signo invertido',
          detail:
            `${fig.label} es NEGATIVA (${fig.formatted} con signo menos en el reporte NIIF) y el HTML ` +
            `la presenta ${asProfit.length > 0 ? 'como utilidad o ganancia' : 'siempre sin signo'}. ` +
            `Preséntela entre paréntesis o con signo menos.`,
          severity: 'block',
        });
      }
    } else if (occ.every((o) => o.negative)) {
      out.push({
        rule: '§1.1 · Reconciliación JSON↔HTML — signo invertido',
        detail:
          `${fig.label} es POSITIVA (${fig.formatted}) y el HTML sólo la presenta entre paréntesis o ` +
          `con signo menos.`,
        severity: 'block',
      });
    }
  }
  return out;
}

function yearOf(period: string | null | undefined): string | null {
  const m = typeof period === 'string' ? period.match(/(\d{4})/) : null;
  return m ? m[1] : null;
}

/**
 * Rótulo de una fila de estado para R4, sin lo accesorio: el paréntesis
 * ("Otro resultado integral (ORI)", "Utilidad (pérdida) neta"), la coletilla
 * "neto de impuestos" / "net of tax" y la puntuación final. Revisión F-html:
 * con esas variantes el ORI impreso con el signo invertido no se conciliaba.
 */
function periodRowLabel(label: string): string {
  return label
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,;]?\s*(?:net[oa]s?\s+de\s+impuestos?(?:\s+diferidos?)?|net\s+of\s+(?:income\s+)?tax(?:es)?)$/i, '')
    .replace(/[\s.:;,]+$/, '')
    .trim();
}

/**
 * R4 — en las tablas con encabezado de año, la cifra vinculante del periodo
 * actual debe estar bajo la columna del periodo actual (y la comparativa bajo
 * la suya). R5 — los encabezados y la fecha de corte deben corresponder al
 * periodo del reporte (company.fiscalPeriod / comparativePeriod).
 */
function checkPeriodColumns(document: ParsedDocument, niif: NiifReportJson): ChecklistFailure[] {
  const out: ChecklistFailure[] = [];
  const primaryYear = yearOf(niif?.company?.fiscalPeriod);
  if (!primaryYear) return out;
  const comparativeYear = yearOf(niif?.company?.comparativePeriod ?? null);
  const allowed = new Set([primaryYear, ...(comparativeYear ? [comparativeYear] : [])]);

  // R5 — fecha de corte y años de encabezado.
  const headingTexts = Array.from(document.querySelectorAll('h1, h2, h3, th, caption')).map(
    (el) => (el.textContent ?? '').replace(/ /g, ' '),
  );
  const cutoffYears = new Set<string>();
  const thYears = new Set<string>();
  for (const t of headingTexts) {
    for (const m of t.matchAll(/31\s+de\s+diciembre\s+(?:de|del)\s+(\d{4})/gi)) cutoffYears.add(m[1]);
  }
  for (const th of Array.from(document.querySelectorAll('th'))) {
    const t = (th.textContent ?? '').trim();
    if (/^(?:19|20)\d{2}$/.test(t)) thYears.add(t);
  }
  // Un año posterior al del reporte es un rótulo de proyección, no un corte
  // equivocado; lo que se bloquea es un corte ANTERIOR ajeno al comparativo.
  const foreignCutoff = [...cutoffYears].filter(
    (y) => !allowed.has(y) && Number(y) < Number(primaryYear),
  );
  const historicalCutoffs = [...cutoffYears].filter((y) => Number(y) <= Number(primaryYear));
  if (foreignCutoff.length > 0 || (historicalCutoffs.length > 0 && !cutoffYears.has(primaryYear))) {
    out.push({
      rule: '§1.1 · Periodo del reporte — fecha de corte',
      detail:
        `Los encabezados declaran fecha de corte al 31 de diciembre de ${[...cutoffYears].join(', ')} ` +
        `y el reporte NIIF corresponde al periodo ${primaryYear}` +
        `${comparativeYear ? ` (comparativo ${comparativeYear})` : ''}.`,
      severity: 'block',
    });
  }
  if (thYears.size > 0 && !thYears.has(primaryYear)) {
    out.push({
      rule: '§1.1 · Periodo del reporte — encabezados de columna',
      detail:
        `Las columnas de los estados se rotulan ${[...thYears].join(', ')} y el periodo del reporte ` +
        `es ${primaryYear}.`,
      severity: 'block',
    });
  }

  // R4 — cifra bajo la columna de su periodo.
  //
  // Re-auditoría fase 2:
  //   - e2e-niif2-04: la columna comparativa sólo se exige cuando trae una
  //     cifra completa. Un EFE honesto a dos columnas con "—" en el
  //     comparativo (EFE comparativo no presentado) bloqueaba la fila
  //     "Utilidad neta del ejercicio" con un mensaje que nombraba la columna
  //     del periodo actual, que sí cuadraba. El mensaje nombra ahora la
  //     columna que falla.
  //   - e2e-niif2-03: el ORI y el resultado integral total (utilidad + ORI)
  //     se concilian con SIGNO en ambas columnas.
  //   - narrativa-16: la columna del año se reconoce con el año en cualquier
  //     posición del encabezado ("2024 (comparativo)", "Dic-2024"), salvo que
  //     el encabezado cite los dos años (una variación).
  const bs = niif.balanceSheet;
  const is = niif.incomeStatement;
  const sumCents = (a: string | null | undefined, b: string | null | undefined): string | null => {
    const x = moneyCents(a);
    const y = moneyCents(b);
    return x === null || y === null ? null : (x + y).toString();
  };
  const concepts: Array<{
    re: RegExp;
    label: string;
    primary: string | null;
    comparative: string | null;
    signed?: boolean;
  }> = [
    { re: /^total\s+(?:de\s+)?activos?$|^total\s+assets$/i, label: 'Total Activo', primary: bs?.totalAssetsPrimary ?? null, comparative: bs?.totalAssetsComparative ?? null },
    { re: /^total\s+(?:de\s+)?pasivos?$|^total\s+liabilities$/i, label: 'Total Pasivo', primary: bs?.totalLiabilitiesPrimary ?? null, comparative: bs?.totalLiabilitiesComparative ?? null },
    { re: /^total\s+(?:del?\s+)?patrimonio$|^total\s+equity$/i, label: 'Total Patrimonio', primary: bs?.totalEquityPrimary ?? null, comparative: bs?.totalEquityComparative ?? null },
    {
      re: /^(?:utilidad|resultado|p[eé]rdida|ganancia)\s+net[oa](?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o))?$|^net\s+(?:income|profit|loss)(?:\s+for\s+the\s+(?:year|period))?$/i,
      label: 'Utilidad Neta',
      primary: is?.netIncomePrimary ?? null,
      comparative: is?.netIncomeComparative ?? null,
    },
    {
      re: /^(?:otro\s+resultado\s+integral|ori|other\s+comprehensive\s+income|oci)(?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o)|\s+for\s+the\s+(?:year|period))?$/i,
      label: 'Otro Resultado Integral (ORI)',
      primary: is?.oriPrimary ?? null,
      comparative: is?.oriComparative ?? null,
      signed: true,
    },
    {
      re: /^(?:resultado\s+integral\s+total|total\s+(?:del\s+)?resultado\s+integral|total\s+comprehensive\s+income)(?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o)|\s+for\s+the\s+(?:year|period))?$/i,
      label: 'Resultado Integral Total',
      primary: sumCents(is?.netIncomePrimary, is?.oriPrimary),
      comparative: sumCents(is?.netIncomeComparative, is?.oriComparative),
      signed: true,
    },
  ];
  const renders = (v: string | null): string[] => {
    const c = moneyCents(v);
    return c === null ? [] : acceptableRenderings(c < ZERO_CENTS ? -c : c);
  };
  /** La celda imprime la cifra (y, si el concepto lo exige, con su signo). */
  const holds = (cell: string, value: string | null, signed: boolean | undefined): boolean => {
    if (!renders(value).some((r) => containsFigure(cell, r))) return false;
    if (!signed) return true;
    const expected = moneyCents(value);
    const printed = cellCents(cell);
    if (expected === null || printed === null || expected === ZERO_CENTS) return true;
    return (printed < ZERO_CENTS) === (expected < ZERO_CENTS);
  };
  const shown = (v: string | null): string => {
    const c = moneyCents(v);
    return c === null ? 'N/D' : formatCopFromCents(c, false);
  };
  for (const table of Array.from(document.querySelectorAll('table'))) {
    const headerRow = table.querySelector('tr');
    if (!headerRow) continue;
    const headers = cellTexts(headerRow);
    const pIdx = yearColumn(headers, primaryYear, comparativeYear);
    const cIdx = yearColumn(headers, comparativeYear, primaryYear);
    if (pIdx < 0) continue;
    for (const row of Array.from(table.querySelectorAll('tr')).slice(1)) {
      const cells = cellTexts(row);
      if (cells.length !== headers.length) continue;
      const concept = concepts.find((k) => k.re.test(periodRowLabel(cells[0])));
      if (!concept || concept.primary === null || renders(concept.primary).length === 0) continue;
      // Sólo celdas con la cifra completa: una tabla de resumen con montos
      // abreviados ($1.000 M, §1.9/L38) no es un estado financiero.
      const complete = (cell: string) => FULL_FIGURE.test(cell) && !ABBREVIATED.test(cell);
      if (!complete(cells[pIdx])) continue;
      if (!holds(cells[pIdx], concept.primary, concept.signed)) {
        const swapped = renders(concept.comparative).some((r) => containsFigure(cells[pIdx], r));
        out.push({
          rule: '§1.1 · Periodo del reporte — columna',
          detail:
            `${concept.label}: la columna ${primaryYear} imprime "${cells[pIdx]}"` +
            `${swapped && !concept.signed ? ', que es la cifra del periodo comparativo (columnas intercambiadas)' : ''}; ` +
            `el reporte NIIF da ${shown(concept.primary)} para ${primaryYear}.`,
          severity: 'block',
        });
        continue;
      }
      // La columna comparativa sólo se juzga cuando imprime una cifra completa:
      // "—" / "N/D" (comparativo no presentado) no contradice nada.
      if (cIdx < 0 || !comparativeYear || concept.comparative === null || !complete(cells[cIdx])) continue;
      if (!holds(cells[cIdx], concept.comparative, concept.signed)) {
        out.push({
          rule: '§1.1 · Periodo del reporte — columna',
          detail:
            `${concept.label}: la columna ${comparativeYear} imprime "${cells[cIdx]}"; ` +
            `el reporte NIIF da ${shown(concept.comparative)} para ${comparativeYear}.`,
          severity: 'block',
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// R8 — comparativos del EFE y del ECP (integración I2; fila por fila desde la
// re-auditoría final de la fase 2)
// ---------------------------------------------------------------------------
// Desde el pendiente #3 la columna comparativa del EFE y las filas del ECP del
// periodo comparativo las calcula el código (o las deja sin presentar con una
// nota). El Editor Jefe las recibe preformateadas; aquí se exige que el HTML
// las COPIE. Sin base determinista (dos cortes) cualquier cifra de la columna
// comparativa del EFE, o de una fila del ECP comparativo que no sea el saldo
// de apertura del periodo actual, es inventada.
//
// Antes se validaba por PERTENENCIA a un conjunto de cifras en valor absoluto
// (más las sumas de columnas de cada fila del ECP): dos renglones del EFE 2024
// permutados, la inversión en positivo, el capital de apertura del ECP 2024
// impreso con el del cierre o un total igual a la suma de dos columnas de la
// misma fila salían emitibles (e2e-niif2-03, narrativa-16). Ahora:
//   - EFE: cada fila con cifra en la columna comparativa debe ser UN elemento
//     del EFE comparativo (renglón, flujo neto de sección, variación neta,
//     efectivo inicial o final) con la MISMA pareja (actual, comparativo) y el
//     mismo signo; si el rótulo nombra un agregado (flujo neto de operación,
//     efectivo al inicio…), debe ser ese agregado.
//   - ECP: cada fila del periodo comparativo debe ser UNA fila del JSON (según
//     su rótulo: saldo de apertura, saldo de cierre o movimiento) con cada
//     columna igual, con signo, a la clave que su encabezado nombra. Una
//     columna agregada ("Reservas" = legal + otras) suma sólo lo que su
//     encabezado agrega, más los componentes sin columna propia (prima, ORI),
//     que la plantilla de 6 columnas presenta junto a otra.
// ---------------------------------------------------------------------------

const R8_RULE = '§1.1 · Comparativo del EFE/ECP — cifra fuera del JSON';
const R8_NOTE_RULE = '§1.1 · Comparativo del EFE/ECP — nota de comparativo no presentado';
// Títulos de los estados (spec v10.1 §4: "Estado de Flujos de Efectivo",
// "Estado de Cambios en el Patrimonio"). Estrictos a propósito: un análisis de
// "flujo de caja" o una proyección de la Parte II no es el EFE.
const CASH_FLOW_HEADING = /estado\s+de\s+flujos?\s+de\s+efectivo|statement\s+of\s+cash\s+flows?/i;
const EQUITY_HEADING = /estado\s+de\s+cambios\s+en\s+el\s+patrimonio|statement\s+of\s+changes\s+in\s+(?:shareholders['’]?\s+)?equity/i;
/** Cifra monetaria completa (incluye montos < $1.000 y el $0). */
const ANY_FIGURE = /\$\d{1,3}(?:\.\d{3})*(?:,\d{2})?(?![.,]?\d)/g;
/** Cifra monetaria completa con separador de miles (la de un estado financiero). */
const FULL_FIGURE = /\$\d{1,3}(?:\.\d{3})+(?:,\d{2})?(?![.,]?\d)/;
const ABBREVIATED = /\$[\d.,]+\s*(?:M{1,2}\b|mil(?:es)?\b|millones\b)/i;
/** Rótulo que declara el signo por sí mismo: "(−) Distribuciones", "Menos: …". */
const NEGATIVE_LABEL = /^\(\s*[-−–]\s*\)|^menos\b|^less\b/i;

/**
 * Índice (> 0) de la columna cuyo encabezado cita `year` en cualquier
 * posición ("2024", "2024 (comparativo)", "Dic-2024", "Año 2024") y no cita
 * `other` (un encabezado con los dos años es una variación).
 */
function yearColumn(headers: string[], year: string | null, other: string | null): number {
  if (!year) return -1;
  const cites = (h: string, y: string) => new RegExp(`(?<!\\d)${y}(?!\\d)`).test(h);
  return headers.findIndex((h, i) => i > 0 && cites(h, year) && !(other !== null && cites(h, other)));
}

/** Primera cifra monetaria completa de la celda, con signo, en centavos. */
function cellCents(cell: string): bigint | null {
  if (ABBREVIATED.test(cell)) return null;
  const m = /(\(\s*)?([-−]\s*)?\$\s*(\(\s*)?([-−]\s*)?(\d{1,3}(?:\.\d{3})*)(?:,(\d{1,2}))?(?![.,]?\d)(\s*\))?/.exec(cell);
  if (!m) return null;
  const [, open1, sign1, open2, sign2, int, dec, close] = m;
  const cents = BigInt(int.replace(/\./g, '')) * BigInt(100) + BigInt((dec ?? '').padEnd(2, '0'));
  const negative = Boolean(sign1 || sign2) || (Boolean(open1 || open2) && Boolean(close));
  return negative ? -cents : cents;
}

const absCents = (v: bigint) => (v < ZERO_CENTS ? -v : v);

/**
 * Tablas del documento con el título que las rotula: su caption o el último
 * encabezado de sección (h1/h2) — un h3-h5 intermedio ("Actividades de
 * operación") no cambia de estado salvo que sea él mismo el título de uno.
 */
function tablesWithHeading(document: ParsedDocument): Array<{ table: Element; heading: string }> {
  const out: Array<{ table: Element; heading: string }> = [];
  let last = '';
  for (const el of Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, table'))) {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'table') {
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (tag === 'h1' || tag === 'h2' || CASH_FLOW_HEADING.test(t) || EQUITY_HEADING.test(t)) last = t;
      continue;
    }
    const caption = (el.querySelector('caption')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    out.push({ table: el, heading: caption || last });
  }
  return out;
}

function cellTexts(row: Element): string[] {
  return Array.from(row.querySelectorAll('th, td')).map((c) =>
    (c.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\$\s+/g, '$').trim(),
  );
}

/** Renderizaciones admitidas para un conjunto de MoneyCop (valor absoluto). */
function renderingsOf(values: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>(['$0', '$0,00']);
  for (const v of values) {
    if (v === null || v === undefined) continue;
    try {
      const c = parseMoneyCop(v);
      for (const r of acceptableRenderings(c < BigInt(0) ? -c : c)) out.add(r);
    } catch {
      /* no es MoneyCop */
    }
  }
  return out;
}

function foreignFigures(cell: string, allowed: Set<string>): string[] {
  if (ABBREVIATED.test(cell)) return [];
  return (cell.match(ANY_FIGURE) ?? []).filter((m) => !allowed.has(m));
}

const foldLabel = (t: string) =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ── EFE ─────────────────────────────────────────────────────────────────────

type CashFlowKind = 'line' | 'operating' | 'investing' | 'financing' | 'change' | 'opening' | 'closing';

interface CashFlowElement {
  kind: CashFlowKind;
  primary: bigint | null;
  comparative: bigint | null;
}

function cashFlowElements(cf: NiifReportJson['cashFlow']): CashFlowElement[] {
  const out: CashFlowElement[] = [];
  for (const s of cf.sections ?? []) {
    for (const l of s.lines ?? []) {
      out.push({ kind: 'line', primary: moneyCents(l.amountPrimary), comparative: moneyCents(l.amountComparative) });
    }
    const kind: CashFlowKind =
      s.section === 'operating' ? 'operating' : s.section === 'investing' ? 'investing' : 'financing';
    out.push({ kind, primary: moneyCents(s.netFlow), comparative: moneyCents(s.netFlowComparative) });
  }
  out.push({ kind: 'change', primary: moneyCents(cf.netChange), comparative: moneyCents(cf.netChangeComparative) });
  out.push({ kind: 'opening', primary: moneyCents(cf.cashOpening), comparative: moneyCents(cf.cashOpeningComparative) });
  out.push({ kind: 'closing', primary: moneyCents(cf.cashClosing), comparative: moneyCents(cf.cashClosingComparative) });
  return out;
}

/**
 * Agregado del EFE que nombra un rótulo, o `null` si es un renglón (el
 * contenido entre paréntesis no cuenta: "Aportes de socios (aumento …
 * en efectivo)" es un renglón, no la variación neta).
 */
function cashFlowLabelKind(label: string): CashFlowKind | null {
  const t = foldLabel(label).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ');
  const cash = /\b(?:efectivo|caja|cash)\b/;
  if (cash.test(t) && /\b(?:inicio|inicial|apertura|beginning|opening)\b/.test(t)) return 'opening';
  if (cash.test(t) && /\b(?:final|cierre|end|closing)\b/.test(t)) return 'closing';
  if (/\b(?:aumento|disminucion|incremento|variacion)\b.*\bnet[oa]?\b.*\b(?:efectivo|caja)\b|\bnet (?:increase|decrease|change)\b/.test(t)) {
    return 'change';
  }
  if (/\b(?:flujos?|efectivo neto|net cash|total)\b/.test(t)) {
    if (/\boperaci|\boperating\b/.test(t)) return 'operating';
    if (/\binversi|\binvesting\b/.test(t)) return 'investing';
    if (/\bfinanciaci|\bfinancing\b/.test(t)) return 'financing';
  }
  return null;
}

/** Motivo por el que una fila del EFE comparativo no es copia del JSON (o `null`). */
function cashFlowRowIssue(
  label: string,
  primaryCell: string | null,
  comparativeCell: string,
  elements: CashFlowElement[],
): string | null {
  const vc = cellCents(comparativeCell);
  if (vc === null) return null;
  const vp = primaryCell === null ? null : cellCents(primaryCell);
  const signFree = NEGATIVE_LABEL.test(label.trim());
  const same = (a: bigint, b: bigint | null) => b !== null && (a === b || (signFree && absCents(a) === absCents(b)));
  const kind = cashFlowLabelKind(label);
  const pool = kind === null ? elements : elements.filter((e) => e.kind === kind);
  if (pool.some((e) => same(vc, e.comparative) && (vp === null || same(vp, e.primary)))) return null;
  const figure = comparativeCell.match(ANY_FIGURE)?.[0] ?? comparativeCell;
  if (vc !== ZERO_CENTS && elements.some((e) => e.comparative === -vc)) return `${figure} (signo invertido)`;
  if (elements.some((e) => e.comparative === vc)) return `${figure} (cifra de otro renglón del EFE comparativo)`;
  return figure;
}

// ── ECP ─────────────────────────────────────────────────────────────────────

type EquityRowJson = NiifReportJson['equityChanges']['rows'][number];
type EquityKey = (typeof EQUITY_FIGURE_KEYS)[number];
type EquityComponent = Exclude<EquityKey, 'total'>;
type EquityRowKind = 'opening' | 'closing' | 'balance' | 'movement';

/** Claves del JSON que agrega una columna del ECP según su encabezado (`null` = desconocida). */
function equityColumnKeys(header: string): EquityKey[] | null {
  const t = foldLabel(header.replace(/([a-z])([A-Z])/g, '$1 $2')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const keys: EquityKey[] = [];
  if (/\bsuperavit de capital\b|\bprima\b|\bshare premium\b/.test(t)) keys.push('primaColocacion');
  if (/\bcapital\b/.test(t) && !/capitaliz|superavit de capital/.test(t)) keys.push('capitalSocial');
  if (/\breservas?\b|\breserves?\b/.test(t)) {
    if (/\blegal\b/.test(t)) keys.push('reservaLegal');
    else if (/\b(?:otras|other|estatutari\w*|ocasional\w*)\b/.test(t)) keys.push('otrasReservas');
    else keys.push('reservaLegal', 'otrasReservas');
  }
  if (/acumulad|ejercicios anteriores|retained/.test(t)) keys.push('resultadosAcumulados');
  else if (/\b(?:resultados?|utilidad(?:es)?|perdidas?|ganancias?)\b.*\b(?:ejercicio|periodo)\b|\bprofit\b|\bnet income\b/.test(t)) {
    keys.push('resultadoEjercicio');
  }
  if (/\bori\b|\boci\b|otro resultado integral|other comprehensive|valorizaci|superavit por/.test(t)) keys.push('ori');
  // "Total patrimonio" es el total; "Total reservas" es la columna de reservas
  // (revisión F-html: se tomaba por el total del patrimonio y la fila honesta bloqueaba).
  if (keys.length === 0 && /\btotal\b/.test(t)) return ['total'];
  return keys.length > 0 ? keys : null;
}

/** Saldo de apertura, de cierre (del comparativo), saldo sin más, o movimiento. */
function equityRowKind(label: string, comparativeYear: string): EquityRowKind {
  const t = foldLabel(label);
  if (!/\bsaldos?\b|\bbalance\b/.test(t)) return 'movement';
  const dated = /31 de diciembre (?:de|del) (\d{4})|december 31,? (\d{4})/.exec(t);
  if (dated) return Number(dated[1] ?? dated[2]) < Number(comparativeYear) ? 'opening' : 'closing';
  if (/\b(?:inicio|inicial|apertura|1 de enero|beginning|opening)\b/.test(t)) return 'opening';
  if (/\b(?:cierre|final|closing|end)\b/.test(t)) return 'closing';
  return 'balance';
}

const BALANCE_KINDS = new Set(['opening_balance', 'closing_balance']);

/** Sumas de `base` con cada subconjunto de los componentes sin columna propia. */
function withUnassigned(base: bigint, extras: bigint[]): bigint[] {
  const out: bigint[] = [];
  for (let mask = 0; mask < 1 << extras.length; mask++) {
    let sum = base;
    for (let i = 0; i < extras.length; i++) if (mask & (1 << i)) sum += extras[i];
    out.push(sum);
  }
  return out;
}

/** Valores que la columna `keys` puede imprimir para la fila `r` del JSON. */
function equityCellCandidates(
  r: EquityRowJson,
  keys: EquityKey[] | null,
  unassigned: EquityComponent[],
): bigint[] {
  const value = (k: EquityKey) => moneyCents(r[k] as string) ?? ZERO_CENTS;
  if (keys === null) {
    // Encabezado no reconocido: cualquier celda o suma de columnas de la fila.
    return [
      ...EQUITY_FIGURE_KEYS.map(value),
      ...equityRowColumnSums(r as unknown as Record<string, unknown>).map((s) => BigInt(s)),
    ];
  }
  if (keys.includes('total')) return [value('total')];
  const base = keys.reduce((acc, k) => acc + value(k), ZERO_CENTS);
  const extras = unassigned.map(value).filter((v) => v !== ZERO_CENTS);
  return withUnassigned(base, extras);
}

/**
 * Motivo por el que una fila del ECP del periodo comparativo no es copia de
 * una fila del JSON (o `null`). `candidates` ya viene filtrado por el rótulo.
 */
function equityRowIssue(
  label: string,
  cells: string[],
  columnKeys: Array<EquityKey[] | null>,
  candidates: EquityRowJson[],
): string | null {
  const signFree = NEGATIVE_LABEL.test(label.trim());
  const assigned = new Set(columnKeys.flatMap((k) => k ?? []));
  const unassigned = EQUITY_COMPONENT_KEYS.filter((k) => !assigned.has(k));
  const printed = cells.map((c, i) => (i === 0 ? null : cellCents(c)));
  let best: { misses: number[] } | null = null;
  for (const r of candidates) {
    const misses: number[] = [];
    for (let i = 1; i < cells.length; i++) {
      const v = printed[i];
      if (v === null) continue;
      const ok = equityCellCandidates(r, columnKeys[i] ?? null, unassigned).some(
        (c) => c === v || (signFree && absCents(c) === absCents(v)),
      );
      if (!ok) misses.push(i);
    }
    if (misses.length === 0) return null;
    if (best === null || misses.length < best.misses.length) best = { misses };
  }
  const shownCells = best
    ? best.misses
    : cells.map((_, i) => i).filter((i) => i > 0 && printed[i] !== null && printed[i] !== ZERO_CENTS);
  if (shownCells.length === 0) return null;
  // Pista para el reintento: la magnitud existe en la fila pero con el otro signo.
  const flipped = (i: number) => {
    const v = printed[i];
    return (
      v !== null &&
      v !== ZERO_CENTS &&
      candidates.some((r) => equityCellCandidates(r, columnKeys[i] ?? null, unassigned).some((c) => c === -v))
    );
  };
  return shownCells
    .map((i) => `${cells[i].match(ANY_FIGURE)?.[0] ?? cells[i]}${flipped(i) ? ' (signo invertido)' : ''}`)
    .join(', ');
}

function checkComparativeStatements(
  document: ParsedDocument,
  text: string,
  niif: NiifReportJson,
): ChecklistFailure[] {
  const out: ChecklistFailure[] = [];
  const cy = yearOf(niif?.company?.comparativePeriod ?? null);
  const py = yearOf(niif?.company?.fiscalPeriod ?? null);
  const cf = niif?.cashFlow;
  const eq = niif?.equityChanges;
  if (!cy || !cf || !eq) return out;

  const cfHasComparative =
    [cf.netChangeComparative, cf.cashOpeningComparative, cf.cashClosingComparative].every(
      (v) => v !== null && v !== undefined,
    ) && cf.sections.every((s) => s.netFlowComparative !== null && s.netFlowComparative !== undefined);
  const cfElements = cfHasComparative ? cashFlowElements(cf) : [];
  const comparativeRows = eq.comparativeRows ?? null;
  const currentRows = eq.rows ?? [];
  // ECP presentado a dos columnas por año (resumen): pertenencia a las celdas
  // de sus filas, como antes (la plantilla v10.1 lo presenta por componentes).
  const eqAllowed = renderingsOf(
    [...(comparativeRows ?? []), ...currentRows].flatMap((r) => [
      ...EQUITY_FIGURE_KEYS.map((k) => (typeof r[k] === 'string' ? (r[k] as string) : null)),
      ...equityRowColumnSums(r as unknown as Record<string, unknown>),
    ]),
  );

  /** Filas del JSON contra las que se cruza una fila del ECP comparativo. */
  const equityCandidates = (label: string, inComparativeBlock: boolean): EquityRowJson[] => {
    const kind = equityRowKind(label, cy);
    const cmp = comparativeRows ?? [];
    const currentOpening = currentRows.filter((r) => r.kind === 'opening_balance');
    switch (kind) {
      case 'opening':
        return cmp.filter((r) => r.kind === 'opening_balance');
      case 'closing':
        // El cierre del comparativo es la apertura del periodo actual.
        return [...cmp.filter((r) => r.kind === 'closing_balance'), ...currentOpening];
      case 'balance':
        return [...cmp.filter((r) => BALANCE_KINDS.has(r.kind)), ...currentOpening];
      default: {
        const movements = cmp.filter((r) => !BALANCE_KINDS.has(r.kind));
        // Fila identificada sólo por el año de su rótulo ("Traslado del
        // resultado 2024" es un movimiento del periodo ACTUAL): se admiten
        // también los movimientos del periodo actual.
        return inComparativeBlock ? movements : [...movements, ...currentRows.filter((r) => !BALANCE_KINDS.has(r.kind))];
      }
    }
  };

  const cfForeign: string[] = [];
  const eqForeign: string[] = [];
  let cfColumnPrinted = false;
  let eqRowsPrinted = false;
  for (const { table, heading } of tablesWithHeading(document)) {
    const isCashFlow = CASH_FLOW_HEADING.test(heading);
    const isEquity = !isCashFlow && EQUITY_HEADING.test(heading);
    if (!isCashFlow && !isEquity) continue;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) continue;
    const headers = cellTexts(rows[0]);
    const cIdx = yearColumn(headers, cy, py);
    const pIdx = yearColumn(headers, py, cy);
    const columnKeys = headers.map((h, i) => (i === 0 ? null : equityColumnKeys(h)));
    let block: 'none' | 'comparative' | 'current' = 'none';
    for (const row of rows.slice(1)) {
      const cells = cellTexts(row);
      if (cells.length === 0) continue;
      const label = cells[0];
      const rest = cells.slice(1);
      const isBlockHeader = rest.every((c) => c === '' || c === '—' || c === '-');
      if (isBlockHeader) {
        // "Periodo 2024" abre el bloque comparativo; "Periodo 2025" lo cierra.
        if (label.includes(cy) && !(py && label.includes(py))) block = 'comparative';
        else if (py && label.includes(py)) block = 'current';
        continue;
      }
      if (cIdx > 0 && cells.length === headers.length) {
        const comparativeCell = cells[cIdx];
        if ((comparativeCell.match(ANY_FIGURE) ?? []).length === 0) continue;
        if (isCashFlow) {
          cfColumnPrinted = true;
          if (!cfHasComparative) {
            cfForeign.push(...foreignFigures(comparativeCell, renderingsOf([])).map((f) => `${label}: ${f}`));
            continue;
          }
          const issue = cashFlowRowIssue(label, pIdx > 0 ? cells[pIdx] : null, comparativeCell, cfElements);
          if (issue) cfForeign.push(`${label}: ${issue}`);
        } else {
          eqRowsPrinted = true;
          eqForeign.push(...foreignFigures(comparativeCell, eqAllowed).map((f) => `${label}: ${f}`));
        }
        continue;
      }
      // Rotulada con el año comparativo, o saldo rotulado con un corte anterior
      // ("Saldo al 31 de diciembre de 2023", apertura del comparativo).
      const labelledComparative =
        (label.includes(cy) && !(py && label.includes(py))) ||
        (/\bsaldos?\b|\bbalance\b/i.test(label) &&
          [...label.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].some((m) => Number(m[1]) < Number(cy)));
      if (!isEquity || !(block === 'comparative' || labelledComparative)) continue;
      if (!rest.some((c) => (c.match(ANY_FIGURE) ?? []).length > 0)) continue;
      eqRowsPrinted = true;
      const candidates = equityCandidates(label, block === 'comparative');
      const issue =
        cells.length === headers.length
          ? equityRowIssue(label, cells, columnKeys, candidates)
          : equityRowIssue(label, cells, cells.map(() => null), candidates);
      if (issue) eqForeign.push(`${label}: ${issue}`);
    }
  }

  const describe = (items: string[]) => `${items.slice(0, 5).join('; ')}${items.length > 5 ? ' …' : ''}`;
  if (cfForeign.length > 0) {
    out.push({
      rule: R8_RULE,
      detail: cfHasComparative
        ? `El EFE imprime en la columna ${cy} cifras que no son las del EFE comparativo del reporte NIIF en esa ` +
          `fila (${describe(cfForeign)}). El comparativo del EFE lo calcula el sistema: se copia, no se redacta.`
        : `El EFE imprime una columna ${cy} (${describe(cfForeign)}) y el reporte NIIF no presenta EFE ` +
          `comparativo: ${cf.comparativeNote ?? 'sin base determinista'}`,
      severity: 'block',
    });
  }
  if (eqForeign.length > 0) {
    out.push({
      rule: R8_RULE,
      detail: comparativeRows
        ? `El ECP imprime para el periodo ${cy} filas que no son las del ECP comparativo del reporte NIIF ` +
          `(${describe(eqForeign)}). El comparativo del ECP lo calcula el sistema: se copia, no se redacta.`
        : `El ECP imprime filas del periodo ${cy} (${describe(eqForeign)}) y el reporte NIIF no presenta ECP ` +
          `comparativo: ${eq.comparativeNote ?? 'sin base determinista'}`,
      severity: 'block',
    });
  }

  // Sin comparativo del estado, su nota determinista debe quedar a la vista.
  const flat = text.replace(/\s+/g, ' ');
  for (const [statement, note, printed] of [
    ['EFE', cfHasComparative ? null : cf.comparativeNote ?? null, cfColumnPrinted],
    ['ECP', comparativeRows ? null : eq.comparativeNote ?? null, eqRowsPrinted],
  ] as const) {
    if (!note || printed) continue;
    if (flat.includes(note.replace(/\s+/g, ' ').replace(/\$\s+/g, '$'))) continue;
    out.push({
      rule: R8_NOTE_RULE,
      detail:
        `El ${statement} no presenta el periodo ${cy} y el HTML no copia la nota determinista que lo explica: ` +
        `"${note}".`,
      severity: 'warn',
    });
  }
  return out;
}

const EQUITY_FIGURE_KEYS = [
  'capitalSocial',
  'primaColocacion',
  'reservaLegal',
  'otrasReservas',
  'resultadosAcumulados',
  'resultadoEjercicio',
  'ori',
  'total',
] as const;

/** Columnas de componentes del ECP (sin el total), las que la plantilla puede agregar. */
const EQUITY_COMPONENT_KEYS = EQUITY_FIGURE_KEYS.filter((k): k is EquityComponent => k !== 'total');

/**
 * Sumas (MoneyCop) de todo subconjunto de dos o más columnas de componentes
 * no nulas de UNA fila del ECP: lo que puede imprimir una columna cuyo
 * encabezado no se reconoce. Siete componentes a lo sumo → ≤ 120 sumas por fila.
 */
function equityRowColumnSums(row: Record<string, unknown>): string[] {
  const values: bigint[] = [];
  for (const k of EQUITY_COMPONENT_KEYS) {
    const v = row[k];
    if (typeof v !== 'string') continue;
    try {
      const c = parseMoneyCop(v);
      if (c !== BigInt(0)) values.push(c);
    } catch {
      /* no es MoneyCop */
    }
  }
  const out: string[] = [];
  for (let mask = 1; mask < 1 << values.length; mask++) {
    if ((mask & (mask - 1)) === 0) continue; // una sola columna: ya es una celda
    let sum = BigInt(0);
    for (let i = 0; i < values.length; i++) if (mask & (1 << i)) sum += values[i];
    out.push(sum.toString());
  }
  return out;
}

// ---------------------------------------------------------------------------
// R6 — conceptos anclados en prosa, resúmenes y cifras abreviadas (e2e-niif-11)
// ---------------------------------------------------------------------------
// R1 sólo exige que la cifra vinculante aparezca en ALGÚN lugar y R5 sólo lee
// encabezados: un <p> con "pérdida neta … $4.000.000,00" (real $40M), "EBITDA
// positivo de $20.000.000,00" (real −$20M), "ROE de 25,0 %" (real −80 % o N/D)
// y "estados al 31 de diciembre de 2024" en un informe 2025, o una tabla
// resumen con "Utilidad neta | $4.000 M", salían emittable=true. Aquí cada
// mención de un concepto con ancla conocida se cruza con la PRIMERA cifra que
// la sigue en la misma frase o fila (completa o abreviada, a su precisión):
// vale la del periodo actual o la del comparativo; una variación ("disminuyó
// $10M") no se juzga. Sin ancla para el concepto no se acusa nada.
//
// El núcleo (conceptos, ventana, signo, ROE, fecha de corte) vive en
// `validators/narrative-anchors.ts` y es el mismo que cruza la prosa de las
// Partes II y III antes de que lleguen al HTML (pendiente #2 de la auditoría
// integral 2026-09-24). Aquí sólo se leen las unidades de texto del DOM.
//
// Re-auditoría final de la fase 2 (narrativa-08): R6 juzgaba sin las
// exenciones con que el mismo núcleo cruza la prosa de la Parte II, así que la
// prosa que la Parte II acepta dejaba el HTML en BORRADOR: una proyección
// ("Para 2026 se proyecta una utilidad neta de $30M"), una meta, el impacto de
// una recomendación ("Elevar la utilidad neta a $30 M y el EBITDA en $12 M",
// página 13 de la plantilla), un inciso ("el 10 % de la utilidad neta
// ($20M)") o un componente ("el total de activos se concentra en el efectivo,
// con $50M"). Ahora R6 usa las mismas opciones que la Parte II
// (`skipForwardLooking`, `lenientProse`, año del periodo) y marca como
// propuesta —igual que la acción y el impacto de una recomendación en la
// Parte II— la prosa de las secciones de recomendaciones, plan de acción,
// próximo cierre y proyección, y toda frase que empieza en infinitivo (el
// "imperativo suave" con que la spec v10.1 redacta las recomendaciones),
// salvo la frase que AFIRMA un saldo ("fue de", "asciende a", "cerró en"),
// que se sigue juzgando. Las filas de tabla conservan el modo estricto salvo
// en una tabla de proyección. Límite documentado: una cifra sin verbo de saldo
// dentro de esas secciones ("Mantener la utilidad neta de $X") no la cruza R6;
// R1/R3 siguen exigiendo las cifras vinculantes con su signo.
//
// Revisión adversarial F-html: en una sección de recomendaciones, plan de
// acción o próximo cierre la exención ya no cubre TODA la prosa. La tarjeta de
// la página 13 mezcla el diagnóstico (que la Parte II sí juzga) con la acción y
// el impacto (que exime): "La utilidad neta de $4M limita el reparto" o
// "Utilidad neta: $4M" salían sin cruce. Ahora, dentro de esas secciones, sólo
// es propuesta la frase en infinitivo o la que trae una marca de propuesta o
// de impacto ("impacto", "mayor", "ahorro", "adicional", "meta", un futuro o
// condicional…); el resto se juzga como el diagnóstico de la Parte II. Una
// sección de PROYECCIÓN sigue exenta por completo, y también una sección de
// recomendaciones en inglés (encabezado en inglés o `<html lang="en">`): el
// imperativo inglés ("Raise EBITDA by $12 M") no se reconoce por su forma.

const R6_RULE = '§1.1 · Reconciliación JSON↔HTML — concepto anclado con otra cifra';

/** Encabezados de sección cuya prosa es propuesta, meta o impacto esperado. */
const PROPOSAL_SECTION =
  /recomendaci|plan\s+de\s+acci[oó]n|acciones?\s+(?:urgentes|prioritarias|recomendadas|propuestas|sugeridas|inmediatas)|pr[oó]ximo\s+cierre|pr[oó]ximos\s+pasos|recommendation|action\s+plan|next\s+steps|next\s+close|urgent\s+actions/i;
/** Encabezado de propuestas en inglés (el imperativo inglés no se reconoce por su forma). */
const PROPOSAL_SECTION_EN = /recommendation|action\s+plan|next\s+steps|next\s+close|urgent\s+actions/i;
/** Encabezados (o captions/cabeceras de tabla) de una proyección. */
const PROJECTION_SECTION = /proyecci[oó]n|proyectad[oa]s?|escenarios?\b|presupuest|projection|projected|scenarios?\b|forecast|budget/i;

/** Sustantivos y adjetivos terminados en -ar/-er/-ir que abren frases que no son acciones. */
const NOT_INFINITIVE = new Set([
  'lugar', 'similar', 'particular', 'regular', 'auxiliar', 'titular', 'familiar', 'popular', 'singular', 'escolar',
  'militar', 'dolar', 'pilar', 'hogar', 'bienestar', 'malestar', 'par', 'mar', 'bar', 'azar', 'alquiler', 'taller',
  'mujer', 'poder', 'deber', 'haber', 'placer', 'ayer', 'caracter', 'lider', 'master', 'super', 'primer', 'tercer',
  'cualquier', 'porvenir', 'other', 'under', 'over', 'after', 'never', 'either', 'whether', 'water', 'paper', 'order',
  'power', 'number', 'member', 'register', 'ever', 'however',
]);

/**
 * ¿La frase empieza con un verbo en infinitivo (con o sin pronombre
 * enclítico)? "Elevar la utilidad neta a $30 M…", "Mantenerla…",
 * "02 · Reducir la cartera…", "Acción: documentar…".
 */
function startsWithInfinitive(sentence: string): boolean {
  const head = sentence
    .replace(/^[\s\d.)(\-–—•·*:]+/, '')
    .replace(/^(?:acci[oó]n|recomendaci[oó]n|propuesta|paso)\s*\d*\s*[:.—–-]\s*/i, '');
  const word = /^[\p{L}]+/u.exec(head)?.[0];
  if (!word || word.length < 4) return false;
  const folded = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (NOT_INFINITIVE.has(folded)) return false;
  return /(?:ar|er|ir)(?:se|lo|la|los|las|le|les|nos)?$/.test(folded);
}

/**
 * Verbo que AFIRMA el saldo del periodo ("fue de", "asciende a", "cerró en",
 * "registró"): una frase así no es una propuesta aunque esté en la sección de
 * recomendaciones o empiece en infinitivo ("Destacar que la utilidad neta fue
 * de $X"), y se juzga.
 */
const STATEMENT_VERB =
  /\b(?:fue|fueron|es|son|era|eran)\s+de\b|\b(?:asciende|ascendi[oó]|ascendieron|totaliza|totaliz[oó]|suma|sum[oó]|cerr[oó]|registra|registr[oó]|alcanz[oó]|reporta|report[oó]|arroja|arroj[oó]|muestra|mostr[oó]|obtuvo|present[oó]|termin[oó])\b|\bse\s+(?:ubic[oó]|situ[oó])\b|\b(?:qued[oó]|cerr[oó])\s+en\b|\blleg[oó]\s+a\b/i;

/**
 * Marca de propuesta o de impacto esperado dentro de una sección de
 * recomendaciones: lo que la Parte II redacta en `action` / `expectedImpact`
 * ("Mayor utilidad neta en $3M", "Impacto esperado: …", "ahorro de $X", "la
 * utilidad neta llegaría a $X"). Sin ella, la frase es diagnóstico y se juzga.
 *
 * `PROPOSAL_MARK` cuenta en toda la frase (meta, impacto, proyección); los
 * comparativos y los verbos de `PROPOSAL_CUE` sólo ANTES de la primera cifra:
 * en "La utilidad neta de $4M es menor a la esperada" el "menor" califica un
 * saldo del periodo, que se juzga.
 */
const PROPOSAL_MARK =
  /\b(?:impacto|metas?|objetivos?|potencial(?:es)?|impact|target|goal)\b|proyect|estim|previst|presupuest|escenario|forecast|projected/i;
const PROPOSAL_CUE = new RegExp(
  String.raw`\b(?:efecto|ahorros?|adicional(?:es)?|esperad[oa]s?|mayor(?:es)?|menor(?:es)?|mejora|aumento|incremento|reducci[oó]n|disminuci[oó]n|liberaci[oó]n|recuperaci[oó]n|expected|additional|savings|increase|decrease|higher|lower)\b` +
    String.raw`|(?<![\p{L}])(?:aumentar|elevar|subir|incrementar|mejorar|reducir|disminuir|bajar|pasar|quedar|ubicar|situar|generar|liberar|cerrar|ascender|llevar|crecer|representar|alcanzar|lograr|permitir|llegar|ser|estar|tendr|habr|podr|deber|saldr|valdr|har)(?:[ií]an?|[áÁ]n?)(?![\p{L}])`,
  'iu',
);
/** Primera cifra de la frase ("$4.000.000,00", "$ 30 M", "4.000.000"). */
const FIRST_FIGURE = /\$\s*[(−-]?\s*\d|(?<![\d.,])\d{1,3}(?:\.\d{3})+(?![\d])/;

/** ¿La frase de una sección de recomendaciones es propuesta o impacto? */
function isProposalSentence(sentence: string, primaryYear: string | null): boolean {
  if (PROPOSAL_MARK.test(sentence)) return true;
  if (
    primaryYear &&
    [...sentence.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].some((m) => Number(m[1]) > Number(primaryYear))
  ) {
    return true;
  }
  const at = FIRST_FIGURE.exec(sentence)?.index ?? sentence.length;
  return PROPOSAL_CUE.test(sentence.slice(0, at));
}

/**
 * Separa las propuestas del resto de la unidad: toda frase de una sección de
 * proyección, la frase en infinitivo y, en una sección de recomendaciones, la
 * que trae una marca de propuesta o de impacto. Nunca la que afirma un saldo.
 */
function splitProposals(
  text: string,
  section: { proposal: boolean; projection: boolean; english: boolean },
  primaryYear: string | null,
): NarrativeUnit[] {
  const sentences = text.split(/(?<=[.;!?])\s+/);
  const isProposal = (s: string) =>
    (section.projection ||
      startsWithInfinitive(s) ||
      (section.proposal && (section.english || isProposalSentence(s, primaryYear)))) &&
    !STATEMENT_VERB.test(s);
  const proposals = sentences.filter(isProposal);
  if (proposals.length === 0) return [{ text, firstCell: null }];
  const rest = sentences.filter((s) => !isProposal(s)).join(' ');
  return [
    ...(rest ? [{ text: rest, firstCell: null }] : []),
    ...proposals.map((p) => ({ text: p, firstCell: null, forwardLooking: true })),
  ];
}

/** Tabla de proyección: caption/cabecera con palabras de proyección o sólo años futuros. */
function isProjectionTable(table: Element | null, primaryYear: string | null): boolean {
  if (!table) return false;
  const caption = (table.querySelector('caption')?.textContent ?? '').replace(/\s+/g, ' ');
  const headerRow = table.querySelector('tr');
  const header = headerRow ? cellTexts(headerRow).join(' ') : '';
  if (PROJECTION_SECTION.test(caption) || PROJECTION_SECTION.test(header)) return true;
  if (!primaryYear) return false;
  const years = [...header.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].map((m) => Number(m[1]));
  return years.length > 0 && years.every((y) => y > Number(primaryYear));
}

/** Texto de las unidades que el lector ve como una frase o una fila. */
function textUnits(document: ParsedDocument, primaryYear: string | null = null): NarrativeUnit[] {
  const clean = (t: string) =>
    t.replace(/\u00a0/g, ' ').replace(/\$\s+/g, '$').replace(/\s+/g, ' ').trim();
  const out: NarrativeUnit[] = [];
  let article: Element | null = null;
  // Encabezados vigentes (por nivel) dentro de la página: una sección de
  // recomendaciones o de proyección rige hasta un encabezado de igual o mayor
  // rango, o hasta la página siguiente.
  let stack: Array<{ level: number; proposal: boolean; english: boolean; projection: boolean }> = [];
  const htmlEnglish = /^en\b/i.test(document.documentElement?.getAttribute('lang') ?? '');
  const nodes = document.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, p, li, caption, figcaption, blockquote, dd, dt, tr',
  );
  for (const el of Array.from(nodes)) {
    const owner = el.closest('article');
    if (owner !== article) {
      article = owner;
      stack = [];
    }
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const t = clean(el.textContent ?? '');
      stack = stack.filter((h) => h.level < level);
      stack.push({
        level,
        proposal: PROPOSAL_SECTION.test(t),
        english: PROPOSAL_SECTION_EN.test(t),
        projection: PROJECTION_SECTION.test(t),
      });
    }
    const projection = stack.some((h) => h.projection);
    const proposal = stack.some((h) => h.proposal);
    const english = htmlEnglish || stack.some((h) => h.proposal && h.english);
    if (tag === 'tr') {
      const cells = Array.from(el.querySelectorAll('th, td')).map((c) => clean(c.textContent ?? ''));
      if (cells.length < 2) continue;
      const forward = projection || isProjectionTable(el.closest('table'), primaryYear);
      out.push({ text: cells.join(' | '), firstCell: cells[0], ...(forward ? { forwardLooking: true } : {}) });
      continue;
    }
    // Un bloque que contiene <p>/<li> se lee por sus hijos.
    if (el.querySelector('p, li')) continue;
    const text = clean(el.textContent ?? '');
    if (!text) continue;
    out.push(...splitProposals(text, { proposal, projection, english }, primaryYear));
  }
  return out;
}

// ---------------------------------------------------------------------------
// R7 — KPI de la Parte II publicado N/D (o recalculado) con la cifra del modelo
// ---------------------------------------------------------------------------
// Pendiente #2 de la auditoría integral 2026-09-24: un KPI sin ancla
// determinista se publica N/D y uno recomputable con el valor del sistema. El
// Editor Jefe ya recibe el JSON anclado, pero la cifra del modelo puede seguir
// viva en otra prosa del payload: si reaparece junto al nombre del KPI (fila,
// tarjeta o frase), el HTML imprime una cifra sin base.
//
// Re-auditoría fase 2 (narrativa-15): sólo se cazaba la escritura exacta junto
// al nombre exacto; "24 %" (23,7 redondeado) o "margen de EBITDA ajustado"
// pasaban. El reconocedor es ahora el mismo con que `applyKpiAnchors` sanea la
// prosa de la Parte II (`kpiNamePattern` + `discardedFigureHits`): nombre
// plegado con conectores opcionales y cifra a la precisión impresa, sin la
// banda sectorial ni la cifra que el sistema sí publica.

const R7_RULE = '§1.1 · Reconciliación JSON↔HTML — KPI sin ancla con la cifra del modelo';

function checkDiscardedKpiFigures(
  document: ParsedDocument,
  discarded: DiscardedKpiFigure[],
): ChecklistFailure[] {
  if (discarded.length === 0) return [];
  const units = textUnits(document).map((u) => u.text);
  const out: ChecklistFailure[] = [];
  const seen = new Set<string>();
  for (const d of discarded) {
    const re = kpiNamePattern(d.name);
    if (!re) continue;
    const key = `${d.name}|${d.value}`;
    for (const text of units) {
      if (seen.has(key)) break;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (discardedFigureHits(kpiMentionWindow(text, m.index + m[0].length), d).length === 0) continue;
        seen.add(key);
        out.push({
          rule: R7_RULE,
          detail:
            `El KPI "${d.name}" se publica N/D o recalculado por el sistema, pero el HTML imprime la cifra ` +
            `que estimó el modelo (${d.unit === 'cop' ? formatCopFromCents(parseMoneyCop(d.value), false) : d.value}).`,
          severity: 'block',
        });
        break;
      }
    }
  }
  return out;
}

function checkAnchoredConceptsInText(
  document: ParsedDocument,
  input: ReconciliationInput,
): ChecklistFailure[] {
  const sources = narrativeSourcesFromPreprocessed(input.preprocessed ?? null, input.niifReport);
  const primaryYear = yearOf(input.niifReport?.company?.fiscalPeriod);
  // El JSON NIIF manda en el HTML (lo que el Editor Jefe recibe como vinculante);
  // sin preprocesado no hay ingresos, EBITDA ni ROE contra los cuales cruzar.
  const units = textUnits(document, primaryYear);
  const concepts = buildNarrativeConcepts(sources);
  // Mismas exenciones que la prosa de la Parte II (narrativa-08). Los mensajes
  // van en español, como el resto de las reglas del validador.
  const options: NarrativeCheckOptions = {
    language: 'es',
    subject: { es: 'el HTML', en: 'the HTML' },
    skipForwardLooking: true,
    lenientProse: true,
    primaryYear,
  };
  const money = checkNarrativeUnits(units, concepts, options);
  const roe = checkRoeUnits(units, sources.primary, sources.comparative, options);
  const out: ChecklistFailure[] = [...money.findings, ...roe.findings].map((f) => ({
    rule: R6_RULE,
    detail: f.detail,
    severity: 'block' as const,
  }));
  const foreign = findForeignCutoffYears(units, primaryYear);
  if (foreign.length > 0) {
    out.push({
      rule: '§1.1 · Periodo del reporte — fecha de corte',
      detail:
        `El texto declara estados con corte al 31 de diciembre de ${foreign.join(', ')} y el reporte NIIF ` +
        `corresponde al periodo ${primaryYear}.`,
      severity: 'block',
    });
  }
  return out;
}

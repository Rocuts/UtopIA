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
  windowAfter,
  type NarrativeUnit,
} from '../validators/narrative-anchors';
import {
  applyKpiAnchors,
  discardedKpiFigures,
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
  const titlesByMode: Record<string, string[]> = {
    LINEA_BASE: [
      'el ejercicio',
      'composición del período',
      'composicion del periodo',
    ],
    TRANSICION: ['lo comparable y lo nuevo', 'lo comparable y lo establecido'],
    COMPARATIVO_COMPLETO: [
      'movimientos del año',
      'movimientos del ano',
      'tres movimientos clave',
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
  const figures: BindingFigure[] = collectBindingFigures(input.niifReport);

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
  const bs = niif.balanceSheet;
  const is = niif.incomeStatement;
  const concepts: Array<{ re: RegExp; label: string; primary: string | null; comparative: string | null }> = [
    { re: /^total\s+(?:de\s+)?activos?$/i, label: 'Total Activo', primary: bs?.totalAssetsPrimary ?? null, comparative: bs?.totalAssetsComparative ?? null },
    { re: /^total\s+(?:de\s+)?pasivos?$/i, label: 'Total Pasivo', primary: bs?.totalLiabilitiesPrimary ?? null, comparative: bs?.totalLiabilitiesComparative ?? null },
    { re: /^total\s+(?:del?\s+)?patrimonio$/i, label: 'Total Patrimonio', primary: bs?.totalEquityPrimary ?? null, comparative: bs?.totalEquityComparative ?? null },
    { re: /^(?:utilidad|resultado)\s+neto?a?(?:\s+del\s+ejercicio)?$/i, label: 'Utilidad Neta', primary: is?.netIncomePrimary ?? null, comparative: is?.netIncomeComparative ?? null },
  ];
  const renders = (v: string | null): string[] => {
    if (v === null) return [];
    try {
      const c = parseMoneyCop(v);
      return acceptableRenderings(c < BigInt(0) ? -c : c);
    } catch {
      return [];
    }
  };
  for (const table of Array.from(document.querySelectorAll('table'))) {
    const headerRow = table.querySelector('tr');
    if (!headerRow) continue;
    const headers = Array.from(headerRow.querySelectorAll('th, td')).map((c) => (c.textContent ?? '').trim());
    const pIdx = headers.findIndex((h) => h === primaryYear || h.endsWith(` ${primaryYear}`));
    const cIdx = comparativeYear
      ? headers.findIndex((h) => h === comparativeYear || h.endsWith(` ${comparativeYear}`))
      : -1;
    if (pIdx < 0) continue;
    for (const row of Array.from(table.querySelectorAll('tr')).slice(1)) {
      const cells = Array.from(row.querySelectorAll('th, td')).map((c) =>
        (c.textContent ?? '').replace(/ /g, ' ').replace(/\$\s+/g, '$').trim(),
      );
      if (cells.length !== headers.length) continue;
      const concept = concepts.find((k) => k.re.test(cells[0].replace(/\s+/g, ' ')));
      if (!concept) continue;
      // Sólo celdas con la cifra completa: una tabla de resumen con montos
      // abreviados ($1.000 M, §1.9/L38) no es un estado financiero.
      if (!/\$\d{1,3}(?:\.\d{3})+(?:,\d{2})?(?![.,]?\d)/.test(cells[pIdx])) continue;
      if (/\$[\d.,]+\s*(?:M{1,2}\b|mil(?:es)?\b|millones\b)/i.test(cells[pIdx])) continue;
      const inPrimary = renders(concept.primary).some((r) => containsFigure(cells[pIdx], r));
      const primaryHasComparative = renders(concept.comparative).some((r) => containsFigure(cells[pIdx], r));
      const comparativeOk =
        cIdx < 0 || concept.comparative === null || renders(concept.comparative).some((r) => containsFigure(cells[cIdx], r));
      if (concept.primary !== null && renders(concept.primary).length > 0 && (!inPrimary || !comparativeOk)) {
        out.push({
          rule: '§1.1 · Periodo del reporte — columna',
          detail:
            `${concept.label}: la columna ${primaryYear} imprime "${cells[pIdx]}"` +
            `${primaryHasComparative ? ', que es la cifra del periodo comparativo (columnas intercambiadas)' : ''}; ` +
            `el reporte NIIF da ${renders(concept.primary)[0]} para ${primaryYear}.`,
          severity: 'block',
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// R8 — comparativos del EFE y del ECP (integración I2)
// ---------------------------------------------------------------------------
// Desde el pendiente #3 la columna comparativa del EFE y las filas del ECP del
// periodo comparativo las calcula el código (o las deja sin presentar con una
// nota). El Editor Jefe las recibe preformateadas; aquí se exige que toda
// cifra que el HTML imprima como comparativo de esos dos estados esté en el
// JSON NIIF. Sin base determinista (dos cortes) el conjunto admitido es vacío:
// cualquier cifra de la columna comparativa del EFE es inventada. En el ECP
// se admiten además las cifras de sus filas del periodo actual, porque el
// saldo inicial del periodo es el cierre del comparativo y puede rotularse
// "Saldo al 31 de diciembre de <comparativo>".
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
const ABBREVIATED = /\$[\d.,]+\s*(?:M{1,2}\b|mil(?:es)?\b|millones\b)/i;

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
  const cfAllowed = cfHasComparative
    ? renderingsOf([
        ...cf.sections.flatMap((s) => [s.netFlowComparative, ...s.lines.map((l) => l.amountComparative)]),
        cf.netChangeComparative,
        cf.cashOpeningComparative,
        cf.cashClosingComparative,
      ])
    : renderingsOf([]);
  const comparativeRows = eq.comparativeRows ?? null;
  const equityCells = (rows: ReadonlyArray<Record<string, unknown>>) =>
    rows.flatMap((r) =>
      EQUITY_FIGURE_KEYS.map((k) => (typeof r[k] === 'string' ? (r[k] as string) : null)),
    );
  const eqAllowed = renderingsOf([
    ...equityCells(comparativeRows ?? []),
    ...equityCells(eq.rows ?? []),
  ]);

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
    const cIdx = headers.findIndex((h, i) => i > 0 && (h === cy || h.endsWith(` ${cy}`)));
    const allowed = isCashFlow ? cfAllowed : eqAllowed;
    const sink = isCashFlow ? cfForeign : eqForeign;
    let inComparativeBlock = false;
    for (const row of rows.slice(1)) {
      const cells = cellTexts(row);
      if (cells.length === 0) continue;
      const label = cells[0];
      const rest = cells.slice(1);
      const isBlockHeader = rest.every((c) => c === '' || c === '—' || c === '-');
      if (isBlockHeader) {
        // "Periodo 2024" abre el bloque comparativo; "Periodo 2025" lo cierra.
        if (label.includes(cy) && !(py && label.includes(py))) inComparativeBlock = true;
        else if (py && label.includes(py)) inComparativeBlock = false;
        continue;
      }
      if (cIdx > 0 && cells.length === headers.length) {
        const figs = foreignFigures(cells[cIdx], allowed);
        if ((cells[cIdx].match(ANY_FIGURE) ?? []).length > 0) {
          if (isCashFlow) cfColumnPrinted = true;
          else eqRowsPrinted = true;
        }
        sink.push(...figs.map((f) => `${label}: ${f}`));
        continue;
      }
      if (isEquity && (inComparativeBlock || (label.includes(cy) && !(py && label.includes(py))))) {
        const figs = rest.flatMap((c) => foreignFigures(c, allowed));
        if (rest.some((c) => (c.match(ANY_FIGURE) ?? []).length > 0)) eqRowsPrinted = true;
        sink.push(...figs.map((f) => `${label}: ${f}`));
      }
    }
  }

  const describe = (items: string[]) => `${items.slice(0, 5).join('; ')}${items.length > 5 ? ' …' : ''}`;
  if (cfForeign.length > 0) {
    out.push({
      rule: R8_RULE,
      detail: cfHasComparative
        ? `El EFE imprime en la columna ${cy} cifras que no están en el EFE comparativo del reporte NIIF ` +
          `(${describe(cfForeign)}). El comparativo del EFE lo calcula el sistema: se copia, no se redacta.`
        : `El EFE imprime una columna ${cy} (${describe(cfForeign)}) y el reporte NIIF no presenta EFE ` +
          `comparativo: ${cf.comparativeNote ?? 'sin base determinista'}`,
      severity: 'block',
    });
  }
  if (eqForeign.length > 0) {
    out.push({
      rule: R8_RULE,
      detail: comparativeRows
        ? `El ECP imprime para el periodo ${cy} cifras que no están en el ECP comparativo del reporte NIIF ` +
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

const R6_RULE = '§1.1 · Reconciliación JSON↔HTML — concepto anclado con otra cifra';
const R6_OPTIONS = { language: 'es' as const, subject: { es: 'el HTML', en: 'the HTML' } };

/** Texto de las unidades que el lector ve como una frase o una fila. */
function textUnits(document: ParsedDocument): NarrativeUnit[] {
  const clean = (t: string) =>
    t.replace(/\u00a0/g, ' ').replace(/\$\s+/g, '$').replace(/\s+/g, ' ').trim();
  const out: NarrativeUnit[] = [];
  const blocks = document.querySelectorAll(
    'p, li, h1, h2, h3, h4, h5, h6, caption, figcaption, blockquote, dd, dt',
  );
  for (const el of Array.from(blocks)) {
    // Un bloque que contiene <p>/<li> se lee por sus hijos.
    if (el.querySelector('p, li')) continue;
    out.push({ text: clean(el.textContent ?? ''), firstCell: null });
  }
  for (const row of Array.from(document.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('th, td')).map((c) => clean(c.textContent ?? ''));
    if (cells.length < 2) continue;
    out.push({ text: cells.join(' | '), firstCell: cells[0] });
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

const R7_RULE = '§1.1 · Reconciliación JSON↔HTML — KPI sin ancla con la cifra del modelo';

const foldText = (t: string) =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

/** Formas impresas de la cifra descartada (regex sobre texto plegado). */
function discardedPatterns(d: DiscardedKpiFigure): RegExp[] {
  if (d.unit === 'cop') {
    let cents: bigint;
    try {
      cents = parseMoneyCop(d.value);
    } catch {
      return [];
    }
    return acceptableRenderings(cents).map((r) => new RegExp(`${escapeRegExp(r)}(?![.,]?\\d)`));
  }
  const m = /^[-+−]?\s*(\d+)(?:[.,](\d+))?/.exec(d.value.trim());
  if (!m) return [];
  const [, int, dec] = m;
  // "23,7" / "23.7" / "23,70"; un entero de un dígito es demasiado ambiguo.
  if (!dec && int.length < 2) return [];
  const decimals = dec ? `[.,]${escapeRegExp(dec)}0*` : '(?:[.,]0+)?';
  return [new RegExp(`(?<![\\d.,])${escapeRegExp(int)}${decimals}(?![\\d]|[.,]\\d)`)];
}

function checkDiscardedKpiFigures(
  document: ParsedDocument,
  discarded: DiscardedKpiFigure[],
): ChecklistFailure[] {
  if (discarded.length === 0) return [];
  const units = textUnits(document).map((u) => foldText(u.text));
  const out: ChecklistFailure[] = [];
  const seen = new Set<string>();
  for (const d of discarded) {
    const name = foldText(d.name).trim();
    if (name.length < 3) continue;
    const band = foldText(d.band).trim();
    const patterns = discardedPatterns(d);
    if (patterns.length === 0) continue;
    for (const text of units) {
      const at = text.indexOf(name);
      if (at < 0) continue;
      // Lo que sigue al nombre en la misma fila o frase, sin la banda sectorial.
      let tail = windowAfter(text, at + name.length, []);
      if (band) tail = tail.split(band).join(' ');
      if (!patterns.some((re) => re.test(tail))) continue;
      const key = `${d.name}|${d.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: R7_RULE,
        detail:
          `El KPI "${d.name}" se publica N/D o recalculado por el sistema, pero el HTML imprime la cifra ` +
          `que estimó el modelo (${d.unit === 'cop' ? formatCopFromCents(parseMoneyCop(d.value), false) : d.value}).`,
        severity: 'block',
      });
    }
  }
  return out;
}

function checkAnchoredConceptsInText(
  document: ParsedDocument,
  input: ReconciliationInput,
): ChecklistFailure[] {
  const sources = narrativeSourcesFromPreprocessed(input.preprocessed ?? null, input.niifReport);
  // El JSON NIIF manda en el HTML (lo que el Editor Jefe recibe como vinculante);
  // sin preprocesado no hay ingresos, EBITDA ni ROE contra los cuales cruzar.
  const units = textUnits(document);
  const concepts = buildNarrativeConcepts(sources);
  const money = checkNarrativeUnits(units, concepts, R6_OPTIONS);
  const roe = checkRoeUnits(units, sources.primary, sources.comparative, R6_OPTIONS);
  const out: ChecklistFailure[] = [...money.findings, ...roe.findings].map((f) => ({
    rule: R6_RULE,
    detail: f.detail,
    severity: 'block' as const,
  }));
  const primaryYear = yearOf(input.niifReport?.company?.fiscalPeriod);
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

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
  type BindingFigure,
  type HtmlEditorMetadata,
} from '../contracts/html-editor';
import type { NiifReportJson } from '../contracts/niif-report';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';

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

  // ── R2 · cifras del HTML que no se rastrean al payload ───────────────────
  const allowed = collectPayloadRenderings(input);
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

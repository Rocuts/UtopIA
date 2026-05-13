// ---------------------------------------------------------------------------
// Validador profundo §11 spec v8.1 — 23 checks con linkedom DOM parser
// ---------------------------------------------------------------------------
//
// Amplía el linter ligero de `agents/html-editor.ts:lightweightChecklist`
// (que cubre §10 comments + §1.6 vocabulary + §5 hash sin DOM) hacia el
// checklist completo §11. Usa linkedom para parsear el HTML como DOM real,
// permitiendo queries selectores, conteo de celdas y validación estructural.
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
//   El comment "best-effort" en cada check documenta la limitación.
//
// Refs:
//   - docs/spec/financial-report-v8.1.md §11 (21 items checklist)
//   - docs/spec/financial-report-v8.1.md §1.6 (vocabulario prohibido)
//   - docs/spec/financial-report-v8.1.md §3 (narrativa por modo)
//   - docs/spec/financial-report-v8.1.md §5 Slide 12 (hash + transparencia)
// ---------------------------------------------------------------------------

import { parseHTML } from 'linkedom';
import type { HtmlEditorMetadata } from '../contracts/html-editor';

export interface ChecklistFailure {
  rule: string;
  detail: string;
  severity: 'block' | 'warn';
}

/**
 * Validador profundo §11 spec v8.1.
 *
 * El linter liviano en agents/html-editor.ts cubre los 3 checks más críticos
 * (§10 comments, §1.6 vocabulary, §5 hash) sin DOM. Este validador cubre el
 * §11 completo parseando el HTML con linkedom.
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

  // ── Check 1 · §10 mandatory HTML comments ─────────────────────────────────
  //
  // `report_mode` declarado en comentario HTML. Buscamos la presencia literal
  // del valor del modo en el HTML (los comentarios son texto plano).
  // Severity: block — sin esta declaración el consumer no puede rutear el
  // renderizado por modo.
  if (!html.includes(`REPORT_MODE: ${metadata.reportMode}`)) {
    failures.push({
      rule: '§10 · Check 1 — REPORT_MODE comment',
      detail: `Falta comentario <!-- REPORT_MODE: ${metadata.reportMode} --> en el HTML`,
      severity: 'block',
    });
  }

  // §10 — ENTITY comment
  if (!html.includes(`ENTITY: ${metadata.entityNit}`)) {
    failures.push({
      rule: '§10 · Check 1 — ENTITY comment',
      detail: `Falta comentario <!-- ENTITY: ${metadata.entityNit} --> en el HTML`,
      severity: 'block',
    });
  }

  // §10 — AGENT_VERSION comment
  if (!html.includes('AGENT_VERSION: 1+1 v8.1')) {
    failures.push({
      rule: '§10 · Check 1 — AGENT_VERSION comment',
      detail: 'Falta comentario <!-- AGENT_VERSION: 1+1 v8.1 --> en el HTML',
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
    const prohibitedVerbsLinea = [
      /\bmejoró\b/i,
      /\bcreció\b/i,
      /\baumentó\b/i,
      /\bse redujo\b/i,
      /\bevolución\b/i,
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

  // ── Check 3 · §3 Pullquote de carta rep legal coincide con modo ───────────
  //
  // best-effort: verificar que el pullquote referenciado en §3 esté presente.
  // Buscamos el texto canónico por modo como substring del HTML.
  // Severity: warn — la frase exacta puede ser adaptada a la entidad.
  const pullquotesByMode: Record<string, string[]> = {
    LINEA_BASE: ['punto cero', 'este ciclo cierra', 'se medirá contra esta base'],
    TRANSICION: ['donde es comparable', 'lo declaramos'],
    COMPARATIVO_COMPLETO: ['el año en una frase'],
  };
  const expectedPullquotes = pullquotesByMode[metadata.reportMode] ?? [];
  const htmlLower = html.toLowerCase();
  const hasPullquote = expectedPullquotes.some((phrase) =>
    htmlLower.includes(phrase.toLowerCase()),
  );
  if (expectedPullquotes.length > 0 && !hasPullquote) {
    failures.push({
      rule: '§3 · Check 3 — pullquote carta rep. legal',
      detail: `Modo ${metadata.reportMode}: ninguno de los pullquotes canónicos detectado. Esperados: ${expectedPullquotes.join(' | ')}`,
      severity: 'warn',
    });
  }

  // ── Check 4 · §3 Resumen ejecutivo titulado según modo ────────────────────
  //
  // Severidad: block — el spec §3 define los títulos exactos. Un título errado
  // indica que el agente ignoró el modo activo.
  const titlesByMode: Record<string, string[]> = {
    LINEA_BASE: [
      'composición del período',
      'tres lecturas para entender el ejercicio',
    ],
    TRANSICION: ['lo comparable y lo nuevo', 'lo comparable y lo establecido'],
    COMPARATIVO_COMPLETO: ['movimientos del año', 'tres movimientos clave del año'],
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

  // ── Check 5 · §3 Layout EEFF (slides 06, 07) coincide con modo ───────────
  //
  // best-effort DOM: buscar columna "[Comparable]" o "Δ%" según modo.
  // LINEA_BASE → columna "[ Comparable ]" o variante
  // COMPARATIVO_COMPLETO → Δ% en algún encabezado de tabla
  // Severity: warn — la presencia exacta depende de cómo renderizó el agente.
  if (metadata.reportMode === 'COMPARATIVO_COMPLETO') {
    const hasDelta =
      html.includes('Δ%') || html.includes('Δ %') || htmlLower.includes('variación');
    if (!hasDelta) {
      failures.push({
        rule: '§3 · Check 5 — layout EEFF modo COMPARATIVO_COMPLETO',
        detail: 'Modo COMPARATIVO_COMPLETO: columna Δ% no detectada en slides 06/07',
        severity: 'warn',
      });
    }
  }

  // ── Check 6 · §3 Columna [ Comparable ] presente y NO vacía en LINEA_BASE ─
  //
  // Severity: block — §11 lo lista explícitamente como requisito. En modo
  // LINEA_BASE el usuario necesita ver el placeholder futuro de comparabilidad.
  if (metadata.reportMode === 'LINEA_BASE') {
    const hasComparable =
      html.includes('[ Comparable') ||
      html.includes('[Comparable') ||
      htmlLower.includes('comparable 2026') ||
      htmlLower.includes('comparable →');
    if (!hasComparable) {
      failures.push({
        rule: '§3 · Check 6 — columna [ Comparable ] en LINEA_BASE',
        detail: 'Modo LINEA_BASE: columna "[ Comparable ]" ausente en slides 06/07 (estados financieros)',
        severity: 'block',
      });
    }
  }

  // ── Check 7 · Banner explicativo de modo presente arriba de EEFF ──────────
  //
  // best-effort DOM: buscar elemento con clase `mode-banner` o texto del banner.
  // Severity: warn — la implementación exacta del banner varía.
  const hasBanner =
    document.querySelector('[class*="mode-banner"]') !== null ||
    document.querySelector('[class*="banner"]') !== null ||
    html.includes('mode-banner') ||
    htmlLower.includes('modo del reporte') ||
    htmlLower.includes('modo activo');
  if (!hasBanner) {
    failures.push({
      rule: '§11 · Check 7 — banner de modo',
      detail: 'Banner explicativo del modo no detectado arriba de los estados financieros',
      severity: 'warn',
    });
  }

  // ── Check 8 · Cero $0 huérfanos sin nota ─────────────────────────────────
  //
  // Busca el patrón "$0" o "$0,00" no seguido de una nota referencial "[i]" o
  // footnote. best-effort: regex simple; no detecta todos los casos de layout.
  // Severity: block — §1.2 "Cero $0 huérfanos" es regla inviolable del spec.
  //
  // Why: el spec §1 R2 prohíbe explícitamente "$0" huérfano. Si el agente lo
  // emitió sin nota, incumple la regla de transparencia de datos.
  const orphanZeroPattern = /\$0(?:[,.]00)?\b(?!\s*(?:\[i\]|<sup|footnote|nota|note))/gi;
  const orphanZeroMatches = html.match(orphanZeroPattern);
  if (orphanZeroMatches && orphanZeroMatches.length > 0) {
    failures.push({
      rule: '§1.2 · Check 8 — $0 huérfanos sin nota',
      detail: `${orphanZeroMatches.length} ocurrencia(s) de "$0" sin nota referencial detectadas`,
      severity: 'block',
    });
  }

  // ── Check 9 · Toda suma cuadra aritméticamente (validación numérica DOM) ──
  //
  // best-effort: busca tables con clase 'eeff' o 'financiero' y verifica que
  // el último `<td>` de cada fila de total coincida con la suma de las celdas.
  // Por limitaciones de linkedom y de la representación numérica COP (puntos
  // como separadores de miles), este check opera sobre un subset de tablas.
  // Severity: block — el spec §1.1 exige que toda suma cuadre.
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const rows = table.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) continue;
      // Solo filas que parecen totales (última celda con clase 'total' o texto "Total")
      const lastCell = cells[cells.length - 1];
      const isTotal =
        (lastCell.getAttribute('class') ?? '').includes('total') ||
        (row.querySelector('th, td:first-child')?.textContent ?? '').toLowerCase().includes('total');
      if (!isTotal) continue;
      // Parsea valores COP: elimina puntos de miles y coma decimal
      const parseCOP = (text: string): number | null => {
        const cleaned = (text ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
        const n = parseFloat(cleaned);
        return isNaN(n) ? null : n;
      };
      const cellValues = Array.from(cells)
        .slice(0, -1)
        .map((c) => parseCOP(c.textContent ?? ''))
        .filter((v): v is number => v !== null);
      const reportedTotal = parseCOP(lastCell.textContent ?? '');
      if (cellValues.length > 1 && reportedTotal !== null) {
        const computedSum = cellValues.reduce((a, b) => a + b, 0);
        // Tolerancia de 1 centavo por redondeo de presentación
        if (Math.abs(computedSum - reportedTotal) > 1) {
          failures.push({
            rule: '§1.1 · Check 9 — aritmética de totales',
            detail: `Fila de total: suma computada ${computedSum.toFixed(2)} ≠ reportada ${reportedTotal.toFixed(2)}`,
            severity: 'block',
          });
          break;
        }
      }
    }
  }

  // ── Check 10 · Ratios fuera de banda con △ Anomalía + benchmark visual ────
  //
  // best-effort: busca el marcador "△ Anomalía" que §1.3 exige para outliers.
  // Si hay algún ratio declarado (%, ratio, margen) pero no hay ningún flag,
  // el check emite un warn conservador.
  // Severity: warn — no se puede detectar programáticamente si los valores
  // están dentro o fuera de banda sin el benchmark del CIIU.
  const hasRatioSection =
    htmlLower.includes('razón corriente') ||
    htmlLower.includes('margen') ||
    htmlLower.includes('ebitda') ||
    htmlLower.includes('endeudamiento');
  const hasAnomalyFlag =
    html.includes('△ Anomalía') ||
    html.includes('△ Anomalia') ||
    html.includes('anomalia') ||
    html.includes('anomalía');
  if (hasRatioSection && !hasAnomalyFlag) {
    failures.push({
      rule: '§1.3 · Check 10 — △ Anomalía para ratios fuera de banda',
      detail: 'Ratios detectados pero ningún flag △ Anomalía presente. Si hay outliers sectoriales, deben marcarse.',
      severity: 'warn',
    });
  }

  // ── Check 11 · Confianza dot en cifras medium/low ─────────────────────────
  //
  // best-effort DOM: busca elementos con clase 'conf medium' o 'conf low' que
  // §1.5 y §5 exigen como marcadores visuales. Si el HTML tiene secciones de
  // KPIs pero no tiene dots de confianza, warn.
  // Severity: warn — la presencia de dots depende de los niveles declarados.
  const hasKpiSection =
    htmlLower.includes('indicador') ||
    htmlLower.includes('kpi') ||
    htmlLower.includes('razón');
  const hasConfDots =
    document.querySelector('[class*="conf medium"]') !== null ||
    document.querySelector('[class*="conf low"]') !== null ||
    html.includes('conf medium') ||
    html.includes('conf low') ||
    html.includes('confianza');
  if (hasKpiSection && !hasConfDots) {
    failures.push({
      rule: '§1.5 · Check 11 — confianza dot en cifras medium/low',
      detail: 'Sección de KPIs detectada pero ningún marcador de confianza (conf medium / conf low) presente',
      severity: 'warn',
    });
  }

  // ── Check 12 · EFE: cashOpening = saldo efectivo real ─────────────────────
  //
  // Severity: block — §1.3 y §11 explícitan que el efectivo inicial del EFE
  // debe ser el saldo efectivo real (cuentas PUC 11), NO el total de activos.
  // Buscamos el patrón "Efectivo al inicio" o "Cash opening" cerca de un
  // valor que también aparezca como "Total Activos" — si coinciden, es error.
  // best-effort: heurística de proximidad textual.
  const efeOpeningMatch = html.match(
    /(?:efectivo al inicio|cash opening|saldo inicial de efectivo)[^\n]{0,80}?(\$[\d.,]+)/i,
  );
  const totalActivosMatch = html.match(
    /(?:total activos|total assets)[^\n]{0,80}?(\$[\d.,]+)/i,
  );
  if (efeOpeningMatch && totalActivosMatch) {
    const efeVal = efeOpeningMatch[1];
    const activosVal = totalActivosMatch[1];
    if (efeVal === activosVal) {
      failures.push({
        rule: '§11 · Check 12 — EFE cashOpening ≠ total activos',
        detail: `EFE saldo inicial (${efeVal}) coincide con Total Activos — posible error: debe ser saldo de efectivo (PUC 11), no total activos`,
        severity: 'block',
      });
    }
  }

  // ── Check 13 · Sección "Limitaciones de Información" en LINEA_BASE/TRANSICION
  //
  // Severity: block — §11 lo lista como requisito explícito. Sin esta sección
  // el lector no puede evaluar el alcance real del reporte.
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
        rule: '§11 · Check 13 — sección Limitaciones de Información',
        detail: `Modo ${metadata.reportMode}: sección "Limitaciones de Información" ausente`,
        severity: 'block',
      });
    }
  }

  // ── Check 14 · Bloque "Cómo se construyó este reporte" en Slide 12 ────────
  //
  // Severity: block — §1.8 "Transparencia sobre la generación" es regla
  // inviolable. El bloque debe existir en el slide 12 (cierre).
  const hasHowBuilt =
    htmlLower.includes('cómo se construyó este reporte') ||
    htmlLower.includes('como se construyo este reporte') ||
    htmlLower.includes('how this report was built') ||
    htmlLower.includes('generación del reporte') ||
    htmlLower.includes('construcción del reporte');
  if (!hasHowBuilt) {
    failures.push({
      rule: '§1.8 · Check 14 — bloque "Cómo se construyó este reporte"',
      detail: 'Bloque de transparencia "Cómo se construyó este reporte" ausente en Slide 12',
      severity: 'block',
    });
  }

  // ── Check 15 · Hash SHA-256 + QR presentes en transparency block ──────────
  //
  // Severity: block — §5 Slide 12 exige hash verificable. Si el LLM lo trunca
  // o inventa, no coincidirá con el hash determinístico del orchestrator.
  if (!html.includes(metadata.reportHashSha256)) {
    failures.push({
      rule: '§5 · Check 15 — hash SHA-256 en bloque transparencia',
      detail: `Hash SHA-256 "${metadata.reportHashSha256}" no encontrado en HTML output`,
      severity: 'block',
    });
  }

  // QR: best-effort — buscar elemento canvas, img[alt*="qr"] o texto "QR"
  const hasQrElement =
    document.querySelector('canvas[id*="qr"]') !== null ||
    document.querySelector('img[alt*="qr" i]') !== null ||
    document.querySelector('[class*="qr"]') !== null ||
    htmlLower.includes('qr');
  if (!hasQrElement) {
    failures.push({
      rule: '§5 · Check 15 — QR en bloque transparencia',
      detail: 'Elemento QR no detectado en Slide 12. El spec §5 exige QR junto al hash SHA-256.',
      severity: 'warn',
    });
  }

  // ── Check 16 · Disclaimer reformulado en versión positiva ─────────────────
  //
  // best-effort: verificar que haya un disclaimer pero que NO use lenguaje
  // negativo genérico ("este reporte no garantiza", "sin responsabilidad").
  // El spec pide una formulación positiva orientada a la utilidad del documento.
  // Severity: warn.
  const hasNegativeDisclaimer =
    /este (?:reporte|informe|documento) no garantiza/i.test(html) ||
    /sin responsabilidad/i.test(html) ||
    /exención de responsabilidad/i.test(html);
  if (hasNegativeDisclaimer) {
    failures.push({
      rule: '§11 · Check 16 — disclaimer positivo',
      detail: 'Disclaimer con formulación negativa detectado. El spec §11 exige versión reformulada positiva.',
      severity: 'warn',
    });
  }

  // ── Check 17 · Cero adjetivos prohibidos §1.6 en cuerpo ──────────────────
  //
  // Severity: block — §1.6 es regla inviolable. La lista está en la spec
  // verbatim; la espejamos para que el validador sea self-contained.
  // El linter ligero ya corre este check, pero lo repetimos aquí para que el
  // validador profundo sea exhaustivo e independiente.
  //
  // Why: el linter ligero corre post-emisión en el agente; este validador puede
  // correr de forma independiente (ej. en tests, en re-validación post-edición
  // manual). No asumir que el linter ligero ya corrió.
  //
  // Why lookahead en lugar de \b para É/Ú/Ó:
  //   `\b` en JavaScript solo reconoce [a-zA-Z0-9_] como word chars. Los
  //   caracteres con tilde (É, Ú, Ó) no son \w, por lo que `\bÉlite\b` no
  //   funciona si É va precedida de espacio (espacio→no-\w, É→no-\w, no hay
  //   boundary). Se usa `(?<![a-zA-ZÀ-ÖØ-öø-ÿ])` como lookbehind negativo
  //   Unicode para detectar inicio de palabra con cobertura de tildes.
  //   Las palabras sin tilde (Premium, Robusto, etc.) siguen usando \b/i
  //   porque ASCII-\w sí crea boundary con espacio.
  const forbiddenWords: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])[EÉeé]lite(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Élite' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])excelencia(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Excelencia' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])premium(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Premium' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])excepcional(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Excepcional' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])[UÚuú]nico(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Único' },
    { pattern: /\bmejor\b/i, label: 'Mejor' },
    { pattern: /(?<![a-zA-ZÀ-ÖØ-öø-ÿ])[SsÓóOo]lido(?![a-zA-ZÀ-ÖØ-öø-ÿ])/i, label: 'Sólido' },
    { pattern: /\brobusto\b/i, label: 'Robusto' },
    { pattern: /\bextraordinario\b/i, label: 'Extraordinario' },
  ];
  for (const { pattern, label } of forbiddenWords) {
    const match = html.match(pattern);
    if (match) {
      failures.push({
        rule: '§1.6 · Check 17 — vocabulario prohibido',
        detail: `Palabra prohibida detectada: "${match[0]}" (${label})`,
        severity: 'block',
      });
    }
  }

  // ── Check 18 · Contraste WCAG AA oro sobre blanco ─────────────────────────
  //
  // best-effort: sin browser real no podemos medir el ratio de contraste
  // exacto. La heurística es verificar que el token `--gold-d` (la variante
  // oscura del oro que el spec §5 prescribe para texto sobre fondo claro) se
  // use en los slides con fondo blanco.
  // Severity: warn — la verificación precisa requiere un navegador headless.
  const hasWhiteSlide =
    htmlLower.includes('background: white') ||
    htmlLower.includes('background:#fff') ||
    htmlLower.includes('background: #fff') ||
    htmlLower.includes('bg-white');
  const hasGoldDToken =
    html.includes('--gold-d') || html.includes('gold-d');
  if (hasWhiteSlide && !hasGoldDToken) {
    failures.push({
      rule: '§5 · Check 18 — contraste WCAG AA (heurística)',
      detail: 'Slide con fondo blanco detectado pero token --gold-d no encontrado. Verificar contraste AA en oro sobre blanco con browser.',
      severity: 'warn',
    });
  }

  // ── Check 19 · Tabular-nums en columnas numéricas ─────────────────────────
  //
  // Severity: warn — `font-variant-numeric: tabular-nums` alinea los dígitos
  // en columnas financieras. Si el CSS no lo declara, las cifras se descuadran
  // visualmente. No es un error de integridad pero afecta la legibilidad.
  const hasTabularNums =
    html.includes('tabular-nums') || html.includes('tabular_nums');
  if (!hasTabularNums) {
    failures.push({
      rule: '§11 · Check 19 — tabular-nums en columnas numéricas',
      detail: 'font-variant-numeric: tabular-nums no detectado en el HTML. Las columnas numéricas pueden desalinearse tipográficamente.',
      severity: 'warn',
    });
  }

  // ── Check 20 · Formato numérico consistente dentro de cada slide ──────────
  //
  // best-effort DOM: verificar que las celdas numéricas de la primera tabla
  // usen el mismo separador (punto para miles, coma para decimales — convención
  // COP). Si aparecen formatos mixtos (ej. "1,000.00" junto a "1.000,00"),
  // es un error de consistencia.
  // Severity: warn.
  const numericCells = document.querySelectorAll('td[class*="num"], td[class*="amount"], td[class*="value"]');
  let hasCommaDecimal = false;
  let hasDotDecimal = false;
  for (const cell of numericCells) {
    const text = cell.textContent ?? '';
    // COP: "1.234,56" → punto miles, coma decimal
    if (/\d{1,3}(?:\.\d{3})+,\d{2}/.test(text)) hasCommaDecimal = true;
    // US: "1,234.56" → coma miles, punto decimal
    if (/\d{1,3}(?:,\d{3})+\.\d{2}/.test(text)) hasDotDecimal = true;
  }
  if (hasCommaDecimal && hasDotDecimal) {
    failures.push({
      rule: '§11 · Check 20 — formato numérico consistente',
      detail: 'Formatos numéricos mixtos detectados: COP (punto-miles/coma-decimal) y US (coma-miles/punto-decimal) coexisten.',
      severity: 'warn',
    });
  }

  // ── Check 21 · Ortografía términos sensibles ──────────────────────────────
  //
  // best-effort: busca errores comunes de ortografía en términos técnicos
  // financieros que cambiarían el significado o la credibilidad del reporte.
  // Severity: warn — la ortografía fina requiere revisión humana.
  const spellingPatterns: Array<{ wrong: RegExp; correct: string }> = [
    { wrong: /\bpatrimono\b/i, correct: 'patrimonio' },
    { wrong: /\bbalance de prueba\b/i, correct: 'balance de comprobación' },
    { wrong: /\bvulneracion\b/i, correct: 'vulneración' },
    { wrong: /\bcontabilizacion\b/i, correct: 'contabilización' },
    { wrong: /\bdividendos decretados\b/i, correct: 'dividendos decretados (verificar: ¿aprobados en asamblea?)' },
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

  return failures;
}

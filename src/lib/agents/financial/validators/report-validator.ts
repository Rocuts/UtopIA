// ---------------------------------------------------------------------------
// Report Validator — post-render checks for the consolidated financial report
// ---------------------------------------------------------------------------
// Rechaza reportes con placeholders sin reemplazar, valida secciones obligatorias,
// y hace sanity-check numerico contra los totales pre-calculados del preprocesador.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { ReportValidationResult } from '../types';

// Agente A3 ira extendiendo PreprocessedBalance con controlTotals/equityBreakdown.
// Mientras tanto aceptamos el "shape contractual" directamente para evitar
// acoplamiento estrecho si su forma cambia en medio de la integracion.
//
// Los campos efectivoCuenta11..obligacionesLaborales25 alimentan la proyeccion
// de flujo de caja Big Four (Strategy Director, Paso 4). Son opcionales para
// preservar compatibilidad con consumers legacy que no los emiten.
export interface ControlTotalsInput {
  activo?: number;
  activoCorriente?: number;
  activoNoCorriente?: number;
  pasivo?: number;
  pasivoCorriente?: number;
  pasivoNoCorriente?: number;
  patrimonio?: number;
  ingresos?: number;
  gastos?: number;
  utilidadNeta?: number;
  /** PUC 11 — Efectivo y equivalentes (Big Four: saldo inicial caja) */
  efectivoCuenta11?: number;
  /** PUC 13 — Deudores comerciales (Big Four: aplicar DSO en Year 1) */
  deudoresCuenta13?: number;
  /** PUC 23 — Cuentas por pagar (Big Four: salida H1 Year 1) */
  cuentasPorPagar23?: number;
  /** PUC 24 — Impuestos por pagar (Big Four: salida inmediata Year 1) */
  impuestosCuenta24?: number;
  /** PUC 25 — Obligaciones laborales (Big Four: salida H1 Year 1) */
  obligacionesLaborales25?: number;
}

/**
 * Parsea un monto en formato COP (dot-thousand / comma-decimal) o US (comma-thousand / dot-decimal).
 *
 * Ejemplos:
 *   "$1.234.567,89"   -> 1234567.89
 *   "1,234,567.89"    -> 1234567.89
 *   "1234567"         -> 1234567
 *   "(1.234)"         -> -1234     (parentheses = negativo en contabilidad colombiana)
 *   "-$1.000"         -> -1000
 *   "N/A"             -> null
 */
export function parseCopAmount(input: string): number | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;

  // Detectar parentheses como negativo contable
  let negative = false;
  const parenMatch = s.match(/^\(\s*(.+?)\s*\)$/);
  if (parenMatch) {
    negative = true;
    s = parenMatch[1];
  }
  if (/^[-\u2212]/.test(s)) {
    negative = true;
    s = s.replace(/^[-\u2212]/, '');
  }

  // Quitar simbolos de moneda y espacios
  s = s.replace(/\$|COP|USD|\s/gi, '').trim();
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let normalized: string;
  if (lastComma > lastDot && lastComma === s.length - 3) {
    // Formato colombiano: 1.234.567,89
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastDot === s.length - 3) {
    // Formato US: 1,234,567.89
    normalized = s.replace(/,/g, '');
  } else if (lastComma === -1 && lastDot === -1) {
    // Solo digitos
    normalized = s;
  } else {
    // Sin decimales o ambiguo — asumimos separadores de miles
    normalized = s.replace(/[.,]/g, '');
  }

  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Formatea un monto a COP legible (para mensajes de error/warning).
 */
function formatCop(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + formatted;
}

/**
 * Extrae todos los montos asociados a un label (ej. "Total Activo")
 * del texto del reporte consolidado. Escanea linea por linea y devuelve
 * los numeros que parezcan montos.
 */
function extractTotalsMentions(
  markdown: string,
  label: RegExp,
): number[] {
  const found: number[] = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (!label.test(line)) continue;
    // Buscar montos: patron amplio que acepta $ opcional, parentheses y decimales
    const numMatches = line.match(
      /\$?\s*\(?-?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\)?|\$?\s*\(?-?\s*\d+(?:[.,]\d{1,2})?\)?/g,
    );
    if (!numMatches) continue;
    for (const raw of numMatches) {
      const n = parseCopAmount(raw);
      if (n !== null) found.push(n);
    }
  }
  return found;
}

/**
 * Extrae el monto del TOTAL "headline" de una seccion (ej. `TOTAL ACTIVO`
 * en el Balance). A diferencia de `extractTotalsMentions`, este helper busca
 * lineas que matcheen el patron EXACTO (ej. excluyendo "Total Activo
 * Corriente") y retorna el ultimo numero de la primera linea que matchee —
 * que en el formato Markdown de tabla `| TOTAL ACTIVO | $xxx |` es el monto.
 */
function extractHeadlineTotal(markdown: string, pattern: RegExp): number | null {
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\*+/g, '').trim();
    if (!pattern.test(line)) continue;
    const nums = line.match(
      /\$?\s*\(?-?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\)?|\$?\s*\(?-?\s*\d+(?:[.,]\d{1,2})?\)?/g,
    );
    if (!nums) continue;
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = parseCopAmount(nums[i]);
      if (n !== null && n !== 0) return n;
    }
  }
  return null;
}

/**
 * Valida el reporte consolidado:
 * 1. Rechaza placeholders literales (`$[___]`, `[Fecha]`, etc.) — HARD FAIL.
 * 2. Verifica que existen las 3 secciones maestras (PARTE I/II/III) — HARD FAIL.
 * 3. Sanity-check numerico contra controlTotals (tolerancia 1%) — WARNING.
 * 4. Advierte si no se mencionan Activo/Pasivo/Patrimonio juntos — WARNING.
 * 5. Detecta tablas Markdown malformadas — WARNING.
 */
export function validateConsolidatedReport(
  consolidatedMarkdown: string,
  controlTotals?: ControlTotalsInput,
): ReportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!consolidatedMarkdown || !consolidatedMarkdown.trim()) {
    return {
      ok: false,
      errors: ['Reporte consolidado vacio o nulo.'],
      warnings: [],
    };
  }

  // -----------------------------------------------------------------------
  // 1) Placeholder rejection — HARD FAIL
  // -----------------------------------------------------------------------
  // Captura: [___], [____], $[___], $[MONTO], $[], ___%, [Fecha], [Hora],
  // [Presidente], [Incluir ...]
  const placeholderRegex = /\[_{2,}\]|\$\[(?:MONTO|_{2,})?\]|_{3,}%|\[Fecha\]|\[Hora\]|\[Presidente\]|\[Incluir[^\]]*\]/gi;
  const placeholderMatches = consolidatedMarkdown.match(placeholderRegex);
  if (placeholderMatches && placeholderMatches.length > 0) {
    const unique = Array.from(new Set(placeholderMatches));
    errors.push(
      `Placeholders sin reemplazar detectados (${placeholderMatches.length} ocurrencias): ` +
        unique.slice(0, 8).join(', ') +
        (unique.length > 8 ? ` (+${unique.length - 8} mas)` : ''),
    );
  }

  // -----------------------------------------------------------------------
  // 2) Section completeness — HARD FAIL
  // -----------------------------------------------------------------------
  const missingSections: string[] = [];
  if (!/# PARTE I:/.test(consolidatedMarkdown)) missingSections.push('PARTE I');
  if (!/# PARTE II:/.test(consolidatedMarkdown)) missingSections.push('PARTE II');
  if (!/# PARTE III:/.test(consolidatedMarkdown)) missingSections.push('PARTE III');
  if (missingSections.length > 0) {
    errors.push(
      `Secciones maestras ausentes: ${missingSections.join(', ')}. Se requieren las 3 partes (NIIF, Estrategia, Gobernanza).`,
    );
  }

  // -----------------------------------------------------------------------
  // 3) Numeric sanity vs. controlTotals — WARNING (tolerancia 1%)
  // -----------------------------------------------------------------------
  if (controlTotals) {
    const TOLERANCE = 0.01; // 1%

    const checks: Array<{
      label: string;
      expected: number | undefined;
      pattern: RegExp;
    }> = [
      {
        label: 'Total Activo',
        expected: controlTotals.activo,
        pattern: /total\s*(?:de\s*)?activo(?:s)?\b/i,
      },
      {
        label: 'Total Pasivo',
        expected: controlTotals.pasivo,
        pattern: /total\s*(?:de\s*)?pasivo(?:s)?\b/i,
      },
      {
        label: 'Total Patrimonio',
        expected: controlTotals.patrimonio,
        pattern: /total\s*(?:del?\s*)?patrimonio\b/i,
      },
      {
        label: 'Utilidad Neta',
        expected: controlTotals.utilidadNeta,
        pattern: /utilidad\s*(?:neta|del\s*ejercicio)\b/i,
      },
    ];

    for (const check of checks) {
      if (typeof check.expected !== 'number' || !Number.isFinite(check.expected)) continue;
      const mentions = extractTotalsMentions(consolidatedMarkdown, check.pattern);
      if (mentions.length === 0) continue; // no se menciona -> no es warning
      const expected = check.expected;
      const absExpected = Math.abs(expected);
      // Revisar si ALGUNA mencion cae fuera de tolerancia
      let worst: { reported: number; diff: number } | null = null;
      for (const reported of mentions) {
        const diff = Math.abs(reported - expected);
        const pct = absExpected > 0 ? diff / absExpected : diff > 1 ? Infinity : 0;
        // Requiere 1% de tolerancia Y al menos $100 de diferencia absoluta
        // (para evitar falsos positivos por redondeo en montos pequenos).
        if (pct > TOLERANCE && diff > 100) {
          if (!worst || diff > worst.diff) {
            worst = { reported, diff };
          }
        }
      }
      if (worst) {
        warnings.push(
          `${check.label}: reportado ${formatCop(worst.reported)} vs. esperado ${formatCop(expected)} ` +
            `(diferencia ${formatCop(worst.diff)}).`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4) Accounting equation INTERNAL consistency — HARD FAIL
  // -----------------------------------------------------------------------
  // Extraemos los montos que el propio reporte reporta como Total Activo,
  // Total Pasivo y Total Patrimonio y verificamos que cumplan la ecuacion
  // contable fundamental: Activo = Pasivo + Patrimonio. Si descuadra >1% del
  // activo, el reporte es internamente inconsistente (ej. el Balance dice
  // Patrimonio = $42.720 mientras el Estado de Cambios dice $1.439M) y NO
  // sirve. Fallamos duro antes de mostrarselo al usuario.
  // Matchea "TOTAL ACTIVO" (con o sin ":" o "|") pero NO "Total Activo Corriente"
  // ni "Total Activo No Corriente" que son subtotales. El `\s*$` asegura que el
  // label termine ahi (antes del numero).
  const reportedAssets = extractHeadlineTotal(
    consolidatedMarkdown,
    /total\s+(?:de\s+)?activo(?:s)?\s*(?:\||:|$|\s{2,})/i,
  );
  const reportedLiabilities = extractHeadlineTotal(
    consolidatedMarkdown,
    /total\s+(?:de\s+)?pasivo(?:s)?\s*(?:\||:|$|\s{2,})/i,
  );
  const reportedEquity = extractHeadlineTotal(
    consolidatedMarkdown,
    /total\s+(?:del?\s+)?patrimonio\s*(?:\||:|$|\s{2,})/i,
  );

  if (
    reportedAssets !== null &&
    reportedLiabilities !== null &&
    reportedEquity !== null
  ) {
    const equationDiff = reportedAssets - (reportedLiabilities + reportedEquity);
    const absAssets = Math.abs(reportedAssets);
    const INTERNAL_TOL_PCT = 0.01; // 1%
    const INTERNAL_TOL_ABS = 10_000; // $10K — evita falsos positivos
    const pct = absAssets > 0 ? Math.abs(equationDiff) / absAssets : 0;
    if (pct > INTERNAL_TOL_PCT && Math.abs(equationDiff) > INTERNAL_TOL_ABS) {
      errors.push(
        `Ecuacion contable interna descuadrada en el reporte: Total Activo ` +
          `${formatCop(reportedAssets)} != Total Pasivo ${formatCop(reportedLiabilities)} + ` +
          `Total Patrimonio ${formatCop(reportedEquity)} (diferencia ${formatCop(equationDiff)}, ` +
          `${(pct * 100).toFixed(2)}% del activo). El reporte es internamente inconsistente.`,
      );
    }
  } else {
    // No encontramos los 3 totales → caemos al check anterior (mencion en parrafo)
    const paragraphs = consolidatedMarkdown.split(/\n{2,}/);
    const hasEquationMention = paragraphs.some((p) => {
      const lower = p.toLowerCase();
      return lower.includes('activo') && lower.includes('pasivo') && lower.includes('patrimonio');
    });
    if (!hasEquationMention) {
      warnings.push(
        'Ningun parrafo menciona Activo, Pasivo y Patrimonio juntos (ecuacion patrimonial).',
      );
    }
  }

  // -----------------------------------------------------------------------
  // 5) Broken Markdown tables — WARNING (no bloqueante)
  // -----------------------------------------------------------------------
  const tableWarning = detectBrokenTables(consolidatedMarkdown);
  if (tableWarning) warnings.push(tableWarning);

  // -----------------------------------------------------------------------
  // 6) Big Four Cash Flow validators (Strategy Director Paso 4)
  // -----------------------------------------------------------------------
  // Estos validators verifican que el Strategy Director realmente aplique el
  // metodo Big Four (PUC 11 como saldo inicial, working capital con DSO, KPIs
  // de control). El primero es HARD FAIL (caja inflada), los otros dos son
  // WARNING (proyeccion incompleta pero recuperable).
  // -----------------------------------------------------------------------
  const cashError = detectInflatedCash(consolidatedMarkdown, controlTotals);
  if (cashError) errors.push(cashError);

  const wcWarning = detectMissingWorkingCapital(consolidatedMarkdown);
  if (wcWarning) warnings.push(wcWarning);

  const kpiWarning = detectMissingControlKPIs(consolidatedMarkdown);
  if (kpiWarning) warnings.push(kpiWarning);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Big Four Cash Flow Validators
// ---------------------------------------------------------------------------
// Estos validators son la red de seguridad del refactor "Prompt Maestro Big
// Four" en strategy-director.prompt.ts (Paso 4). Aunque el prompt instruya al
// modelo a usar SOLO PUC 11 como saldo inicial y aplicar working capital, un
// LLM puede regresar a la heuristica vieja "ingresos = caja". Los validators
// post-render detectan esa regresion y o bien fallan duro (caja inflada) o
// emiten warning para el operador (working capital ignorado, KPIs ausentes).
// ---------------------------------------------------------------------------

/**
 * detectInflatedCash — HARD FAIL si el Strategy Director uso un saldo inicial
 * inflado (ej. Activo Corriente total) en lugar de SOLO PUC 11.
 *
 * Heuristica: extrae el primer monto que aparezca en una linea con etiquetas
 * tipo "Saldo Inicial Caja" / "Saldo Inicial de Caja" / "Saldo Inicial (PUC 11)"
 * dentro de la PARTE II (Estrategia). Compara con `controlTotals.efectivoCuenta11`.
 * Si la diferencia es > 5% del valor esperado Y > $100K absoluto, fallar duro.
 *
 * Si controlTotals.efectivoCuenta11 no esta disponible (consumer legacy),
 * el validator no aplica (retorna null) — preserva backwards compatibility.
 */
export function detectInflatedCash(
  markdown: string,
  controlTotals?: ControlTotalsInput,
): string | null {
  if (!controlTotals || typeof controlTotals.efectivoCuenta11 !== 'number') {
    return null; // sin ancla, no podemos validar
  }
  const expected = controlTotals.efectivoCuenta11;
  if (!Number.isFinite(expected) || Math.abs(expected) < 1) {
    return null; // efectivo cero o invalido — el Strategy Director debera reportar 0
  }

  // Solo evaluar la PARTE II (Estrategia) — donde vive el Paso 4. Si no
  // existe la marca, evaluar el documento completo (consumer legacy).
  const parteIIIdx = markdown.search(/# PARTE II:/i);
  const parteIIIIdx = markdown.search(/# PARTE III:/i);
  const region =
    parteIIIdx !== -1
      ? markdown.slice(parteIIIdx, parteIIIIdx !== -1 ? parteIIIIdx : undefined)
      : markdown;

  // Patrones que matchean "Saldo Inicial Caja" / "Saldo Inicial de Caja" /
  // "Saldo Inicial (PUC 11)" con o sin asteriscos/pipes.
  const labelPattern =
    /saldo\s+inicial(?:\s+(?:de\s+)?caja)?\s*(?:\(\s*(?:solo\s+)?puc\s*11[^\)]*\))?/i;

  const lines = region.split(/\r?\n/);
  let firstReported: number | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\*+/g, '').trim();
    if (!labelPattern.test(line)) continue;
    // Si la linea menciona PUC 13/14/12/Activo Corriente, NO es el saldo inicial
    // depurado — ignorar.
    if (
      /puc\s*1[2-4]/i.test(line) ||
      /activo\s+corriente/i.test(line) ||
      /deudores/i.test(line) ||
      /inventarios/i.test(line)
    ) {
      continue;
    }
    const nums = line.match(
      /\$?\s*\(?-?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\)?|\$?\s*\(?-?\s*\d+(?:[.,]\d{1,2})?\)?/g,
    );
    if (!nums) continue;
    for (const raw of nums) {
      const n = parseCopAmount(raw);
      if (n !== null && Math.abs(n) > 1) {
        firstReported = n;
        break;
      }
    }
    if (firstReported !== null) break;
  }

  if (firstReported === null) return null; // no se reporto saldo inicial — manejado por detectMissingWorkingCapital

  const absExpected = Math.abs(expected);
  const diff = Math.abs(firstReported - expected);
  const pct = absExpected > 0 ? diff / absExpected : Infinity;
  // Tolerancia: 5% del valor esperado Y al menos $100K absoluto.
  if (pct > 0.05 && diff > 100_000) {
    return (
      `Caja inflada (Big Four): Strategy Director reporta Saldo Inicial Caja ` +
      `${formatCop(firstReported)} pero el balance dice ${formatCop(expected)} ` +
      `(PUC 11). Diferencia ${formatCop(diff)} (${(pct * 100).toFixed(1)}% del valor esperado). ` +
      `El Paso 4 del Prompt Maestro Big Four exige usar SOLO PUC 11 como saldo inicial; ` +
      `incluir Deudores (PUC 13), Inventarios (PUC 14) o Activo Corriente total es regresion.`
    );
  }
  return null;
}

/**
 * detectMissingWorkingCapital — WARNING si el Strategy Director no aplico el
 * ciclo de capital de trabajo (DSO, PUC 23, PUC 25) en el Paso 4.
 *
 * Heuristica: en la region de la PARTE II (o doc completo si no existe),
 * verifica que aparezca al menos UNA de las frases clave de working capital
 * (DSO, "Dias de Cartera", "PUC 23", "PUC 25", "Cuentas por Pagar"). Si NO
 * aparece ninguna, es probable que la proyeccion siga la heuristica vieja
 * ingresos=caja sin programar salidas obligatorias.
 */
export function detectMissingWorkingCapital(markdown: string): string | null {
  const parteIIIdx = markdown.search(/# PARTE II:/i);
  const parteIIIIdx = markdown.search(/# PARTE III:/i);
  const region =
    parteIIIdx !== -1
      ? markdown.slice(parteIIIdx, parteIIIIdx !== -1 ? parteIIIIdx : undefined)
      : markdown;

  // Si no hay un Paso 4 (## 4. ...), no aplica este validator.
  if (!/##\s*4\./.test(region)) return null;

  const wcSignals = [
    /\bdso\b/i,
    /d[ií]as\s+de\s+cartera/i,
    /\bpuc\s*23\b/i,
    /\bpuc\s*25\b/i,
    /\bpuc\s*13\b/i,
    /cuentas?\s+por\s+pagar/i,
    /obligaciones?\s+laborales?/i,
    /capital\s+de\s+trabajo/i,
    /working\s+capital/i,
  ];

  const matches = wcSignals.filter((re) => re.test(region));
  if (matches.length === 0) {
    return (
      'Working Capital ausente (Big Four): la proyeccion de flujo (Paso 4) no ' +
      'cita DSO, Dias de Cartera, PUC 13, PUC 23, PUC 25 ni cuentas por pagar / ' +
      'obligaciones laborales. El Prompt Maestro Big Four exige programar el ciclo ' +
      'de capital de trabajo en lugar de asumir ingresos = caja.'
    );
  }
  return null;
}

/**
 * detectMissingControlKPIs — WARNING si la tabla final de KPIs de Control de
 * Caja (Paso 4.8) no incluye los 3 KPIs obligatorios.
 *
 * Heuristica: verifica presencia de cada uno de los 3 KPIs por nombre. Si
 * falta cualquiera, emite warning con la lista de los faltantes.
 */
export function detectMissingControlKPIs(markdown: string): string | null {
  const parteIIIdx = markdown.search(/# PARTE II:/i);
  const parteIIIIdx = markdown.search(/# PARTE III:/i);
  const region =
    parteIIIdx !== -1
      ? markdown.slice(parteIIIdx, parteIIIIdx !== -1 ? parteIIIIdx : undefined)
      : markdown;

  if (!/##\s*4\./.test(region)) return null;

  const kpis: Array<{ label: string; pattern: RegExp }> = [
    { label: 'Margen de Caja Neto', pattern: /margen\s+de\s+caja\s+neto/i },
    {
      label: 'Dias de Autonomia Financiera',
      pattern: /d[ií]as\s+de\s+autonom[ií]a\s+financiera/i,
    },
    {
      label: 'Tasa de Retorno sobre Flujo Acumulado',
      pattern: /tasa\s+de\s+retorno\s+sobre\s+(?:el\s+)?flujo\s+acumulado/i,
    },
  ];

  const missing = kpis.filter((k) => !k.pattern.test(region)).map((k) => k.label);
  if (missing.length > 0) {
    return (
      `KPIs de Control de Caja ausentes (Big Four 4.8): faltan ${missing.join(', ')}. ` +
      `El Paso 4.8 del Prompt Maestro exige los 3 KPIs literalmente.`
    );
  }
  return null;
}

/**
 * Detecta tablas con numero inconsistente de pipes por fila.
 * Heuristica: filas consecutivas que empiezan con `|` deben tener el mismo
 * numero de pipes (+/-1 para tolerar bordes). Ignora la fila separadora.
 */
function detectBrokenTables(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let inTable = false;
  let refPipes = 0;
  let tableStartLine = 0;
  const broken: Array<{ line: number; expected: number; got: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const startsPipe = trimmed.startsWith('|');
    const pipeCount = (trimmed.match(/\|/g) || []).length;

    if (!inTable && startsPipe && pipeCount >= 2) {
      inTable = true;
      refPipes = pipeCount;
      tableStartLine = i + 1;
    } else if (inTable && !startsPipe) {
      inTable = false;
      refPipes = 0;
    } else if (inTable && startsPipe) {
      // Ignorar separador `|---|---|`
      if (/^\|\s*:?-{3,}/.test(trimmed)) continue;
      if (Math.abs(pipeCount - refPipes) > 1) {
        broken.push({ line: i + 1, expected: refPipes, got: pipeCount });
      }
    }
  }

  if (broken.length === 0) return null;
  const first = broken[0];
  return (
    `Markdown: tablas con pipes inconsistentes (${broken.length} filas afectadas, ` +
    `primera en linea ${first.line}, tabla desde linea ${tableStartLine}).`
  );
}

// Re-export util para que otros modulos (orchestrator, UI) tengan el tipo a mano
export type { ReportValidationResult, PreprocessedBalance };

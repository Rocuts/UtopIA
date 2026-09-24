// ---------------------------------------------------------------------------
// Report Validator — post-render checks for the consolidated financial report
// ---------------------------------------------------------------------------
// Rechaza reportes con placeholders sin reemplazar, valida secciones obligatorias,
// y hace sanity-check numerico contra los totales pre-calculados del preprocesador.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { parseCOPStrict } from '@/lib/format/cop';
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
 *   "$1.234,5"        -> 1234.5    (1-2 dígitos tras el último separador = decimal)
 *   "1234567"         -> 1234567
 *   "(1.234)"         -> -1234     (parentheses = negativo en contabilidad colombiana)
 *   "-$1.000"         -> -1000
 *   "N/A"             -> null
 */
export function parseCopAmount(input: string): number | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;

  // "$(1.234)" — signo pesos antes del paréntesis contable (reportes-export-01).
  s = s.replace(/^\$\s*(?=\()/, '');

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
  const lastSep = Math.max(lastComma, lastDot);
  const digitsAfter = lastSep === -1 ? -1 : s.length - lastSep - 1;

  let normalized: string;
  if (lastSep === -1) {
    // Solo digitos
    normalized = s;
  } else if (digitsAfter === 1 || digitsAfter === 2) {
    // 1-2 dígitos tras el ÚLTIMO separador = separador decimal, en cualquier
    // convención: "1.234.567,89", "1,234,567.89", "1.234,5", "12.34".
    // (Un grupo de miles siempre tiene 3 dígitos.)
    normalized = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  } else {
    // 3+ dígitos tras el último separador — separadores de miles sin decimales
    normalized = s.replace(/[.,]/g, '');
  }

  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------------------------------------------------------------------------
// Montos COP en texto (auditoría 2026-09, e2e-niif-03 / e2e-niif-04)
// ---------------------------------------------------------------------------
// El patrón histórico tomaba cualquier número de la línea: "4.2" del
// encabezado "### 4.2 Saldo Inicial Depurado" como $4,20 (caja inflada en todo
// informe con AC ≥ PC), "15" de la banda "> 15%" como $15,00, "$-40 M" del
// dashboard como -$40,00 y la columna comparativa como cifra del periodo.
// Este extractor sólo reconoce MONTOS: con signo pesos o con separadores de
// miles es-CO, sin empezar a mitad de otro número, con el negativo contable
// entre paréntesis (con el "$" dentro o fuera), y marca porcentajes y montos
// abreviados ("$150 M", "$1,2 B") para que el llamador decida.
// ---------------------------------------------------------------------------

interface CopToken {
  /** Valor en pesos (con signo). Para abreviados, ya multiplicado por la escala. */
  value: number;
  /** El token va seguido de '%': no es un monto. */
  percent: boolean;
  /** Abreviado ($X M / $X B): la precisión es la media unidad del último dígito. */
  abbreviated: boolean;
  /** Tolerancia de redondeo del abreviado, en pesos (0 si es cifra completa). */
  roundingTolerance: number;
  index: number;
}

const COP_TOKEN_SOURCE =
  String.raw`(?<![\w.,$])` + // no empezar a mitad de un número ni de una palabra
  String.raw`(\(\s*)?` + // 1: paréntesis contable que abre
  String.raw`([-−]\s*)?` + // 2: signo antes del "$"
  String.raw`(\$\s*)?` + // 3: signo pesos
  String.raw`(\(\s*)?` + // 4: "$(1.234)"
  String.raw`([-−]\s*)?` + // 5: "$-1.234"
  String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)` + // 6: número es-CO
  String.raw`(?!\d|[.,]\d)` +
  String.raw`(\s*\))?` + // 7: paréntesis que cierra
  String.raw`(\s*%|\s*(?:MM|M|B|mil\s+millones|millones|billones|mil(?:es)?)(?![\p{L}\d]))?`; // 8: sufijo

// "B" es la escala que imprime el dashboard de la Parte II (miles de
// millones, `formatCopAsMillions`); "billones" es la escala colombiana (10^12).
const ABBREVIATION_SCALE: Array<[RegExp, number]> = [
  [/^mil\s+millones$/, 1e9],
  [/^(?:MM|M|millones)$/, 1e6],
  [/^B$/, 1e9],
  [/^billones$/, 1e12],
  [/^mil(?:es)?$/, 1e3],
];

/** Tokeniza los montos COP de un texto (ver el comentario del bloque). */
export function extractCopTokens(text: string): CopToken[] {
  const out: CopToken[] = [];
  const re = new RegExp(COP_TOKEN_SOURCE, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [, openParen, signBefore, dollar, openParenAfter, signAfter, digits, closeParen, suffixRaw] = m;
    const grouped = /\./.test(digits);
    // Un número pelado sin "$" ni miles ("11" de PUC 11, "2025") no es monto.
    if (!dollar && !grouped) continue;
    const parsed = parseCOPStrict(digits);
    if (parsed === null) continue;
    const magnitude = Number(parsed);
    if (!Number.isFinite(magnitude)) continue;
    const negative =
      Boolean(signBefore) ||
      Boolean(signAfter) ||
      (Boolean(openParen || openParenAfter) && Boolean(closeParen));
    const suffix = (suffixRaw ?? '').trim();
    const percent = suffix === '%';
    let scale = 1;
    if (suffix && !percent) {
      scale = ABBREVIATION_SCALE.find(([re]) => re.test(suffix))?.[1] ?? 1;
    }
    const decimals = /,(\d{1,2})$/.exec(digits)?.[1].length ?? 0;
    const abbreviated = scale !== 1;
    out.push({
      value: (negative ? -magnitude : magnitude) * scale,
      percent,
      abbreviated,
      roundingTolerance: abbreviated ? (scale / 10 ** decimals) / 2 : 0,
      index: m.index,
    });
  }
  return out;
}

/** Primer monto (no porcentaje) del texto; `allowAbbreviated` admite "$X M". */
function firstCopAmount(text: string, allowAbbreviated: boolean): CopToken | null {
  for (const t of extractCopTokens(text)) {
    if (t.percent) continue;
    if (t.abbreviated && !allowAbbreviated) continue;
    return t;
  }
  return null;
}

/**
 * Texto que sigue al rótulo en una línea de tabla o de prosa: en tablas, las
 * celdas posteriores a la del rótulo (la primera es la columna del periodo
 * actual); en prosa, el resto de la línea tras el rótulo.
 */
function textAfterLabel(line: string, pattern: RegExp): string | null {
  const clean = line.replace(/\*+/g, '');
  const m = pattern.exec(clean);
  if (!m || m.index === undefined) return null;
  if (clean.includes('|')) {
    const cells = clean.split('|');
    let offset = 0;
    for (let i = 0; i < cells.length; i++) {
      const end = offset + cells[i].length;
      if (m.index >= offset && m.index < end) {
        // Resto de la celda del rótulo (p. ej. "Total Activo: $X") + celdas siguientes.
        const restOfCell = clean.slice(m.index + m[0].length, end);
        return [restOfCell, ...cells.slice(i + 1)].join(' | ');
      }
      offset = end + 1;
    }
  }
  return clean.slice(m.index + m[0].length);
}

/** Subtotales y rótulos compuestos que NO son el total buscado. */
const NOT_THE_TOTAL_RE =
  /^\s*[:|]?\s*(?:no\s+corriente|corriente|\+|y\s+(?:el\s+)?patrimonio|\/|sobre\b|promedio\b)/i;

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
  isLossLine?: (line: string) => boolean,
): Array<{ value: number; tolerance: number }> {
  const found: Array<{ value: number; tolerance: number }> = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    // Encabezados ("### 4.2 …") no citan cifras (e2e-niif-03).
    if (/^\s*#/.test(line)) continue;
    if (!label.test(line)) continue;
    // Sólo la PRIMERA cifra tras el rótulo: en una tabla es la columna del
    // periodo actual; las siguientes son el comparativo y la variación
    // (e2e-niif-04). "Total Activo Corriente", "Total Pasivo + Patrimonio" o
    // "Utilidad neta / patrimonio" no son el total buscado.
    const tail = textAfterLabel(line, label);
    if (tail === null || NOT_THE_TOTAL_RE.test(tail)) continue;
    const token = firstCopAmount(tail, true);
    if (!token) continue;
    // "PÉRDIDA NETA" rotula un resultado negativo: su cifra puede venir en
    // magnitud ("$5.000") o firmada ("($5.000)"); ambas se leen negativas.
    const loss = isLossLine?.(line) === true;
    found.push({
      value: loss ? -Math.abs(token.value) : token.value,
      tolerance: token.roundingTolerance,
    });
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
  // Auditoría 2026-09 (niif-contrato-16): antes se tomaba la ÚLTIMA cifra de
  // la fila, que en un estado comparativo es la columna del año anterior. La
  // cifra del periodo actual es la PRIMERA celda numérica después del rótulo.
  // e2e-niif-04: sólo montos COP (con "$" o miles es-CO; "($X)" negativo), sin
  // abreviados del dashboard ("$50 M") ni porcentajes.
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\*+/g, '').trim();
    if (line.startsWith('#')) continue;
    if (!pattern.test(line)) continue;
    let tail: string;
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim());
      const labelIdx = cells.findIndex((c) => pattern.test(`${c} |`) || pattern.test(c));
      tail = labelIdx >= 0 ? cells.slice(labelIdx + 1).join(' | ') : line;
    } else {
      const m = line.match(pattern);
      tail = m && m.index !== undefined ? line.slice(m.index + m[0].length) : line;
    }
    const token = firstCopAmount(tail, false);
    if (token) return token.value;
  }
  return null;
}

/**
 * Opciones avanzadas del validador. Multiperiodo: permite cruzar tambien las
 * cifras del periodo comparativo cuando el reporte declara dos columnas.
 */
export interface ValidateConsolidatedReportOptions {
  /** Totales del periodo comparativo (si el balance trae 2+ periodos). */
  comparativeTotals?: ControlTotalsInput;
  /** Identificador del periodo actual (ej. "2025") — solo para los mensajes de error. */
  primaryPeriod?: string;
  /** Identificador del periodo comparativo (ej. "2024") — solo para los mensajes. */
  comparativePeriod?: string;
}

/**
 * Valida el reporte consolidado:
 * 1. Rechaza placeholders literales (`$[___]`, `[Fecha]`, etc.) — HARD FAIL.
 * 2. Verifica que existen las 3 secciones maestras (PARTE I/II/III) — HARD FAIL.
 * 3. Sanity-check numerico contra controlTotals (tolerancia 1%) — WARNING.
 *    Multiperiodo: si `options.comparativeTotals` esta presente, se cruza
 *    tambien el periodo comparativo con sus propias cifras.
 * 4. Advierte si no se mencionan Activo/Pasivo/Patrimonio juntos — WARNING.
 * 5. Detecta tablas Markdown malformadas — WARNING.
 */
export function validateConsolidatedReport(
  consolidatedMarkdown: string,
  controlTotals?: ControlTotalsInput,
  options: ValidateConsolidatedReportOptions = {},
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
  // Multiperiodo: corremos el chequeo dos veces — una para el periodo actual
  // (anclado al universo de menciones global) y otra para el periodo
  // comparativo, donde restringimos las menciones a lineas que citen el
  // identificador del periodo comparativo (ej. "2024") para evitar falsos
  // positivos cruzados con cifras del periodo actual.
  // -----------------------------------------------------------------------
  const TOLERANCE = 0.01; // 1%
  const checkSpecs = (totals: ControlTotalsInput) => [
    {
      label: 'Total Activo',
      expected: totals.activo,
      pattern: /total\s*(?:de\s*)?activo(?:s)?\b/i,
    },
    {
      label: 'Total Pasivo',
      expected: totals.pasivo,
      pattern: /total\s*(?:de\s*)?pasivo(?:s)?\b/i,
    },
    {
      label: 'Total Patrimonio',
      expected: totals.patrimonio,
      pattern: /total\s*(?:del?\s*)?patrimonio\b/i,
    },
    {
      label: 'Utilidad Neta',
      expected: totals.utilidadNeta,
      // El renderer rotula "PÉRDIDA NETA DEL PERÍODO" cuando el resultado es
      // negativo (paridad de superficies, reportes-export-01): sin esa
      // alternativa una pérdida mal reportada no entraba al chequeo.
      pattern: /(?:utilidad|p[eé]rdida)\s*(?:neta|del\s*ejercicio)\b/i,
      isLossLine: (line: string) =>
        /p[eé]rdida\s*(?:neta|del\s*ejercicio)\b/i.test(line) && !/utilidad/i.test(line),
    },
  ];

  const sanityCheck = (
    totals: ControlTotalsInput,
    periodLabel: string | undefined,
    restrictToPeriod: string | undefined,
  ) => {
    const tag = periodLabel ? ` [${periodLabel}]` : '';
    for (const check of checkSpecs(totals)) {
      if (typeof check.expected !== 'number' || !Number.isFinite(check.expected)) continue;

      // Para el comparativo, restringimos a lineas que citen el identificador
      // del periodo (ej. la columna "2024" en una tabla de dos columnas).
      const lines = consolidatedMarkdown.split(/\r?\n/);
      const filteredText = restrictToPeriod
        ? lines.filter((l) => l.includes(restrictToPeriod)).join('\n')
        : consolidatedMarkdown;

      const mentions = extractTotalsMentions(
        filteredText,
        check.pattern,
        'isLossLine' in check ? check.isLossLine : undefined,
      );
      if (mentions.length === 0) continue;
      const expected = check.expected;
      const absExpected = Math.abs(expected);
      let worst: { reported: number; diff: number } | null = null;
      for (const { value: reported, tolerance } of mentions) {
        const diff = Math.abs(reported - expected);
        const pct = absExpected > 0 ? diff / absExpected : diff > 1 ? Infinity : 0;
        // Un abreviado ("$150 M") cuadra si el ancla redondea a esa cifra.
        if (diff <= tolerance) continue;
        if (pct > TOLERANCE && diff > 100) {
          if (!worst || diff > worst.diff) {
            worst = { reported, diff };
          }
        }
      }
      if (worst) {
        warnings.push(
          `${check.label}${tag}: reportado ${formatCop(worst.reported)} vs. esperado ${formatCop(expected)} ` +
            `(diferencia ${formatCop(worst.diff)}).`,
        );
      }
    }
  };

  if (controlTotals) {
    // Periodo actual: no restringimos por periodo (el reporte single-period
    // y las menciones globales caen aqui).
    sanityCheck(controlTotals, options.primaryPeriod, undefined);
  }

  if (options.comparativeTotals && options.comparativePeriod) {
    // Periodo comparativo: solo las lineas que mencionan el identificador
    // del periodo comparativo. Esto evita reportar como discrepancia las
    // cifras del periodo actual cuando se cruzan contra el comparativo.
    sanityCheck(
      options.comparativeTotals,
      options.comparativePeriod,
      options.comparativePeriod,
    );
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
  // 4b) ECP ↔ Balance equity anchor — HARD FAIL
  // -----------------------------------------------------------------------
  // El Saldo Final del Patrimonio en el ECP debe cerrar exactamente igual al
  // Total Patrimonio del Balance. Si hay gap, el modelo debio absorberlo via
  // "Ajustes de Convergencia / Resultados Acumulados" antes de emitir.
  const reportedEcpClose = extractHeadlineTotal(
    consolidatedMarkdown,
    /saldo\s+final\s*(?:del?\s+)?(?:patrimonio|per[ií]odo)\s*(?:\||:|$|\s{2,})/i,
  );
  if (reportedEquity !== null && reportedEcpClose !== null) {
    const ecpDiff = Math.abs(reportedEquity - reportedEcpClose);
    const ECP_TOL_ABS = 1; // un peso COP
    if (ecpDiff > ECP_TOL_ABS) {
      errors.push(
        `ECP ↔ Balance: Total Patrimonio ${formatCop(reportedEquity)} != Saldo Final ECP ${formatCop(reportedEcpClose)} ` +
        `(diferencia ${formatCop(ecpDiff)}). Si hubo gap, debe absorberse via "Ajustes de Convergencia / Resultados Acumulados".`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // 4c) EFE closing cash ↔ Balance PUC 11 — HARD FAIL
  // -----------------------------------------------------------------------
  // "Efectivo al final del periodo" del EFE debe cuadrar al centavo con el
  // saldo de Efectivo y Equivalentes (PUC 11) en el Balance. Cualquier
  // diferencia indica un error de presentacion o de calculo que debe
  // corregirse via "Variaciones en Capital de Trabajo (ajuste de cierre)".
  const reportedEfeClose = extractHeadlineTotal(
    consolidatedMarkdown,
    /efectivo\s+al\s+final\s+del\s+per[ií]odo\s*(?:\||:|$|\s{2,})/i,
  );
  if (
    controlTotals?.efectivoCuenta11 !== undefined &&
    reportedEfeClose !== null
  ) {
    const cashDiff = Math.abs(reportedEfeClose - controlTotals.efectivoCuenta11);
    const CASH_TOL_ABS = 1; // un peso COP
    if (cashDiff > CASH_TOL_ABS) {
      errors.push(
        `EFE ↔ Caja: "Efectivo al final del periodo" ${formatCop(reportedEfeClose)} != ` +
        `Efectivo y Equivalentes Balance (PUC 11) ${formatCop(controlTotals.efectivoCuenta11)} ` +
        `(diferencia ${formatCop(cashDiff)}). Debe cerrar al centavo via "Variaciones en Capital de Trabajo (ajuste de cierre)".`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // 4d) Detect negative liabilities/equity in presentation — WARNING
  // -----------------------------------------------------------------------
  // Politica Pulido Diamante: Pasivo y Patrimonio se presentan en valores
  // absolutos en el Balance y en el P&L. Un prefijo "-" indica un error de
  // presentacion (no de signo contable) que confunde al lector.
  const negLiabilityPattern = /total\s+pasivo\s*[|:].*?-\s?\$/i;
  const negEquityPattern = /total\s+patrimonio\s*[|:].*?-\s?\$/i;
  if (
    negLiabilityPattern.test(consolidatedMarkdown) ||
    negEquityPattern.test(consolidatedMarkdown)
  ) {
    warnings.push(
      'Presentacion de signos: se detectaron Pasivo/Patrimonio con prefijo "-". ' +
      'Politica Pulido Diamante exige valores absolutos en Balance y P&L.',
    );
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
    // e2e-niif-03: el encabezado "### 4.2 Saldo Inicial Depurado (PUC 11)" no
    // cita el saldo; su numeración de sección se leía como $4,20 y tumbaba
    // todo informe con AC ≥ PC.
    if (line.startsWith('#')) continue;
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
    // Sólo el primer MONTO tras el rótulo ("PUC 11" no es un monto).
    const tail = textAfterLabel(line, labelPattern);
    const token = tail === null ? null : firstCopAmount(tail, false);
    if (token && Math.abs(token.value) > 1) firstReported = token.value;
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

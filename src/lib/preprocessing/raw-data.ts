// ---------------------------------------------------------------------------
// raw-data — lectura compartida del texto de balance que produce /api/upload.
// ---------------------------------------------------------------------------
// Hay una sola forma de convertir el texto de un balance de prueba en filas y
// la usan todas las superficies: /api/upload (al subir el archivo),
// /api/financial-report/niif y `prepareFinancialContext` (al generar el
// informe). Antes cada una parseaba por su cuenta: el upload entendía los
// bloques `[period=…]` de un XLSX y el informe no; y como el upload anteponía
// su informe de validación al texto, el servidor del informe recibía un
// encabezado que no era el del CSV, obtenía 0 filas y el pipeline corría sin
// preprocesado, sin totales vinculantes y sin gate 422 (ingesta-01).
//
// Formatos aceptados:
//  - CSV/TSV plano (primera línea = encabezado).
//  - Bloques `[period=<hoja>]\n<csv>\n[/period]` (XLSX multihoja).
//  - Cualquiera de los anteriores precedido del informe de validación de
//    /api/upload (`# INFORME DE VALIDACION ARITMETICA…\n---\nDATOS ORIGINALES:`)
//    o del bloque `DATOS LIMPIOS (auxiliares validados):` de las rutas legacy.
//    El informe se descarta: es texto derivado, no dato.
//
// Reglas de periodo por hoja (ingesta-03 / ingesta-04 / ingesta-12):
//  - Si el encabezado de la hoja trae columnas de saldo con año explícito,
//    decide el encabezado; el nombre de la hoja no se impone.
//  - Si no, y el nombre de la hoja trae año, toda la hoja es de ese periodo.
//  - Si no hay año en ninguno, decide el encabezado (igual que un CSV).
//  - Dos hojas del mismo año con mes distinto se etiquetan `YYYY-MM`.
//  - Dos hojas que aportan saldos distintos a la misma cuenta y periodo son
//    un conflicto explícito (`TrialBalanceIngestError`), nunca "gana la última".
//  - Códigos repetidos dentro de una hoja se suman, como en un CSV, con aviso.
// ---------------------------------------------------------------------------

import {
  detectYearFromString,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
  type RawAccountRow,
} from './trial-balance';

/** Encabezado con el que empieza el informe de validación del preprocesador. */
export const VALIDATION_REPORT_HEADING = '# INFORME DE VALIDACION ARITMETICA';

/**
 * Marcadores que separan el informe antepuesto de los datos. El primero lo
 * escribe /api/upload; el segundo las rutas legacy (`enhancedData`).
 */
const DATA_SECTION_REGEX =
  /\n-{3,}[ \t]*\r?\n\s*(?:DATOS ORIGINALES:|DATOS LIMPIOS \(auxiliares validados\):)[^\n]*\r?\n/;

const BLOCK_REGEX = /\[period=([^\]\r\n]+)\]\r?\n([\s\S]*?)\r?\n\[\/period\]/g;

/** Error de ingesta con motivos legibles para el usuario (se sirve como 422). */
export class TrialBalanceIngestError extends Error {
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(reasons.join(' ') || 'No se pudo leer el balance de prueba.');
    this.name = 'TrialBalanceIngestError';
    this.reasons = reasons;
  }
}

export interface UploadDataSection {
  /** Texto de datos (CSV o bloques `[period=…]`) sin el informe. */
  data: string;
  /** `true` si el texto traía el informe de validación antepuesto. */
  hadValidationReport: boolean;
}

/**
 * Separa el informe de validación antepuesto del texto de datos. Si el texto
 * no empieza por el informe, se devuelve intacto.
 */
export function extractUploadDataSection(text: string): UploadDataSection {
  const source = text ?? '';
  const trimmedStart = source.replace(/^﻿/, '').trimStart();
  if (!trimmedStart.startsWith(VALIDATION_REPORT_HEADING)) {
    return { data: source, hadValidationReport: false };
  }
  const match = DATA_SECTION_REGEX.exec(trimmedStart);
  if (!match || match.index === undefined) {
    // Informe sin sección de datos: no hay nada tabular que leer.
    return { data: '', hadValidationReport: true };
  }
  return {
    data: trimmedStart.slice(match.index + match[0].length),
    hadValidationReport: true,
  };
}

// ---------------------------------------------------------------------------
// Periodo por nombre de hoja
// ---------------------------------------------------------------------------

export interface SheetPeriod {
  year: string | null;
  /** Mes 1..12 si el nombre lo indica. */
  month: number | null;
}

const LETTER = 'a-záéíóúüñ';
const MONTH_NAMES: Array<[RegExp, number]> = (
  [
    ['enero|ene|january|jan', 1],
    ['febrero|february|feb', 2],
    ['marzo|march|mar', 3],
    ['abril|april|abr|apr', 4],
    ['mayo|may', 5],
    ['junio|june|jun', 6],
    ['julio|july|jul', 7],
    ['agosto|august|ago|aug', 8],
    ['septiembre|setiembre|september|sept|sep|set', 9],
    ['octubre|october|oct', 10],
    ['noviembre|november|nov', 11],
    ['diciembre|december|dic|dec', 12],
  ] as Array<[string, number]>
).map(([alts, n]) => [new RegExp(`(?<![${LETTER}])(?:${alts})(?![${LETTER}])`, 'i'), n]);

/**
 * Año y mes del nombre de una hoja. A diferencia de `detectYearFromString`,
 * acepta el año pegado a letras o guiones bajos ("Dic2025", "Balance_2025").
 */
export function detectSheetPeriod(label: string): SheetPeriod {
  const s = label ?? '';
  const ym = s.match(/(?<!\d)(20\d{2})[-_/.](0?[1-9]|1[0-2])(?!\d)/);
  if (ym) return { year: ym[1], month: parseInt(ym[2], 10) };
  const my = s.match(/(?<!\d)(0?[1-9]|1[0-2])[-_/.](20\d{2})(?!\d)/);
  if (my) return { year: my[2], month: parseInt(my[1], 10) };
  const yearMatch = s.match(/(?<!\d)(20\d{2})(?!\d)/);
  const year = yearMatch ? yearMatch[1] : null;
  let month: number | null = null;
  for (const [re, n] of MONTH_NAMES) {
    if (re.test(s)) {
      month = n;
      break;
    }
  }
  return { year, month };
}

// ---------------------------------------------------------------------------
// Encabezado: ¿hay columnas de saldo con año explícito?
// ---------------------------------------------------------------------------

function detectSeparator(line: string): string {
  return line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
}

function splitCsvLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === separator && !inQuotes) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Réplica del criterio de columna de saldo del parser (`isBalanceHeader`):
 * contiene saldo/balance/neto y no es una columna de movimientos.
 */
function isBalanceLikeHeader(header: string): boolean {
  const lower = header.toLowerCase();
  if (/\b(debito|debit|credito|credit|debe|haber)\b/.test(lower)) return false;
  return /\b(saldo|balance|neto|saldos)\b/.test(lower);
}

/**
 * `true` si el encabezado del CSV tiene al menos una columna de saldo con año
 * explícito ("Saldo 2025", "Saldo [2025-12]"). En ese caso el encabezado manda
 * sobre el nombre de la hoja.
 */
export function headerHasExplicitPeriodBalanceColumn(csv: string): boolean {
  const firstLine = csv.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return false;
  const headers = splitCsvLine(firstLine, detectSeparator(firstLine)).map((h) => h.trim());
  return headers.some(
    (h) =>
      isBalanceLikeHeader(h) &&
      (detectYearFromString(h) !== null || /^saldo\s*\[\d{4}/i.test(h)),
  );
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

export interface UploadedTrialBalanceParse {
  rows: RawAccountRow[];
  /** Texto de datos efectivamente leído (sin informe antepuesto). */
  dataText: string;
  hadValidationReport: boolean;
  /** Número de bloques `[period=…]` encontrados (0 = CSV plano). */
  blockCount: number;
  /** Avisos no bloqueantes (códigos repetidos sumados, hojas duplicadas). */
  warnings: string[];
}

interface ParsedBlock {
  label: string;
  sheet: SheetPeriod;
  /** Periodo forzado para toda la hoja; `null` = decide el encabezado. */
  forced: string | null;
  rows: RawAccountRow[];
}

function fmtAmount(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

function isDatedPeriod(p: string): boolean {
  return /^20\d{2}(?:-\d{2})?$/.test(p);
}

/** Avisos por códigos repetidos (el preprocesador los suma). */
function duplicateCodeWarnings(rows: RawAccountRow[], where: string): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
  const dups = [...counts.entries()].filter(([, n]) => n > 1);
  if (dups.length === 0) return [];
  const sample = dups
    .slice(0, 5)
    .map(([code, n]) => `${code} (${n} filas)`)
    .join(', ');
  const more = dups.length > 5 ? ` y ${dups.length - 5} más` : '';
  return [
    `${where}: ${dups.length} código(s) de cuenta repetido(s) — ${sample}${more}. ` +
      'Sus saldos se suman (por ejemplo, cartera por tercero).',
  ];
}

/** Agrega filas repetidas del mismo código sumando sus saldos por periodo. */
function aggregateByCode(rows: RawAccountRow[]): RawAccountRow[] {
  const byCode = new Map<string, RawAccountRow>();
  const ordered: RawAccountRow[] = [];
  for (const row of rows) {
    const existing = byCode.get(row.code);
    if (!existing) {
      const clone: RawAccountRow = { ...row, balancesByPeriod: { ...row.balancesByPeriod } };
      byCode.set(row.code, clone);
      ordered.push(clone);
      continue;
    }
    for (const [period, value] of Object.entries(row.balancesByPeriod)) {
      existing.balancesByPeriod[period] =
        period in existing.balancesByPeriod ? existing.balancesByPeriod[period] + value : value;
    }
  }
  return ordered;
}

function parseBlocks(dataText: string): { blocks: Array<{ label: string; csv: string }> } {
  const blocks: Array<{ label: string; csv: string }> = [];
  const re = new RegExp(BLOCK_REGEX.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(dataText)) !== null) {
    blocks.push({ label: m[1].trim(), csv: m[2] });
  }
  return { blocks };
}

/**
 * Convierte el texto de un balance (CSV o bloques por hoja, con o sin el
 * informe de /api/upload antepuesto) en filas crudas.
 *
 * Lanza `TrialBalanceIngestError` cuando varias hojas aportan cifras
 * incompatibles para la misma cuenta y periodo, o cuando los periodos de las
 * hojas no se pueden ordenar cronológicamente.
 */
export function parseUploadedTrialBalanceText(text: string): UploadedTrialBalanceParse {
  const { data, hadValidationReport } = extractUploadDataSection(text);
  const { blocks } = parseBlocks(data);

  if (blocks.length === 0) {
    const rows = parseTrialBalanceCSV(data);
    return {
      rows,
      dataText: data,
      hadValidationReport,
      blockCount: 0,
      warnings: duplicateCodeWarnings(rows, 'Balance'),
    };
  }

  // ── Pasada 1: periodo de cada hoja y filas ─────────────────────────────
  const parsed: ParsedBlock[] = [];
  for (const b of blocks) {
    const sheet = detectSheetPeriod(b.label);
    const headerDecides = headerHasExplicitPeriodBalanceColumn(b.csv);
    const forced = !headerDecides && sheet.year ? sheet.year : null;
    const rows = forced
      ? parseTrialBalanceCSV(b.csv, { forcePeriod: forced })
      : parseTrialBalanceCSV(b.csv);
    // Hojas sin filas contables (notas, portada) no participan.
    if (rows.length > 0) parsed.push({ label: b.label, sheet, forced, rows });
  }

  const warnings: string[] = [];
  if (parsed.length === 0) {
    return { rows: [], dataText: data, hadValidationReport, blockCount: blocks.length, warnings };
  }

  if (parsed.length === 1) {
    // Una sola hoja contable: mismas filas y semántica que un CSV.
    const only = parsed[0];
    return {
      rows: only.rows,
      dataText: data,
      hadValidationReport,
      blockCount: blocks.length,
      warnings: duplicateCodeWarnings(only.rows, `Hoja "${only.label}"`),
    };
  }

  // ── Pasada 2: hojas del mismo año con meses distintos → YYYY-MM ─────────
  const byYear = new Map<string, ParsedBlock[]>();
  for (const p of parsed) {
    if (!p.forced) continue;
    const list = byYear.get(p.forced) ?? [];
    list.push(p);
    byYear.set(p.forced, list);
  }
  for (const [year, group] of byYear) {
    if (group.length < 2) continue;
    const months = group.map((g) => g.sheet.month);
    const allHaveMonth = months.every((m) => m !== null);
    const distinct = new Set(months).size === months.length;
    if (!allHaveMonth || !distinct) continue; // se resuelve como conflicto abajo
    for (const g of group) {
      const label = `${year}-${String(g.sheet.month).padStart(2, '0')}`;
      g.forced = label;
      g.rows = g.rows.map((r) => ({
        ...r,
        balancesByPeriod: { [label]: r.balancesByPeriod[year] },
      }));
    }
  }

  // El preprocesador ordena los años puros antes que cualquier otra etiqueta.
  // Mezclar `YYYY` y `YYYY-MM` sólo es cronológico si todos los años puros son
  // anteriores; si no, se pide renombrar las hojas en vez de invertir el orden.
  const monthLabels = parsed
    .map((p) => p.forced)
    .filter((f): f is string => !!f && /^20\d{2}-\d{2}$/.test(f));
  if (monthLabels.length > 0) {
    const minMonthYear = Math.min(...monthLabels.map((l) => parseInt(l.slice(0, 4), 10)));
    const pureYears = new Set<number>();
    for (const p of parsed) {
      for (const r of p.rows) {
        for (const k of Object.keys(r.balancesByPeriod)) {
          if (/^20\d{2}$/.test(k)) pureYears.add(parseInt(k, 10));
        }
      }
    }
    const offending = [...pureYears].filter((y) => y >= minMonthYear);
    if (offending.length > 0) {
      throw new TrialBalanceIngestError([
        `El libro mezcla hojas mensuales (${[...new Set(monthLabels)].sort().join(', ')}) con ` +
          `periodos anuales (${offending.sort().join(', ')}) que no se pueden ordenar ` +
          'cronológicamente. Nombre cada hoja con mes y año (p. ej. "Dic 2025").',
      ]);
    }
  }

  // ── Pasada 3: sumar repetidos dentro de cada hoja y fusionar entre hojas ─
  const merged = new Map<string, RawAccountRow>();
  const ordered: RawAccountRow[] = [];
  const source = new Map<string, string>(); // `${code}\u0000${period}` → hoja
  const conflicts: string[] = [];
  let conflictCount = 0;
  const identicalSheets = new Set<string>();

  for (const p of parsed) {
    warnings.push(...duplicateCodeWarnings(p.rows, `Hoja "${p.label}"`));
    for (const row of aggregateByCode(p.rows)) {
      const existing = merged.get(row.code);
      if (!existing) {
        merged.set(row.code, row);
        ordered.push(row);
        for (const period of Object.keys(row.balancesByPeriod)) {
          source.set(`${row.code}\u0000${period}`, p.label);
        }
        continue;
      }
      if (!existing.name && row.name) existing.name = row.name;
      for (const [period, value] of Object.entries(row.balancesByPeriod)) {
        const key = `${row.code}\u0000${period}`;
        if (!(period in existing.balancesByPeriod)) {
          existing.balancesByPeriod[period] = value;
          source.set(key, p.label);
          continue;
        }
        const prev = existing.balancesByPeriod[period];
        const prevSheet = source.get(key) ?? '?';
        if (Math.abs(prev - value) <= 0.005) {
          identicalSheets.add(`"${prevSheet}" y "${p.label}"`);
          continue;
        }
        conflictCount += 1;
        if (conflicts.length < 5) {
          const periodText = isDatedPeriod(period)
            ? `el periodo ${period}`
            : 'el mismo periodo (las hojas no indican un año interpretable)';
          conflicts.push(
            `Las hojas "${prevSheet}" y "${p.label}" asignan saldos distintos a la cuenta ` +
              `${row.code} en ${periodText}: ${fmtAmount(prev)} frente a ${fmtAmount(value)}.`,
          );
        }
      }
    }
  }

  if (conflictCount > 0) {
    const more = conflictCount > conflicts.length ? ` (${conflictCount} conflictos en total)` : '';
    throw new TrialBalanceIngestError([
      ...conflicts,
      'Nombre cada hoja con su mes y año (p. ej. "Jun 2025" y "Dic 2025") o deje una sola hoja ' +
        `por periodo; no se elige una hoja en silencio${more}.`,
    ]);
  }
  for (const pair of identicalSheets) {
    warnings.push(`Las hojas ${pair} repiten las mismas cifras para el mismo periodo; se usan una sola vez.`);
  }

  return {
    rows: ordered,
    dataText: data,
    hadValidationReport,
    blockCount: blocks.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// ¿Parece un balance tabular?
// ---------------------------------------------------------------------------

/** Mínimo de filas con código PUC para considerar el texto un balance. */
const MIN_BALANCE_LIKE_ROWS = 11;

/** Campos iniciales de cada línea donde se busca el código de cuenta. */
const CODE_FIELD_WINDOW = 4;

/**
 * `true` si el texto tiene la forma de un balance de prueba tabular: más de 10
 * líneas separadas por coma/punto y coma/tabulador (con al menos 3 campos) que
 * llevan un código PUC de 4 o más dígitos en alguno de sus primeros campos
 * (los exports de ERP suelen poner Nivel/Transaccional antes del código).
 *
 * Sirve para no continuar "sólo con el LLM" cuando un balance real no produjo
 * filas (encabezado irreconocible, filas de título, etc.). El texto OCR en
 * tablas Markdown y el texto de un PDF no cuentan: no son CSV por campos.
 */
export function looksLikeTabularTrialBalance(text: string): boolean {
  const { data } = extractUploadDataSection(text ?? '');
  let count = 0;
  for (const rawLine of data.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[')) continue;
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes(',') ? ',' : null;
    if (!sep) continue;
    const fields = splitCsvLine(line, sep);
    if (fields.length < 3) continue;
    // Cuenta (4 dígitos) o más profunda. Clases/grupos de 1-2 dígitos no
    // cuentan: se confunden con numeraciones de fila.
    const hasCode = fields
      .slice(0, CODE_FIELD_WINDOW)
      .some((f) => /^[1-9]\d{3,11}$/.test(f.replace(/["'\s.-]/g, '')));
    if (hasCode) {
      count += 1;
      if (count >= MIN_BALANCE_LIKE_ROWS) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Texto de balance → preprocesado (superficies que reciben `rawData`)
// ---------------------------------------------------------------------------

export type UploadedTrialBalancePreprocess =
  /** Filas leídas y preprocesadas con la misma regla que /upload y /niif. */
  | { kind: 'ok'; preprocessed: PreprocessedBalance; warnings: string[] }
  /**
   * Sin filas contables. `tabular` indica si el texto tiene forma de balance
   * de prueba (códigos PUC por campos): en ese caso no puede continuar como si
   * no hubiera balance (Stage 0 responde 422).
   */
  | { kind: 'empty'; tabular: boolean }
  /** Hojas/periodos incompatibles (`TrialBalanceIngestError`). */
  | { kind: 'rejected'; reasons: string[] };

/**
 * Lee y preprocesa el `rawData` que envía la UI (CSV, bloques XLSX
 * `[period=…]`, con o sin el informe de /api/upload antepuesto) con el MISMO
 * helper que /upload, /niif y `prepareFinancialContext`. Lo usan /export y la
 * ruta legacy, que antes parseaban el texto con `parseTrialBalanceCSV` y
 * obtenían 0 filas para un XLSX (ingesta-01, pipeline-flujo-06/07).
 */
export function preprocessUploadedTrialBalanceText(text: string): UploadedTrialBalancePreprocess {
  let rows: RawAccountRow[];
  let warnings: string[];
  try {
    const parsed = parseUploadedTrialBalanceText(text);
    rows = parsed.rows;
    warnings = parsed.warnings;
  } catch (err) {
    if (err instanceof TrialBalanceIngestError) return { kind: 'rejected', reasons: err.reasons };
    throw err;
  }
  if (rows.length === 0) return { kind: 'empty', tabular: looksLikeTabularTrialBalance(text) };
  return { kind: 'ok', preprocessed: preprocessTrialBalance(rows), warnings };
}

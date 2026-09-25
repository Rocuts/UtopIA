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
//  - Una hoja cuyo nombre trae un mes distinto de diciembre ("Junio 2025") es
//    un corte parcial y conserva `YYYY-MM` (su P&G cubre MM meses y los KPIs
//    se anualizan, ratios-kpis-18). Si el libro tiene alguna hoja así, las
//    demás hojas con mes también se rotulan `YYYY-MM` (orden cronológico
//    explícito). Diciembre o sin mes: `YYYY` (convención de cierre anual).
//  - Las columnas de saldo inicial/anterior se publican en `openingPeriods`
//    (ingesta-09) para que el preprocesador marque `saldosDeApertura`.
//  - Dos hojas que aportan saldos distintos a la misma cuenta y periodo son
//    un conflicto explícito (`TrialBalanceIngestError`), nunca "gana la última".
//  - Códigos repetidos dentro de una hoja se suman, como en un CSV, con aviso.
// ---------------------------------------------------------------------------

import {
  escribirDirectivasIngesta,
  esVencimiento,
  leerDirectivasIngesta,
  motivoCodigoVencimientoInvalido,
  type UnidadMonetaria,
  type Vencimiento,
} from '@/lib/upload/ingest-directives';
import {
  aplicarVencimientosDeclarados,
  detectYearFromString,
  findTrialBalanceHeaderLine,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type CorteDeclarado,
  type NotaIngesta,
  type ParseTrialBalanceOptions,
  type PreprocessedBalance,
  type RawAccountRow,
  type UnidadDeclaradaDetectada,
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

/**
 * Marca que /api/upload añade al final del texto de un XLSX leído SIN unidad
 * confirmada cuando alguna celda perdió decimales al serializarse a centavos
 * (recalculo-final2-04). Con esa marca, una confirmación posterior de "miles"
 * o "millones" (campo `unitMultiplier` de /niif, /export, /consolidate o una
 * directiva en el texto) reexpresaría cifras ya redondeadas a 0,01 de la
 * unidad: se rechaza y se pide reenviar el archivo a /api/upload con la
 * unidad, que lo lee a precisión completa.
 */
export const MARCA_XLSX_A_CENTAVOS = '[celdas-xlsx=centavos]';
const MARCA_XLSX_A_CENTAVOS_RE = /^\[celdas-xlsx=centavos\][ \t]*\r?$/m;

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
  // Las directivas de ingesta confirmadas por el usuario (P4) van antes que el
  // informe y se conservan delante de los datos: quien re-deriva el balance
  // desde `data` (Stage 0 del orquestador) debe leer la misma confirmación.
  const directivas = leerDirectivasIngesta(source);
  const body = directivas.tieneDirectivas ? directivas.resto : source;
  const trimmedStart = body.replace(/^﻿/, '').trimStart();
  if (!trimmedStart.startsWith(VALIDATION_REPORT_HEADING)) {
    return { data: source, hadValidationReport: false };
  }
  const match = DATA_SECTION_REGEX.exec(trimmedStart);
  if (!match || match.index === undefined) {
    // Informe sin sección de datos: no hay nada tabular que leer.
    return { data: '', hadValidationReport: true };
  }
  return {
    data: directivas.prefijo + trimmedStart.slice(match.index + match[0].length),
    hadValidationReport: true,
  };
}

/** Texto de un ARCHIVO subido sin lo que sólo el servidor puede escribir. */
export interface TextoDelArchivo {
  /** Texto tabular del archivo, sin directivas ni informe antepuesto. */
  text: string;
  /** El archivo traía directivas de ingesta (en cualquier nivel). */
  descartoDirectivas: boolean;
  /** El archivo empezaba con un informe de validación (texto derivado). */
  descartoInforme: boolean;
}

/**
 * Las directivas de ingesta (`[unidad-confirmada=…]`, `[vencimientos=…]`) y el
 * informe de validación antepuesto (`# INFORME DE VALIDACION ARITMETICA … ---
 * DATOS ORIGINALES:`) los escribe el servidor con la confirmación de la
 * solicitud. Un ARCHIVO subido no puede traerlos: si los trae (al inicio, tras
 * un informe imitado o en informes anidados), se descartan todos los niveles y
 * sólo queda el dato tabular (ICU-01). Sin ellos devuelve el texto intacto.
 */
export function descartarConfirmacionesDelArchivo(text: string): TextoDelArchivo {
  let actual = text ?? '';
  let descartoDirectivas = false;
  let descartoInforme = false;
  for (;;) {
    const directivas = leerDirectivasIngesta(actual);
    if (directivas.tieneDirectivas) {
      descartoDirectivas = true;
      actual = directivas.resto;
    }
    const seccion = extractUploadDataSection(actual);
    // Un informe SIN sección de datos no trae nada tabular que confirmar: se
    // conserva como texto (p. ej. un informe descargado que se sube como
    // contexto del chat) en vez de vaciar el documento.
    if (!seccion.hadValidationReport || !seccion.data.trim()) break;
    descartoInforme = true;
    actual = seccion.data;
  }
  return { text: actual, descartoDirectivas, descartoInforme };
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
 *
 * El encabezado es la línea que elige el parser, no la primera del bloque: un
 * título "Balance de prueba a junio 30 de 2025" (o "Balance 2025") antes de un
 * encabezado "codigo, nombre, saldo" no es una columna de saldo con año. Antes
 * se leía la primera línea y la hoja perdía su periodo ("current").
 */
export function headerHasExplicitPeriodBalanceColumn(csv: string): boolean {
  const headerLine =
    findTrialBalanceHeaderLine(csv) ??
    csv.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!headerLine) return false;
  const headers = splitCsvLine(headerLine, detectSeparator(headerLine)).map((h) => h.trim());
  return headers.some(
    (h) =>
      isBalanceLikeHeader(h) &&
      (detectYearFromString(h) !== null || /^saldo\s*\[\d{4}/i.test(h)),
  );
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

/** Confirmaciones del usuario que llegan fuera del texto (body de la solicitud). */
export interface ParseUploadedOptions {
  /**
   * Unidad confirmada por un campo de la solicitud (`unitMultiplier` de /niif,
   * `unit` del API v1). Si el texto también trae la directiva, deben coincidir.
   */
  unidadConfirmada?: UnidadMonetaria;
  /** Excepciones de vencimiento por código (se suman a las de la directiva). */
  vencimientos?: Readonly<Record<string, Vencimiento>>;
}

export interface UploadedTrialBalanceParse {
  rows: RawAccountRow[];
  /** Texto de datos efectivamente leído (sin informe antepuesto ni directivas). */
  dataText: string;
  hadValidationReport: boolean;
  /** Número de bloques `[period=…]` encontrados (0 = CSV plano). */
  blockCount: number;
  /** Avisos no bloqueantes (códigos repetidos sumados, hojas duplicadas). */
  warnings: string[];
  /**
   * ingesta-09: periodos cuyos saldos provienen SÓLO de columnas de saldo
   * inicial / anterior (`balanceColumns` con `kind === 'opening'`). Se pasan a
   * `preprocessTrialBalance(rows, { openingPeriods })`, que marca esos
   * snapshots `saldosDeApertura` (P&G comparativo N/D). Un periodo que alguna
   * columna de cierre también aporta no se incluye.
   */
  openingPeriods: string[];
  /**
   * P4-a: unidad que declara el archivo (`null` si ninguna) y la confirmada
   * por el usuario (`null` sin confirmación). Declarada sin confirmar ⇒ las
   * filas llevan el motivo bloqueante de recalculo-final-03.
   */
  unidad: { declarada: UnidadDeclaradaDetectada | null; confirmada: UnidadMonetaria | null };
  /** P4-b: excepciones de vencimiento aplicadas (`null` sin excepciones). */
  vencimientos: Record<string, Vencimiento> | null;
}

interface ParsedBlock {
  label: string;
  sheet: SheetPeriod;
  /** Periodo forzado para toda la hoja; `null` = decide el encabezado. */
  forced: string | null;
  rows: RawAccountRow[];
  /** Periodos de columnas de apertura / de cierre de la hoja (ingesta-09). */
  openingPeriods: Set<string>;
  closingPeriods: Set<string>;
  unidadDeclarada: UnidadDeclaradaDetectada | null;
  /** Fecha de corte declarada en el título de la hoja (P4-c). */
  corte: CorteDeclarado | null;
}

/** Filas, periodos de apertura/cierre, unidad y corte de un CSV (una hoja o el archivo plano). */
function parseSheetCsv(
  csv: string,
  options: ParseTrialBalanceOptions = {},
): Omit<ParsedBlock, 'label' | 'sheet' | 'forced'> {
  const parsed = parseTrialBalanceCSVWithMeta(csv, options);
  const openingPeriods = new Set<string>();
  const closingPeriods = new Set<string>();
  for (const col of parsed.balanceColumns) {
    (col.kind === 'opening' ? openingPeriods : closingPeriods).add(col.period);
  }
  return {
    rows: parsed.rows,
    openingPeriods,
    closingPeriods,
    unidadDeclarada: parsed.unidadDeclarada,
    corte: parsed.corteDeclarado,
  };
}

/**
 * Mes del corte de una hoja: el del nombre ("Junio 2025") o, si el nombre sólo
 * trae el año, el de la fecha de corte de su título ("a junio 30 de 2025").
 */
function monthOf(block: ParsedBlock): number | null {
  if (block.sheet.month !== null) return block.sheet.month;
  if (block.corte && block.forced && block.corte.year === block.forced) return block.corte.month;
  return null;
}

/** Periodos sólo de apertura: los de cierre de cualquier hoja prevalecen. */
function openingOnly(sheets: Array<{ openingPeriods: Set<string>; closingPeriods: Set<string> }>): string[] {
  const closing = new Set(sheets.flatMap((s) => [...s.closingPeriods]));
  const opening = new Set(sheets.flatMap((s) => [...s.openingPeriods]));
  return [...opening].filter((p) => !closing.has(p)).sort();
}

/**
 * Re-rotula el periodo forzado `year` de una hoja como `label`: saldos,
 * problemas de lectura y notas de ingesta de las filas, y columnas. Un problema
 * de lectura que conservara el año ya no coincidiría con el periodo del
 * snapshot y se perdería en silencio.
 */
function relabelBlock(block: ParsedBlock, year: string, label: string): void {
  block.forced = label;
  const swap = <T extends { period: string | null }>(items: T[] | undefined): T[] | undefined =>
    items?.map((i) => (i.period === year ? { ...i, period: label } : i));
  block.rows = block.rows.map((r) => {
    const touchesIssues = (r.parseIssues ?? []).some((i) => i.period === year);
    const touchesNotes = (r.notasIngesta ?? []).some((n) => n.period === year);
    if (!(year in r.balancesByPeriod) && !touchesIssues && !touchesNotes) return r;
    const balancesByPeriod: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.balancesByPeriod)) balancesByPeriod[k === year ? label : k] = v;
    return {
      ...r,
      balancesByPeriod,
      ...(r.parseIssues ? { parseIssues: swap(r.parseIssues) } : {}),
      ...(r.notasIngesta ? { notasIngesta: swap(r.notasIngesta) } : {}),
    };
  });
  for (const set of [block.openingPeriods, block.closingPeriods]) {
    if (set.delete(year)) set.add(label);
  }
}

/**
 * Re-rotula la hoja al mes `month` (`AAAA-MM`). Si el mes salió de la fecha de
 * corte del título (el nombre de la hoja sólo trae el año, P4-c) se deja la
 * nota de ingesta con el corte: la nota de base de los KPIs cita el texto del
 * archivo y el informe de validación explica por qué la hoja "2025" es un
 * corte de `month` meses. Un corte a diciembre ya lo anota el parser.
 */
function relabelToMonth(block: ParsedBlock, year: string, month: number): void {
  const label = `${year}-${String(month).padStart(2, '0')}`;
  relabelBlock(block, year, label);
  if (block.sheet.month !== null || !block.corte || block.corte.month !== month || month === 12) return;
  if (block.rows.length === 0) return;
  const nota: NotaIngesta = {
    period: label,
    message:
      `Fecha de corte declarada en la hoja "${block.label}" («${block.corte.texto}»): la hoja del ` +
      `año ${year} se trata como corte ${label} (P&G de ${month} meses).`,
    corte: { tipo: 'parcial', meses: month, texto: block.corte.texto },
  };
  const [first, ...rest] = block.rows;
  block.rows = [{ ...first, notasIngesta: [...(first.notasIngesta ?? []), nota] }, ...rest];
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

/** Une listas de problemas o notas sin duplicar (periodo + mensaje). */
function mergeTagged<T extends { period: string | null; message: string }>(
  a: T[] | undefined,
  b: T[] | undefined,
): T[] | undefined {
  if (!b || b.length === 0) return a;
  const out = [...(a ?? [])];
  const seen = new Set(out.map((i) => `${i.period}\u0000${i.message}`));
  for (const item of b) {
    const key = `${item.period}\u0000${item.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Agrega filas repetidas del mismo código sumando sus saldos por periodo. Los
 * problemas de lectura y las notas de las filas repetidas se conservan.
 */
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
    const issues = mergeTagged(existing.parseIssues, row.parseIssues);
    if (issues) existing.parseIssues = issues;
    const notas = mergeTagged(existing.notasIngesta, row.notasIngesta);
    if (notas) existing.notasIngesta = notas;
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
 * Confirmaciones efectivas: directivas del texto + campos de la solicitud. Una
 * directiva mal formada o una contradicción entre ambas fuentes es un motivo
 * de ingesta (422), nunca se elige una en silencio.
 */
function resolveConfirmations(
  text: string,
  options: ParseUploadedOptions,
): { body: string; unidadConfirmada: UnidadMonetaria | null; vencimientos: Record<string, Vencimiento> | null } {
  const lectura = leerDirectivasIngesta(text ?? '');
  const errores = [...lectura.errores];
  let unidadConfirmada = lectura.unidadConfirmada;
  if (options.unidadConfirmada) {
    if (unidadConfirmada && unidadConfirmada !== options.unidadConfirmada) {
      errores.push(
        `La unidad confirmada en el balance (${unidadConfirmada}) y la de la solicitud ` +
          `(${options.unidadConfirmada}) no coinciden; confirme una sola.`,
      );
    } else {
      unidadConfirmada = options.unidadConfirmada;
    }
  }
  if ((unidadConfirmada === 'miles' || unidadConfirmada === 'millones') && MARCA_XLSX_A_CENTAVOS_RE.test(text ?? '')) {
    errores.push(
      `La unidad (${unidadConfirmada} de pesos) se confirmó sobre el texto de un XLSX que se leyó con sus ` +
        'celdas redondeadas a dos decimales de la unidad: reexpresarlo publicaría cifras aproximadas. ' +
        'Para confirmar la unidad vuelva a subir el archivo con la unidad (campo unitMultiplier de ' +
        '/api/upload, como hace el formulario del informe), que lo lee a precisión completa.',
    );
  }
  const vencimientos: Record<string, Vencimiento> = { ...(lectura.vencimientos ?? {}) };
  for (const [codigo, plazo] of Object.entries(options.vencimientos ?? {})) {
    const invalido = motivoCodigoVencimientoInvalido(codigo);
    if (invalido || !esVencimiento(plazo)) {
      errores.push(
        `Excepción de vencimiento inválida en la solicitud: ${invalido ?? `${codigo} debe ser corriente o no_corriente.`}`,
      );
      continue;
    }
    if (codigo in vencimientos && vencimientos[codigo] !== plazo) {
      errores.push(`La cuenta ${codigo} tiene vencimientos distintos en el balance y en la solicitud.`);
      continue;
    }
    vencimientos[codigo] = plazo;
  }
  if (errores.length > 0) throw new TrialBalanceIngestError(errores);
  return {
    body: lectura.tieneDirectivas ? lectura.resto : text ?? '',
    unidadConfirmada,
    vencimientos: Object.keys(vencimientos).length > 0 ? vencimientos : null,
  };
}

/**
 * Incorpora al texto del balance las confirmaciones que llegan como campos de
 * la solicitud (`unitMultiplier` / `maturityOverrides` de /niif, P4): se
 * escriben como directivas al inicio para que TODA superficie que re-deriva
 * el balance desde `rawData` (Stage 0, agentes, /export) lea la misma
 * confirmación. Una contradicción con las directivas que ya trae el texto, una
 * directiva mal formada o un código que no es de activo o pasivo lanza
 * `TrialBalanceIngestError` (422): nunca se elige una fuente en silencio. Sin
 * opciones devuelve el texto intacto.
 */
export function incorporarConfirmaciones(text: string, options: ParseUploadedOptions): string {
  const tieneVencimientos = Object.keys(options.vencimientos ?? {}).length > 0;
  if (!options.unidadConfirmada && !tieneVencimientos) return text;
  // Las directivas se contrastan contra la sección de datos, igual que al
  // parsear: el texto con el informe antepuesto (`extractedText`) las trae
  // después de "DATOS ORIGINALES:".
  const confirm = resolveConfirmations(extractUploadDataSection(text).data, options);
  return escribirDirectivasIngesta(text, {
    unidadConfirmada: confirm.unidadConfirmada,
    vencimientos: confirm.vencimientos,
  });
}

/**
 * Convierte el texto de un balance (CSV o bloques por hoja, con o sin el
 * informe de /api/upload antepuesto, con o sin directivas de ingesta) en filas
 * crudas.
 *
 * Lanza `TrialBalanceIngestError` cuando varias hojas aportan cifras
 * incompatibles para la misma cuenta y periodo, cuando los periodos de las
 * hojas no se pueden ordenar cronológicamente, o cuando las confirmaciones del
 * usuario (unidad, vencimientos) son inválidas o contradictorias.
 */
export function parseUploadedTrialBalanceText(
  text: string,
  options: ParseUploadedOptions = {},
): UploadedTrialBalanceParse {
  // Primero la sección de datos (conserva al frente las directivas que van
  // antes del informe) y después las confirmaciones: así se leen también las
  // que /api/upload deja tras "DATOS ORIGINALES:" en `extractedText`, igual
  // que Stage 0 del orquestador, que recorta el informe antes de parsear.
  // Antes /niif, /export y la ruta legacy las ignoraban en ese texto y
  // bloqueaban un balance cuya unidad ya estaba confirmada.
  const section = extractUploadDataSection(text);
  const hadValidationReport = section.hadValidationReport;
  const confirm = resolveConfirmations(section.data, options);
  const data = confirm.body;
  const { blocks } = parseBlocks(data);
  const sheetOptions: ParseTrialBalanceOptions = confirm.unidadConfirmada
    ? { unidadConfirmada: confirm.unidadConfirmada }
    : {};

  /** Resultado común: excepciones de vencimiento y unidad del archivo. */
  const finish = (
    rows: RawAccountRow[],
    sheets: Array<Pick<ParsedBlock, 'unidadDeclarada'> & { label?: string }>,
    rest: Pick<UploadedTrialBalanceParse, 'blockCount' | 'warnings' | 'openingPeriods'>,
  ): UploadedTrialBalanceParse => {
    const declaradas = sheets.filter((s) => s.unidadDeclarada !== null);
    const unidades = new Set(declaradas.map((s) => s.unidadDeclarada!.unidad));
    if (confirm.unidadConfirmada && unidades.size > 1) {
      // Una sola confirmación no puede valer para hojas en miles y en millones.
      throw new TrialBalanceIngestError([
        `Las hojas declaran unidades distintas (${[...unidades].join(' y ')}); cargue cada ` +
          'periodo con la misma unidad antes de confirmarla.',
      ]);
    }
    const venc = aplicarVencimientosDeclarados(rows, confirm.vencimientos);
    if (venc.errores.length > 0) throw new TrialBalanceIngestError(venc.errores);
    return {
      rows: venc.rows,
      dataText: data,
      hadValidationReport,
      ...rest,
      unidad: {
        declarada: declaradas[0]?.unidadDeclarada ?? null,
        confirmada: confirm.unidadConfirmada,
      },
      vencimientos: confirm.vencimientos,
    };
  };

  if (blocks.length === 0) {
    const sheet = parseSheetCsv(data, sheetOptions);
    return finish(sheet.rows, [sheet], {
      blockCount: 0,
      warnings: duplicateCodeWarnings(sheet.rows, 'Balance'),
      openingPeriods: openingOnly([sheet]),
    });
  }

  // ── Pasada 1: periodo de cada hoja y filas ─────────────────────────────
  const parsed: ParsedBlock[] = [];
  for (const b of blocks) {
    const sheet = detectSheetPeriod(b.label);
    const headerDecides = headerHasExplicitPeriodBalanceColumn(b.csv);
    const forced = !headerDecides && sheet.year ? sheet.year : null;
    const read = forced
      ? parseSheetCsv(b.csv, { ...sheetOptions, forcePeriod: forced })
      : parseSheetCsv(b.csv, sheetOptions);
    // Hojas sin filas contables (notas, portada) no participan.
    if (read.rows.length > 0) parsed.push({ label: b.label, sheet, forced, ...read });
  }

  const warnings: string[] = [];
  if (parsed.length === 0) {
    return finish([], [], { blockCount: blocks.length, warnings, openingPeriods: [] });
  }

  if (parsed.length === 1) {
    // Una sola hoja contable: mismas filas y semántica que un CSV, salvo el
    // mes de un corte parcial ("Junio 2025" o un título "a junio 30 de 2025"
    // en una hoja "Balance 2025" → 2025-06, ratios-kpis-18 / P4-c).
    const only = parsed[0];
    const month = monthOf(only);
    if (only.forced && /^20\d{2}$/.test(only.forced) && month !== null && month !== 12) {
      relabelToMonth(only, only.forced, month);
    }
    return finish(only.rows, [only], {
      blockCount: blocks.length,
      warnings: duplicateCodeWarnings(only.rows, `Hoja "${only.label}"`),
      openingPeriods: openingOnly([only]),
    });
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
    const months = group.map((g) => monthOf(g));
    const allHaveMonth = months.every((m) => m !== null);
    const distinct = new Set(months).size === months.length;
    if (!allHaveMonth || !distinct) continue; // se resuelve como conflicto abajo
    for (const g of group) {
      relabelToMonth(g, year, monthOf(g)!);
    }
  }

  // ── Pasada 2b: corte parcial en años distintos ("Jun 2024", "Dic 2025") ──
  // Una hoja con mes distinto de diciembre es un corte parcial: si se rotula
  // sólo con el año, su P&G de MM meses se trata como anual (ratios-kpis-18).
  // En ese caso todas las hojas con mes pasan a `YYYY-MM`; las que no traen
  // mes conservan el año.
  const hasPartialSheet = parsed.some((p) => {
    const m = monthOf(p);
    return p.forced && /^20\d{2}$/.test(p.forced) && m !== null && m !== 12;
  });
  if (hasPartialSheet) {
    for (const p of parsed) {
      const m = monthOf(p);
      if (!p.forced || !/^20\d{2}$/.test(p.forced) || m === null) continue;
      relabelToMonth(p, p.forced, m);
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
      // Los problemas de lectura y las notas de la otra hoja no se pierden al
      // fusionar el código (antes sólo se fusionaban los saldos: un motivo
      // bloqueante de la segunda hoja desaparecía si sus códigos ya existían).
      const issues = mergeTagged(existing.parseIssues, row.parseIssues);
      if (issues) existing.parseIssues = issues;
      const notas = mergeTagged(existing.notasIngesta, row.notasIngesta);
      if (notas) existing.notasIngesta = notas;
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

  return finish(ordered, parsed, {
    blockCount: blocks.length,
    warnings,
    openingPeriods: openingOnly(parsed),
  });
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
export function preprocessUploadedTrialBalanceText(
  text: string,
  options: ParseUploadedOptions = {},
): UploadedTrialBalancePreprocess {
  let parsed: UploadedTrialBalanceParse;
  try {
    parsed = parseUploadedTrialBalanceText(text, options);
  } catch (err) {
    if (err instanceof TrialBalanceIngestError) return { kind: 'rejected', reasons: err.reasons };
    throw err;
  }
  if (parsed.rows.length === 0) return { kind: 'empty', tabular: looksLikeTabularTrialBalance(text) };
  return {
    kind: 'ok',
    // ingesta-09: el comparativo leído de la columna de saldo inicial/anterior
    // se marca `saldosDeApertura` (P&G comparativo N/D).
    preprocessed: preprocessTrialBalance(parsed.rows, { openingPeriods: parsed.openingPeriods }),
    warnings: parsed.warnings,
  };
}

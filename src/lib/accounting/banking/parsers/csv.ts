// ---------------------------------------------------------------------------
// parsers/csv.ts — Generic CSV bank statement parser
//
// Handles:
//  - Delimiters: semicolon (;), tab or comma (,) — auto-detected from the header.
//  - Encoding: UTF-8 and latin-1 (Excel CO commonly exports latin-1). If raw
//    Buffer is provided and contains byte sequences that look like
//    ISO-8859-1 (0x80–0xFF without valid UTF-8 continuations), we fall back
//    to latin-1 decoding via TextDecoder.
//  - Column aliases (case-insensitive, accent-tolerant):
//      fecha / date / posted_at / fecha_movimiento
//      descripcion / description / concepto / detalle
//      monto / amount / valor          ← signed single column
//      debito / cargo / charge         ← debit column (positive number, cash out)
//      credito / abono / deposit       ← credit column (positive number, cash in)
//      saldo / balance
//      referencia / reference / ref
//      naturaleza / tipo / dc / signo  ← D/C (débito/crédito) del movimiento
//  - If debit+credit columns: amount = |credit| - |debit|  (positive = cash in;
//    un débito exportado como "-300.000" sigue siendo salida — ingesta-25)
//  - Columna de naturaleza (D/C) con monto siempre positivo: el signo sale de
//    la naturaleza (D = cargo/salida, C = abono/entrada) — ingesta-25.
//  - Orden del archivo (ascendente/descendente) detectado por fechas y, en
//    empate, por la continuidad del saldo; endingBalance = saldo de la fila
//    más reciente según ese orden (ingesta-24).
//  - Números: la desambiguación miles/decimales vive en `./number.ts`
//    (ES-CO `1.234.567,89` y `1.234.567` sin centavos, EN-US `1,234,567.89`).
//    Celda vacía = 0; celda ilegible = fila omitida con warning — NUNCA 0
//    silencioso.
//  - Fechas: DD/MM/AAAA por defecto (Colombia); si esa lectura es imposible se
//    reinterpreta MM/DD/AAAA y se emite warning.
//
// Implements: BankStatementParser
// ---------------------------------------------------------------------------

import type { BankStatementParser, ParsedBankTransaction, ParsedStatement } from '../types';
import { BankingError, BANK_ERR } from '../types';
import { parseMoneyAmount } from './number';

// ── Column alias maps ───────────────────────────────────────────────────────

const DATE_ALIASES = new Set([
  'fecha', 'date', 'posted_at', 'fecha_movimiento',
  'fecha_operacion', 'fechaoperacion', 'fec',
]);
const DESC_ALIASES = new Set([
  'descripcion', 'descripción', 'description', 'concepto',
  'detalle', 'observacion', 'observación', 'glosa',
]);
const AMOUNT_ALIASES = new Set([
  'monto', 'amount', 'valor', 'importe', 'net',
]);
const DEBIT_ALIASES = new Set([
  'debito', 'débito', 'cargo', 'charge', 'debit',
  'egreso', 'retiro', 'salida',
]);
const CREDIT_ALIASES = new Set([
  'credito', 'crédito', 'abono', 'deposit', 'credit',
  'ingreso', 'entrada',
]);
const BALANCE_ALIASES = new Set([
  'saldo', 'balance', 'saldo_final', 'saldo_disponible',
]);
/** Columna de naturaleza del movimiento (D/C). Sólo se usa si TODOS sus
 *  valores no vacíos son indicadores reconocibles de débito/crédito. */
const NATURE_ALIASES = new Set([
  'naturaleza', 'tipo', 'dc', 'cd', 'signo', 'tipomovimiento',
  'tipo_movimiento', 'debitocredito', 'db_cr', 'dbcr', 'crdb', 'naturaleza_mov',
]);
const NATURE_DEBIT = new Set(['d', 'db', 'deb', 'debito', 'debit', 'cargo', 'retiro', 'egreso', '-']);
const NATURE_CREDIT = new Set(['c', 'cr', 'cre', 'cred', 'credito', 'credit', 'abono', 'deposito', 'ingreso', '+']);

function natureOf(raw: string | undefined): 'D' | 'C' | null {
  const k = normalizeHeader(raw ?? '') || (raw ?? '').trim();
  if (NATURE_DEBIT.has(k)) return 'D';
  if (NATURE_CREDIT.has(k)) return 'C';
  return null;
}

const REF_ALIASES = new Set([
  'referencia', 'reference', 'ref', 'numero', 'número',
  'num_operacion', 'num', 'transaccion', 'operacion',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normaliza un encabezado para compararlo contra los alias.
 *
 * ORDEN CRÍTICO: primero NFD + quitar diacríticos, DESPUÉS quitar los
 * caracteres no-\w. Al revés (como estaba), `\w` no matchea 'ó' y el
 * `replace(/[^\w]/g,'')` la BORRABA antes de que NFD la pudiera descomponer:
 * "Descripción" → "descripcin", que no está en `DESC_ALIASES` → el parser
 * lanzaba "No se encontró columna de descripción" con cualquier CSV que
 * trajera encabezados tildados (o sea, casi todos los bancos colombianos).
 */
function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacríticos combinantes
    .toLowerCase()
    .replace(/[^\w]/g, ''); // espacios, guiones, BOM, comillas
}

function decodeContent(content: string | Buffer): string {
  if (typeof content === 'string') return content;
  // Try UTF-8 first
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(content);
    return utf8;
  } catch {
    // Fall back to latin-1
    return new TextDecoder('iso-8859-1').decode(content);
  }
}

type Delimiter = ';' | ',' | '\t';

/**
 * El TAB entra en la detección porque `canParse` acepta `.txt` y el "guardar
 * como texto" de Excel exporta tabulado. Empate → ';' (formato dominante en
 * Colombia: la coma ya está tomada por los decimales).
 */
function detectDelimiter(firstLine: string): Delimiter {
  const counts: Array<[Delimiter, number]> = [
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/**
 * Split a CSV row respecting double-quoted fields.
 * Handles the common case of `"value with, comma"` or `"value with ""quotes"""`.
 */
function splitRow(row: string, delimiter: Delimiter): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuote && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === delimiter && !inQuote) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Celda de importe → número. Distingue "vacía" (0 legítimo: las columnas
 * débito/crédito llegan vacías en la mitad de las filas) de "ilegible"
 * (`null`: el caller omite la fila con warning).
 *
 * La desambiguación miles/decimales vive en `./number.ts` — ver ahí por qué
 * "1.234.567" vale 1.234.567 y no 1,23.
 */
function parseAmountCell(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return 0;
  return parseMoneyAmount(s);
}

interface ParsedCsvDate {
  date: Date;
  /** `true` si la fecha solo tiene sentido leída como MM/DD/YYYY (export EN-US). */
  usFormatAssumed: boolean;
}

/**
 * Construye una fecha UTC validando rangos REALES. `Date.UTC(2026, 14, 1)` no
 * es NaN: JS desborda el mes al año siguiente. Sin esta validación,
 * "01/15/2026" (export en inglés) se aceptaba como día 1 del mes 15 y salía
 * convertido en 2027-03-01 — una transacción desplazada 14 meses, silenciosa.
 */
function makeUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  // Rechaza desbordes tipo 31/02 → 03/03.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Parsea una fecha de extracto. Colombia escribe DD/MM/YYYY, así que ese es el
 * orden por defecto; solo si esa lectura es imposible (mes > 12) se reinterpreta
 * como MM/DD/YYYY y se marca `usFormatAssumed` para que el caller avise —
 * un extracto ambiguo (p.ej. 03/04/2026) NO se puede detectar y se lee como
 * día/mes, que es lo correcto en Colombia.
 */
function parseDate(raw: string): ParsedCsvDate {
  const s = raw.trim();

  // YYYY-MM-DD o YYYY/MM/DD (ISO — sin ambigüedad)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const d = makeUtcDate(+m[1], +m[2], +m[3]);
    if (d) return { date: d, usFormatAssumed: false };
  }

  // DD/MM/YYYY | DD-MM-YYYY  (y su lectura alterna MM/DD/YYYY)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const esCo = makeUtcDate(+m[3], +m[2], +m[1]);
    if (esCo) return { date: esCo, usFormatAssumed: false };
    const enUs = makeUtcDate(+m[3], +m[1], +m[2]);
    if (enUs) return { date: enUs, usFormatAssumed: true };
  }

  // DD/MM/YY  (pivote de siglo: >=50 ⇒ 19xx)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (m) {
    const year = +m[3] >= 50 ? 1900 + +m[3] : 2000 + +m[3];
    const esCo = makeUtcDate(year, +m[2], +m[1]);
    if (esCo) return { date: esCo, usFormatAssumed: false };
    const enUs = makeUtcDate(year, +m[1], +m[2]);
    if (enUs) return { date: enUs, usFormatAssumed: true };
  }

  throw new Error(`No se pudo parsear la fecha: "${raw}"`);
}

// ── BankStatementParser implementation ──────────────────────────────────────

export const csvParser: BankStatementParser = {
  canParse(filename: string, content: string | Buffer): boolean {
    const lower = filename.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.txt')) return false;
    const text = decodeContent(content).slice(0, 2000);
    // Must have at least one plausible delimiter
    return text.includes(';') || text.includes(',');
  },

  async parse(filename: string, content: string | Buffer): Promise<ParsedStatement> {
    const text = decodeContent(content);
    const lines = text
      // Solo se recorta \r y el BOM: hacer `trim()` completo borraba tabs y
      // espacios de borde, y con delimitador TAB eso elimina la primera/última
      // columna vacía y DESPLAZA todos los índices de columna.
      .split(/\r?\n/)
      .map((l) => l.replace(/^﻿/, '').replace(/\r$/, ''))
      .filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        'El archivo CSV tiene menos de 2 filas (encabezado + al menos 1 movimiento).',
      );
    }

    const delimiter = detectDelimiter(lines[0]);
    const rawHeaders = splitRow(lines[0], delimiter);
    const headers = rawHeaders.map(normalizeHeader);

    // Map header index → semantic column
    const colDate = findCol(headers, DATE_ALIASES);
    const colDesc = findCol(headers, DESC_ALIASES);
    const colAmount = findCol(headers, AMOUNT_ALIASES);
    const colDebit = findCol(headers, DEBIT_ALIASES);
    const colCredit = findCol(headers, CREDIT_ALIASES);
    const colBalance = findCol(headers, BALANCE_ALIASES);
    const colRef = findCol(headers, REF_ALIASES);
    const colNatureCandidate = findCol(headers, NATURE_ALIASES);

    if (colDate === -1) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `No se encontró columna de fecha. Encabezados detectados: ${rawHeaders.join(', ')}`,
      );
    }
    if (colDesc === -1) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `No se encontró columna de descripción. Encabezados detectados: ${rawHeaders.join(', ')}`,
      );
    }
    const hasSigned = colAmount !== -1;
    const hasSplit = colDebit !== -1 || colCredit !== -1;
    if (!hasSigned && !hasSplit) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `No se encontró columna de monto (monto, amount, valor) ni columnas débito/crédito. Encabezados: ${rawHeaders.join(', ')}`,
      );
    }

    const warnings: string[] = [];

    // Columna de naturaleza: activa sólo si todos sus valores no vacíos son
    // D/C reconocibles (una columna "Tipo" con texto libre se ignora).
    let colNature = -1;
    if (colNatureCandidate !== -1) {
      const values = lines
        .slice(1)
        .map((l) => splitRow(l, delimiter)[colNatureCandidate] ?? '')
        .filter((v) => v.trim().length > 0);
      if (values.length > 0 && values.every((v) => natureOf(v) !== null)) {
        colNature = colNatureCandidate;
      }
    }

    interface Row {
      rowIdx: number;
      postedAt: Date;
      amount: number;
      balance: number | undefined;
      tx: ParsedBankTransaction;
    }
    const parsedRows: Row[] = [];
    let usFormatWarned = false;

    for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
      const cells = splitRow(lines[rowIdx], delimiter);
      if (cells.every((c) => !c)) continue; // blank row

      // Date
      let postedAt: Date;
      try {
        const parsedDate = parseDate(cells[colDate] ?? '');
        postedAt = parsedDate.date;
        if (parsedDate.usFormatAssumed && !usFormatWarned) {
          usFormatWarned = true;
          warnings.push(
            `Fila ${rowIdx + 1}: fecha "${cells[colDate]}" no es válida como DD/MM/AAAA; ` +
              `se interpretó como MM/DD/AAAA (export en inglés). Verifique el periodo del extracto.`,
          );
        }
      } catch {
        warnings.push(`Fila ${rowIdx + 1}: fecha inválida ("${cells[colDate]}") — fila omitida.`);
        continue;
      }

      const description = (cells[colDesc] ?? '').replace(/\s+/g, ' ').trim();
      if (!description) {
        warnings.push(`Fila ${rowIdx + 1}: descripción vacía — fila omitida.`);
        continue;
      }

      // Amount — una celda ilegible NO puede degradarse a 0: eso inventa un
      // movimiento inexistente y descuadra la conciliación sin dejar rastro.
      let amountCop: number;
      if (hasSigned) {
        const signed = parseAmountCell(cells[colAmount]);
        if (signed === null) {
          warnings.push(
            `Fila ${rowIdx + 1}: monto ilegible ("${cells[colAmount]}") — fila omitida.`,
          );
          continue;
        }
        amountCop = signed;
        if (colNature !== -1) {
          const nature = natureOf(cells[colNature]);
          if (nature === null) {
            warnings.push(
              `Fila ${rowIdx + 1}: naturaleza (D/C) vacía con monto ${cells[colAmount]} — fila omitida.`,
            );
            continue;
          }
          amountCop = nature === 'D' ? -Math.abs(signed) : Math.abs(signed);
        }
      } else {
        // |crédito| − |débito|: positivo = entrada. Un débito exportado con
        // signo negativo sigue siendo salida (antes se volvía abono).
        const credit = colCredit !== -1 ? parseAmountCell(cells[colCredit]) : 0;
        const debit = colDebit !== -1 ? parseAmountCell(cells[colDebit]) : 0;
        if (credit === null || debit === null) {
          warnings.push(
            `Fila ${rowIdx + 1}: débito/crédito ilegible ` +
              `("${cells[colDebit] ?? ''}" / "${cells[colCredit] ?? ''}") — fila omitida.`,
          );
          continue;
        }
        amountCop = Math.abs(credit) - Math.abs(debit);
      }

      let balanceValue: number | undefined;
      if (colBalance !== -1 && cells[colBalance]) {
        const parsedBalance = parseMoneyAmount(cells[colBalance]);
        if (parsedBalance === null) {
          warnings.push(
            `Fila ${rowIdx + 1}: saldo ilegible ("${cells[colBalance]}") — se omite el saldo de esta fila.`,
          );
        } else {
          balanceValue = parsedBalance;
        }
      }
      const runningBalance = balanceValue !== undefined ? balanceValue.toFixed(2) : undefined;

      const reference =
        colRef !== -1 && cells[colRef] ? cells[colRef].trim() : undefined;

      parsedRows.push({
        rowIdx,
        postedAt,
        amount: amountCop,
        balance: balanceValue,
        tx: {
          postedAt,
          description,
          amountCop: amountCop.toFixed(2),
          runningBalance,
          reference,
          rawPayload: Object.fromEntries(
            rawHeaders.map((h, i) => [h, cells[i] ?? '']),
          ),
        },
      });
    }

    if (parsedRows.length === 0) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        'El CSV no contiene transacciones válidas tras el encabezado.',
      );
    }

    // ── Orden del archivo (ingesta-24) ────────────────────────────────────────
    const TOL = 1; // 1 peso: redondeos de exportación
    const continuityMisses = (dir: 'asc' | 'desc'): number => {
      let misses = 0;
      for (let i = 1; i < parsedRows.length; i++) {
        const prev = parsedRows[i - 1];
        const cur = parsedRows[i];
        if (prev.balance === undefined || cur.balance === undefined) continue;
        const ok =
          dir === 'asc'
            ? Math.abs(cur.balance - prev.balance - cur.amount) <= TOL
            : Math.abs(prev.balance - cur.balance - prev.amount) <= TOL;
        if (!ok) misses++;
      }
      return misses;
    };
    const firstTime = parsedRows[0].postedAt.getTime();
    const lastTime = parsedRows[parsedRows.length - 1].postedAt.getTime();
    let direction: 'asc' | 'desc';
    if (firstTime < lastTime) direction = 'asc';
    else if (firstTime > lastTime) direction = 'desc';
    else direction = continuityMisses('desc') < continuityMisses('asc') ? 'desc' : 'asc';

    // Continuidad con signo fijo según la dirección: la variación entre filas
    // consecutivas debe igualar el monto (asc: el de la fila actual; desc: el
    // de la fila previa, que es la más reciente). Delata números mal parseados
    // y signos invertidos ANTES de conciliar.
    for (let i = 1; i < parsedRows.length; i++) {
      const prev = parsedRows[i - 1];
      const cur = parsedRows[i];
      if (prev.balance === undefined || cur.balance === undefined) continue;
      const delta = direction === 'asc' ? cur.balance - prev.balance : prev.balance - cur.balance;
      const expected = direction === 'asc' ? cur.amount : prev.amount;
      if (Math.abs(delta - expected) > TOL) {
        warnings.push(
          `Fila ${cur.rowIdx + 1}: el saldo no cuadra con el movimiento ` +
            `(variación ${delta.toFixed(2)} vs monto ${expected.toFixed(2)}). ` +
            `Revise el formato numérico y el signo del archivo antes de conciliar.`,
        );
        break;
      }
    }

    let firstDate: Date | undefined;
    let lastDate: Date | undefined;
    for (const r of parsedRows) {
      if (!firstDate || r.postedAt < firstDate) firstDate = r.postedAt;
      if (!lastDate || r.postedAt > lastDate) lastDate = r.postedAt;
    }

    // `endingBalance` = saldo de la fila MÁS RECIENTE: la última del archivo
    // si es ascendente, la primera si es descendente (con empates de fecha
    // el orden del archivo decide). `runReconciliation` lo usa como saldo
    // bancario de cierre.
    const chronological = direction === 'asc' ? parsedRows : [...parsedRows].reverse();
    let lastBalance: number | undefined;
    for (const r of chronological) {
      if (r.balance !== undefined) lastBalance = r.balance;
    }

    return {
      periodStart: firstDate,
      periodEnd: lastDate,
      endingBalance: lastBalance !== undefined ? lastBalance.toFixed(2) : undefined,
      transactions: parsedRows.map((r) => r.tx),
      warnings,
    };
  },
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function findCol(headers: string[], aliases: Set<string>): number {
  return headers.findIndex((h) => aliases.has(h));
}

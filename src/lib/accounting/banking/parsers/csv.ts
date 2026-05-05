// ---------------------------------------------------------------------------
// parsers/csv.ts — Generic CSV bank statement parser
//
// Handles:
//  - Delimiters: semicolon (;) or comma (,) — auto-detected from first data row.
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
//  - If debit+credit columns: amount = credit - debit  (positive = cash in)
//  - Decimal separator: comma or period (auto-detected per value)
//
// Implements: BankStatementParser
// ---------------------------------------------------------------------------

import type { BankStatementParser, ParsedBankTransaction, ParsedStatement } from '../types';
import { BankingError, BANK_ERR } from '../types';

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
const REF_ALIASES = new Set([
  'referencia', 'reference', 'ref', 'numero', 'número',
  'num_operacion', 'num', 'transaccion', 'operacion',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^\w]/g, '')  // strip spaces, accents chars already lowercased below
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // strip combining diacritics
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

function detectDelimiter(firstLine: string): ';' | ',' {
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ';' : ',';
}

/**
 * Split a CSV row respecting double-quoted fields.
 * Handles the common case of `"value with, comma"` or `"value with ""quotes"""`.
 */
function splitRow(row: string, delimiter: ';' | ','): string[] {
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
 * Parse a Colombian number string.
 * Handles: 1.234.567,89 (ES-CO) and 1,234,567.89 (EN-US) and 1234567.89.
 */
function parseNumber(raw: string): number {
  const s = raw.trim().replace(/[$ ]/g, '');
  if (!s) return 0;
  // Determine decimal separator: if comma appears last after dot → ES-CO
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized: string;
  if (lastComma > lastDot) {
    // ES-CO: dots are thousands, comma is decimal
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else {
    // EN-US or plain: commas are thousands
    normalized = s.replace(/,/g, '');
  }
  return parseFloat(normalized) || 0;
}

/**
 * Parse a date string, trying several formats common in Colombian exports.
 * Returns a UTC-midnight Date or throws.
 */
function parseDate(raw: string): Date {
  const s = raw.trim();
  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (!isNaN(d.getTime())) return d;
  }
  // DD/MM/YY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (m) {
    const year = +m[3] >= 50 ? 1900 + +m[3] : 2000 + +m[3];
    const d = new Date(Date.UTC(year, +m[2] - 1, +m[1]));
    if (!isNaN(d.getTime())) return d;
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
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

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
    const transactions: ParsedBankTransaction[] = [];
    let firstDate: Date | undefined;
    let lastDate: Date | undefined;
    let lastBalance: number | undefined;

    for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
      const cells = splitRow(lines[rowIdx], delimiter);
      if (cells.every((c) => !c)) continue; // blank row

      // Date
      let postedAt: Date;
      try {
        postedAt = parseDate(cells[colDate] ?? '');
      } catch {
        warnings.push(`Fila ${rowIdx + 1}: fecha inválida ("${cells[colDate]}") — fila omitida.`);
        continue;
      }

      const description = (cells[colDesc] ?? '').replace(/\s+/g, ' ').trim();
      if (!description) {
        warnings.push(`Fila ${rowIdx + 1}: descripción vacía — fila omitida.`);
        continue;
      }

      // Amount
      let amountCop: number;
      if (hasSigned) {
        amountCop = parseNumber(cells[colAmount] ?? '');
      } else {
        // credit - debit: positive = cash in
        const credit = colCredit !== -1 ? parseNumber(cells[colCredit] ?? '') : 0;
        const debit = colDebit !== -1 ? parseNumber(cells[colDebit] ?? '') : 0;
        amountCop = credit - debit;
      }

      const runningBalance =
        colBalance !== -1 && cells[colBalance]
          ? parseNumber(cells[colBalance]).toFixed(2)
          : undefined;

      const reference =
        colRef !== -1 && cells[colRef] ? cells[colRef].trim() : undefined;

      const tx: ParsedBankTransaction = {
        postedAt,
        description,
        amountCop: amountCop.toFixed(2),
        runningBalance,
        reference,
        rawPayload: Object.fromEntries(
          rawHeaders.map((h, i) => [h, cells[i] ?? '']),
        ),
      };

      transactions.push(tx);

      if (!firstDate || postedAt < firstDate) firstDate = postedAt;
      if (!lastDate || postedAt > lastDate) lastDate = postedAt;
      if (runningBalance !== undefined) {
        lastBalance = parseFloat(runningBalance);
      }
    }

    if (transactions.length === 0) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        'El CSV no contiene transacciones válidas tras el encabezado.',
      );
    }

    return {
      periodStart: firstDate,
      periodEnd: lastDate,
      endingBalance: lastBalance !== undefined ? lastBalance.toFixed(2) : undefined,
      transactions,
      warnings,
    };
  },
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function findCol(headers: string[], aliases: Set<string>): number {
  return headers.findIndex((h) => aliases.has(h));
}

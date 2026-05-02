// ---------------------------------------------------------------------------
// Pure validator for journal-entry balance.
//
// Why BigInt-on-centavos and NOT Number:
//   Postgres NUMERIC(20,2) holds values up to 18 integer digits exactly.
//   JavaScript's IEEE-754 `number` only represents integers exactly up to
//   2^53 - 1 = 9_007_199_254_740_991 (~16 digits). A modest balance line of
//   COP 99_999_999_999_999.99 (≈ 100 trillion pesos, plausible for a holding)
//   already overflows. We MUST work in integer arithmetic.
//
// Strategy: parse each NUMERIC string as `<integerPart>.<fractionalPart>`,
// scale to centavos (×100), accumulate as BigInt, and compare BigInts.
// Comparison is exact — no tolerance. The Postgres column itself is
// NUMERIC(20,2), so we round at the input boundary to 2 fractional digits.
//
// This file has NO database dependencies — it can be unit-tested in
// isolation and imported anywhere.
// ---------------------------------------------------------------------------

import {
  DoubleEntryError,
  ERR,
  type JournalLineInput,
} from '../types';

/** Centavo factor; 2 fractional decimals.
 * Using `BigInt(100)` instead of the `100n` literal because tsconfig target
 * is ES2017 (literals require ES2020). The runtime is Node 20+ which fully
 * supports BigInt — only the literal *syntax* is gated.
 */
const SCALE = BigInt(100);

/**
 * Parse a NUMERIC-compatible decimal string into a BigInt scaled by SCALE
 * (i.e. centavos). Accepts:
 *   "0", "0.00", "1234.5", "1234.50", "1234.567" (truncated to 2 dec → "1234.56").
 *
 * Rejects negatives, NaN, scientific notation, anything non-decimal.
 *
 * Truncation policy: we explicitly *truncate* the third fractional digit
 * rather than round, to be deterministic and to match Postgres's behavior
 * when casting too-precise numerics into NUMERIC(20,2) (Postgres rounds
 * half-away-from-zero, but our caller has already serialized with the
 * intended precision; truncating here flags rather than masks bugs).
 *
 * Note: an explicit leading '+' is rejected to keep the input shape strict.
 */
function parseCentavos(raw: string, fieldHint: string): bigint {
  if (typeof raw !== 'string') {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      `${fieldHint}: amount must be a string, got ${typeof raw}`,
    );
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      `${fieldHint}: amount cannot be empty`,
    );
  }

  // Disallow signs (we want unsigned NUMERIC; sides are debit XOR credit).
  if (trimmed.startsWith('-') || trimmed.startsWith('+')) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      `${fieldHint}: amount must be unsigned (got "${trimmed}")`,
    );
  }

  // Strict decimal: optional integer + optional fractional. No exp notation.
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(trimmed)) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      `${fieldHint}: amount is not a valid decimal "${trimmed}"`,
    );
  }

  const dot = trimmed.indexOf('.');
  let intPart: string;
  let fracPart: string;

  if (dot < 0) {
    intPart = trimmed;
    fracPart = '';
  } else {
    intPart = trimmed.slice(0, dot) || '0';
    fracPart = trimmed.slice(dot + 1);
  }

  // Truncate to 2 fractional digits (centavos).
  fracPart = fracPart.padEnd(2, '0').slice(0, 2);

  // BigInt() throws on invalid input; we already validated with regex.
  const intBig = BigInt(intPart || '0');
  const fracBig = BigInt(fracPart || '0');
  return intBig * SCALE + fracBig;
}

/** Format BigInt centavos back into a NUMERIC string "1234.56". */
function centavosToString(centavos: bigint): string {
  const ZERO = BigInt(0);
  const negative = centavos < ZERO;
  const abs = negative ? -centavos : centavos;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  const fracStr = fracPart.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${intPart.toString()}.${fracStr}`;
}

export interface ValidateBalanceResult {
  totalDebit: string;
  totalCredit: string;
}

/**
 * Validate that:
 *   (a) at least 2 lines,
 *   (b) every line is exclusively debit OR credit (the other is "0"),
 *   (c) every amount is non-negative,
 *   (d) at least one side is positive on each line,
 *   (e) sum(debit) === sum(credit) exactly.
 *
 * Returns canonical NUMERIC strings (e.g. "1234.56") for `totalDebit` and
 * `totalCredit`, ready to insert into the `journal_entries` row.
 *
 * Throws `DoubleEntryError(INVALID_LINES | UNBALANCED)` on failure.
 */
export function validateBalance(
  lines: JournalLineInput[],
): ValidateBalanceResult {
  if (!Array.isArray(lines)) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'lines must be an array',
    );
  }

  if (lines.length < 2) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'Asiento requiere al menos 2 lineas (partida doble).',
    );
  }

  const ZERO = BigInt(0);
  let totalDebit = ZERO;
  let totalCredit = ZERO;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const hint = `linea ${i + 1}`;

    if (!l || typeof l !== 'object') {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: shape invalido`,
      );
    }
    if (typeof l.accountId !== 'string' || l.accountId.length === 0) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: accountId requerido`,
      );
    }

    const debit = parseCentavos(l.debit, `${hint}.debit`);
    const credit = parseCentavos(l.credit, `${hint}.credit`);

    if (debit < ZERO || credit < ZERO) {
      // parseCentavos already rejects negatives, but defensive double-check.
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: montos no-negativos`,
      );
    }
    if (debit > ZERO && credit > ZERO) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: una linea no puede tener debito Y credito; usa dos lineas`,
      );
    }
    if (debit === ZERO && credit === ZERO) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: monto debe ser > 0`,
      );
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  if (totalDebit !== totalCredit) {
    throw new DoubleEntryError(
      ERR.UNBALANCED,
      `Asiento desbalanceado: total_debito=${centavosToString(totalDebit)} ` +
        `total_credito=${centavosToString(totalCredit)} ` +
        `diff=${centavosToString(totalDebit - totalCredit)}`,
      {
        totalDebit: centavosToString(totalDebit),
        totalCredit: centavosToString(totalCredit),
      },
    );
  }

  return {
    totalDebit: centavosToString(totalDebit),
    totalCredit: centavosToString(totalCredit),
  };
}

/**
 * Helper: build the inverse of a list of lines (debit↔credit) preserving
 * accountId, third party, cost center, and dimensions. Used by
 * `reverseEntry`. Description prefixes with "REVERSO: " when present.
 */
export function buildReversalLines(
  lines: Pick<
    JournalLineInput,
    | 'accountId'
    | 'thirdPartyId'
    | 'costCenterId'
    | 'debit'
    | 'credit'
    | 'currency'
    | 'exchangeRate'
    | 'description'
    | 'dimensions'
  >[],
): JournalLineInput[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    thirdPartyId: l.thirdPartyId ?? null,
    costCenterId: l.costCenterId ?? null,
    debit: l.credit, // swap
    credit: l.debit, // swap
    currency: l.currency,
    exchangeRate: l.exchangeRate,
    description: l.description
      ? `REVERSO: ${l.description}`
      : 'REVERSO',
    dimensions: l.dimensions ?? null,
  }));
}

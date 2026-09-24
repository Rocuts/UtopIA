// ─── WS3 — Banking: contratos públicos (Ola 1+1 Élite) ──────────────────────
//
// El consumidor principal (además del UI propio de WS3) es WS5 (cierre
// mensual): el health check del workflow llama a `getReconciliationStatus`
// y bloquea si hay diferencias > tolerancia. Owner: WS3.

import type {
  BankAccountRow,
  BankReconciliationRow,
  BankStatementImportRow,
  BankTransactionRow,
} from '@/lib/db/schema';

export type {
  BankAccountRow,
  BankReconciliationRow,
  BankStatementImportRow,
  BankTransactionRow,
};

// ---------------------------------------------------------------------------
// Parser: CSV → array de transacciones normalizadas
// ---------------------------------------------------------------------------

export interface ParsedBankTransaction {
  postedAt: Date;
  valueDate?: Date;
  description: string;
  reference?: string;
  /** Signed: positive = abono al cliente, negative = cargo. */
  amountCop: string;
  runningBalance?: string;
  externalId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ParsedStatement {
  bankName?: string;
  accountNumber?: string;
  periodStart?: Date;
  periodEnd?: Date;
  startingBalance?: string;
  endingBalance?: string;
  transactions: ParsedBankTransaction[];
  warnings: string[];
}

export interface BankStatementParser {
  /** Detecta si este parser puede leer el archivo. */
  canParse(filename: string, content: string | Buffer): boolean;
  /** Parsea y devuelve transacciones normalizadas. */
  parse(filename: string, content: string | Buffer): Promise<ParsedStatement>;
}

// ---------------------------------------------------------------------------
// Matcher heurístico
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  journalLineId: string;
  journalEntryId: string;
  journalEntryDate: Date;
  description: string;
  amountCop: string;
  /** 0..1, qué tan seguro está el matcher de que este es el match correcto. */
  confidence: number;
  /** Razón legible del match para debugging. */
  reason: string;
}

export interface MatchResult {
  bankTransactionId: string;
  bestCandidate: MatchCandidate | null;
  alternativeCandidates: MatchCandidate[];
}

export interface BankMatcher {
  /**
   * Para cada bank_transaction sin matchear en (workspaceId, bankAccountId),
   * busca la mejor journal_line candidata. NO modifica DB — devuelve resultados.
   */
  findMatches(input: {
    workspaceId: string;
    bankAccountId: string;
    /** Ventana de búsqueda en days (default: 3). */
    dayWindow?: number;
    /** Tolerancia de monto en COP (default: 1, i.e. centavos). */
    amountToleranceCop?: string;
    /** Solo procesar transacciones posteadas en este rango. */
    fromDate?: Date;
    toDate?: Date;
  }): Promise<MatchResult[]>;
}

// ---------------------------------------------------------------------------
// Reconciliation status (consumido por WS5 en health check)
// ---------------------------------------------------------------------------

/**
 * Valor de `differenceCop` cuando la cuenta NO es conciliable en el período
 * (no hay extracto con saldo final cuyo corte caiga en el período). Antes se
 * usaba '0' como saldo bancario y la "diferencia" era el saldo en libros.
 */
export const RECON_NOT_AVAILABLE = 'N/D';

export interface ReconciliationStatus {
  bankAccountId: string;
  bankAccountLabel: string;
  /** Saldo en libros ACUMULADO al corte del período (débito − crédito). */
  ledgerBalanceCop: string;
  /** Saldo final del extracto del MISMO período; null si no hay extracto. */
  bankBalanceCop: string | null;
  /** libros − extracto (NUMERIC string) o `RECON_NOT_AVAILABLE` si no hay extracto. */
  differenceCop: string;
  matchedCount: number;
  unmatchedCount: number;
  /** Última fecha del extracto importado. */
  lastStatementDate?: Date;
  status: 'open' | 'balanced' | 'reviewed';
  blocking: boolean;
  /** false cuando no hay saldo de extracto del período (N/D, bloquea). */
  reconcilable?: boolean;
  /** Motivo cuando no es conciliable. */
  reason?: string | null;
}

export interface BankReconciliationPort {
  /** Estado actual de conciliación de TODAS las cuentas del workspace para un período. */
  getReconciliationStatus(input: {
    workspaceId: string;
    periodId: string;
  }): Promise<ReconciliationStatus[]>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BankingError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'BankingError';
    this.code = code;
    this.details = details;
  }
}

export const BANK_ERR = {
  PARSE_FAILED: 'BANK_PARSE_FAILED',
  ACCOUNT_NOT_FOUND: 'BANK_ACCOUNT_NOT_FOUND',
  DUPLICATE_IMPORT: 'BANK_DUPLICATE_IMPORT',
  INVALID_INPUT: 'BANK_INVALID_INPUT',
  ENGINE_DISABLED: 'BANK_ENGINE_DISABLED',
} as const;

// ---------------------------------------------------------------------------
// Feature flag helper
// ---------------------------------------------------------------------------

export function isBankReconEnabled(): boolean {
  return process.env.UTOPIA_ENABLE_BANK_RECON === 'true';
}

// ---------------------------------------------------------------------------
// Tolerancia de conciliación (auditoría contab-nomina-11)
// ---------------------------------------------------------------------------
//
// Antes: max($1.000; 0,1 % del saldo en libros) en float — con $1.000
// millones una diferencia NO explicada de $1.000.000 no bloqueaba el cierre y
// el estado quedaba 'balanced'. Ahora la tolerancia es ABSOLUTA, en centavos
// BigInt, sin componente relativo, configurable con
// UTOPIA_BANK_RECON_TOLERANCE_COP (pesos, hasta 2 decimales). Por defecto 0:
// cualquier diferencia no explicada bloquea (las partidas conciliatorias no
// están modeladas; el cierre se puede aprobar con salvedad).

const CENTS = BigInt(100);

/** Parsea un NUMERIC string a centavos; null si no es un número. */
export function parseCentsOrNull(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const neg = t.startsWith('-');
  const abs = neg ? t.slice(1) : t;
  const [i, f = ''] = abs.split('.');
  // Redondeo half-up al centavo (los montos vienen de NUMERIC(20,2)).
  let cents = BigInt(i) * CENTS + BigInt((f + '00').slice(0, 2));
  if (f.length > 2 && Number(f[2]) >= 5) cents += BigInt(1);
  return neg ? -cents : cents;
}

export function centsToNumeric(c: bigint): string {
  const neg = c < BigInt(0);
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / CENTS}.${(a % CENTS).toString().padStart(2, '0')}`;
}

/** Tolerancia absoluta en centavos (default 0). */
export function reconciliationToleranceCents(): bigint {
  const raw = process.env.UTOPIA_BANK_RECON_TOLERANCE_COP;
  const parsed = parseCentsOrNull(raw ?? '0');
  return parsed !== null && parsed >= BigInt(0) ? parsed : BigInt(0);
}

/**
 * ¿La diferencia bloquea el cierre? Sin diferencia calculable (no hay saldo de
 * extracto del período) → bloquea. `ledgerBalanceCop` se conserva en la firma
 * por compatibilidad; la tolerancia ya no depende del saldo.
 */
export function isReconciliationBlocking(
  differenceCop: string | null,
  _ledgerBalanceCop?: string | null,
): boolean {
  void _ledgerBalanceCop;
  const diff = parseCentsOrNull(differenceCop);
  if (diff === null) return true;
  const abs = diff < BigInt(0) ? -diff : diff;
  return abs > reconciliationToleranceCents();
}

export interface ReconciliationFigures {
  /** libros − extracto (NUMERIC string) o null si no hay saldo de extracto. */
  difference: string | null;
  blocking: boolean;
  reconcilable: boolean;
  reason: string | null;
}

/**
 * Diferencia libros − extracto en centavos BigInt. Sin saldo de extracto del
 * período la cuenta NO es conciliable: diferencia null (N/D) y bloquea — no
 * se compara contra 0 (auditoría contab-nomina-09).
 */
export function reconciliationFigures(
  ledgerBalanceCop: string,
  bankBalanceCop: string | null,
): ReconciliationFigures {
  const ledger = parseCentsOrNull(ledgerBalanceCop);
  const bank = parseCentsOrNull(bankBalanceCop);
  if (bank === null) {
    return {
      difference: null,
      blocking: true,
      reconcilable: false,
      reason: 'Sin extracto con saldo final cuyo corte caiga en el período: no conciliable.',
    };
  }
  if (ledger === null) {
    return { difference: null, blocking: true, reconcilable: false, reason: 'Saldo en libros ilegible.' };
  }
  const difference = centsToNumeric(ledger - bank);
  return { difference, blocking: isReconciliationBlocking(difference), reconcilable: true, reason: null };
}

/** 'balanced' sólo con diferencia EXACTAMENTE cero y sin pendientes. */
export function reconciliationStatusFor(
  differenceCop: string | null,
  unmatchedCount: number,
): 'balanced' | 'open' {
  const diff = parseCentsOrNull(differenceCop);
  return diff === BigInt(0) && unmatchedCount === 0 ? 'balanced' : 'open';
}

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

export interface ReconciliationStatus {
  bankAccountId: string;
  bankAccountLabel: string;
  ledgerBalanceCop: string;
  bankBalanceCop: string;
  differenceCop: string;
  matchedCount: number;
  unmatchedCount: number;
  /** Última fecha del extracto importado. */
  lastStatementDate?: Date;
  status: 'open' | 'balanced' | 'reviewed';
  blocking: boolean;
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

/** Tolerancia default de bloqueo: 1000 COP o 0.1% del saldo (lo mayor). */
export function isReconciliationBlocking(
  differenceCop: string,
  ledgerBalanceCop: string,
): boolean {
  const diff = Math.abs(Number(differenceCop));
  const ledger = Math.abs(Number(ledgerBalanceCop));
  const tolerance = Math.max(1000, ledger * 0.001);
  return diff > tolerance;
}

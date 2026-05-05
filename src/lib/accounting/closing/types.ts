// ─── WS5 — Monthly Close Workflow: contratos públicos (Ola 1+1 Élite) ───────
//
// Tipos del workflow durable de cierre mensual. Consume:
//   - WS3 (banking) para health check de conciliación.
//   - WS4 (adjustments) para previews de deprec/amort/provisiones.
//   - WS6 (notifications) para disparar email tras lock.
// Owner: WS5.

import type {
  AccountingPeriodRow,
  MonthlyCloseRunRow,
} from '@/lib/db/schema';
import type { ReconciliationStatus } from '@/lib/accounting/banking/types';

export type { AccountingPeriodRow, MonthlyCloseRunRow };

// ---------------------------------------------------------------------------
// Workflow input
// ---------------------------------------------------------------------------

export interface CloseMonthInput {
  workspaceId: string;
  periodId: string;
  /** Si true, el workflow procede con warnings (override). Default: false. */
  override?: boolean;
  overrideReason?: string;
  overrideBy?: string;
  /** UUID del usuario que disparó el cierre. NULL si vino del cron. */
  triggeredBy?: string;
}

// ---------------------------------------------------------------------------
// Health check result
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  unbalancedEntries: number;
  /** Lista de cuentas bancarias con diferencia > tolerancia. */
  bankReconciliationGaps: Array<{
    bankAccountId: string;
    bankAccountLabel: string;
    differenceCop: string;
    ledgerBalanceCop: string;
    bankBalanceCop: string;
  }>;
  /** Documentos OCR/uploads pendientes de revisión. */
  pendingDocs: number;
  /** Asientos draft que el usuario olvidó postear. */
  draftEntries: number;
  warnings: string[];
  /** Si TRUE el workflow se pausa con createHook esperando approve/reject. */
  blocking: boolean;
  reconciliationStatuses: ReconciliationStatus[];
}

// ---------------------------------------------------------------------------
// Closing entry (zero-out de cuentas de resultado)
// ---------------------------------------------------------------------------

export interface ClosingEntryResult {
  closingEntryId: string;
  /** Suma de ingresos (cuentas tipo INGRESO) cerrados. */
  totalIncomeCop: string;
  /** Suma de gastos + costos cerrados. */
  totalExpenseAndCostCop: string;
  /** Resultado neto trasladado a Patrimonio (Utilidades del Ejercicio). */
  netResultCop: string;
  /** Cuenta destino (típicamente 360500 — Utilidades del Ejercicio). */
  retainedEarningsAccountCode: string;
}

// ---------------------------------------------------------------------------
// Period hash (cadena de integridad)
// ---------------------------------------------------------------------------

export interface PeriodHashInput {
  workspaceId: string;
  periodId: string;
  /** Hash del período inmediatamente anterior; vacío string si es el primero. */
  previousPeriodHash: string;
  /** TRUE si el cierre fue forzado con override. Se concatena al hash. */
  override: boolean;
}

export interface PeriodHashResult {
  /** sha256 hex (64 chars). */
  periodHash: string;
  /** Cuántas journal_entries cubrió el hash. */
  entriesCount: number;
  /** Cuántas journal_lines cubrió el hash. */
  linesCount: number;
}

// ---------------------------------------------------------------------------
// Hook resume payload (cuando el usuario aprueba/rechaza un cierre con warnings)
// ---------------------------------------------------------------------------

export interface CloseHookResumePayload {
  approved: boolean;
  reason?: string;
  approvedBy: string;
}

// ---------------------------------------------------------------------------
// Workflow output
// ---------------------------------------------------------------------------

export interface CloseMonthResult {
  workspaceId: string;
  periodId: string;
  runId: string;
  status: 'completed' | 'cancelled' | 'failed';
  healthCheck: HealthCheckResult;
  depreciationEntryId: string | null;
  amortizationEntryId: string | null;
  provisionEntryIds: string[];
  closingEntry: ClosingEntryResult | null;
  periodHash: string | null;
  previousPeriodHash: string | null;
  pdfReportUrl: string | null;
  excelReportUrl: string | null;
  notifiedAt: Date | null;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ClosingError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ClosingError';
    this.code = code;
    this.details = details;
  }
}

export const CLOSE_ERR = {
  PERIOD_NOT_FOUND: 'CLOSE_PERIOD_NOT_FOUND',
  PERIOD_ALREADY_LOCKED: 'CLOSE_PERIOD_ALREADY_LOCKED',
  HEALTH_CHECK_FAILED: 'CLOSE_HEALTH_CHECK_FAILED',
  CONCURRENT_RUN: 'CLOSE_CONCURRENT_RUN',
  WORKFLOW_DISABLED: 'CLOSE_WORKFLOW_DISABLED',
  UNEXPECTED: 'CLOSE_UNEXPECTED',
} as const;

// ---------------------------------------------------------------------------
// Feature flag + hook token helpers
// ---------------------------------------------------------------------------

export function isMonthlyCloseEnabled(): boolean {
  return process.env.UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW === 'true';
}

/** Token determinístico del hook de approval para un período dado. */
export function closeApprovalHookToken(periodId: string): string {
  return `close-approval:${periodId}`;
}

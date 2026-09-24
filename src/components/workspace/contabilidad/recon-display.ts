/**
 * Presentación del estado de conciliación bancaria.
 *
 * Auditoría 2026-09 (contab-nomina-09): sin extracto del período la cuenta NO
 * es conciliable: `bankBalanceCop` es null, `differenceCop` vale
 * RECON_NOT_AVAILABLE ('N/D') y `reconcilable: false` trae el motivo. Antes la
 * UI intentaba pintar 'N/D' como número y el color dependía de `NaN`.
 */

import {
  RECON_NOT_AVAILABLE,
  type ReconciliationStatus,
} from '@/lib/accounting/banking/types';

export function isNotReconcilable(
  status: Pick<ReconciliationStatus, 'reconcilable' | 'differenceCop' | 'bankBalanceCop'>,
): boolean {
  return (
    status.reconcilable === false ||
    status.differenceCop === RECON_NOT_AVAILABLE ||
    status.bankBalanceCop == null
  );
}

/** Color de la diferencia: N/D o cifra ilegible cuentan como bloqueantes. */
export function diffColor(blocking: boolean, differenceCop: string): string {
  if (differenceCop === RECON_NOT_AVAILABLE) return 'text-red-400';
  const n = Number(differenceCop);
  if (!Number.isFinite(n)) return 'text-red-400';
  if (Math.abs(n) === 0) return 'text-emerald-400';
  if (blocking) return 'text-red-400';
  return 'text-amber-400';
}

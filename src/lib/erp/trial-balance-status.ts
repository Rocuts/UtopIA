// Textos y helpers del estado de un ERPTrialBalance (ver `ERPTrialBalanceStatus`).

import type { ERPTrialBalance, ERPTrialBalanceStatus } from './types';

/**
 * Motivo estándar para los conectores que arman el informe agregando sólo los
 * comprobantes del periodo. Sin saldo inicial una cuenta de balance con saldo
 * y sin movimiento queda en 0 y activo/pasivo/patrimonio reflejan la variación
 * del periodo, no el saldo final.
 */
export function movementsOnlyReason(providerName: string): string {
  return (
    `${providerName} sólo entrega los comprobantes del periodo, sin saldo inicial ni saldos ` +
    'acumulados: las cifras son movimientos del periodo, no saldos finales, y no constituyen ' +
    'un balance de prueba.'
  );
}

/** Estado de un informe con saldos finales a partir de sus advertencias. */
export function statusFromWarnings(warnings: string[]): {
  balanceStatus: ERPTrialBalanceStatus;
  balanceStatusReason: string | null;
} {
  if (warnings.length === 0) return { balanceStatus: 'complete', balanceStatusReason: null };
  return {
    balanceStatus: 'partial',
    balanceStatusReason: `Balance parcial: ${warnings.join(' ')}`,
  };
}

export function isCompleteTrialBalance(tb: Pick<ERPTrialBalance, 'balanceStatus'>): boolean {
  return tb.balanceStatus === 'complete';
}

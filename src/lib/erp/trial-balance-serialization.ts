import type { ERPAccount, ERPTrialBalance } from './types';
import type { RawAccountRow } from '@/lib/preprocessing/trial-balance';
import { leafCodes } from './puc';

function validateTrialBalance(tb: ERPTrialBalance): ERPAccount[] {
  // Sólo saldos finales completos alimentan el pipeline: un informe armado
  // con movimientos del periodo (sin saldo inicial) o parcial no es un
  // balance de prueba y se rechaza con su motivo.
  if (tb.balanceStatus !== 'complete') {
    throw new Error(
      `El ERP no entregó un balance de prueba con saldos finales completos: ${
        tb.balanceStatusReason ?? 'estado del balance no determinado.'
      }`,
    );
  }
  if ((tb.currency ?? '').trim().toUpperCase() !== 'COP') {
    throw new Error('El pipeline COP requiere conversión documentada de moneda antes de importar.');
  }
  if (!/^(?:\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/.test(tb.period)) {
    throw new Error('Periodo ERP inválido o no soportado.');
  }
  const leaves = trialBalanceLeafAccounts(tb);
  for (const account of leaves) {
    if (!/^\d+$/.test(account.code) ||
        ![account.balance, account.debit, account.credit].every(value =>
          Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)))) {
      throw new Error('Cuenta ERP inválida o importe fuera del rango de precisión soportado.');
    }
  }
  return leaves;
}

/**
 * Cuentas hoja del informe, determinadas por la jerarquía real (ninguna otra
 * cuenta del informe es descendiente suya), no por la longitud del código ni
 * por el `isAuxiliary` que haya puesto el conector. Así un informe que trae
 * la subcuenta y sus auxiliares no suma dos veces el mismo saldo.
 */
export function trialBalanceLeafAccounts(tb: Pick<ERPTrialBalance, 'accounts'>): ERPAccount[] {
  const leaves = leafCodes(tb.accounts);
  return tb.accounts.filter(a => leaves.has(a.code));
}

/**
 * Importe redondeado a centavos como texto decimal: enteros sin decimales
 * ("1500000"), fracciones con exactamente dos ("300.30"), nunca notación
 * científica ni ruido IEEE-754 (100.1 + 200.2 = 300.29999999999995). El
 * parser del repo lee un único punto seguido de ≤2 dígitos como decimal.
 */
export function formatErpAmount(value: number): string {
  const cents = BigInt(Math.round(value * 100));
  const negative = cents < BigInt(0);
  const abs = negative ? -cents : cents;
  const hundred = BigInt(100);
  const units = (abs / hundred).toString();
  const fraction = abs % hundred;
  const body = fraction === BigInt(0) ? units : `${units}.${fraction.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** Importe redondeado a centavos como number (misma regla que el CSV). */
function roundToCents(value: number): number {
  return Number(formatErpAmount(value));
}

export function trialBalanceToRawRows(tb: ERPTrialBalance): RawAccountRow[] {
  const leaves = validateTrialBalance(tb);
  return leaves.map(a => ({
    code: a.code, name: a.name, level: 'Auxiliar', transactional: true,
    balancesByPeriod: { [tb.period]: roundToCents(a.balance) },
  }));
}

export function trialBalanceToCSV(tb: ERPTrialBalance): string {
  const leaves = validateTrialBalance(tb);
  // Explicit period tokens preserve months/quarters as well as fiscal years.
  const header = `codigo,nombre,nivel,transaccional,debito,credito,Saldo [${tb.period}]`;
  const rows = leaves.map(a => {
    const name = a.name.replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
    return [
      a.code,
      `"${name}"`,
      'Auxiliar',
      '1',
      formatErpAmount(a.debit),
      formatErpAmount(a.credit),
      formatErpAmount(a.balance),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

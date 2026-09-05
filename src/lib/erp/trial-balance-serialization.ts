import type { ERPTrialBalance } from './types';
import type { RawAccountRow } from '@/lib/preprocessing/trial-balance';

function validateTrialBalance(tb: ERPTrialBalance): void {
  if (tb.currency.trim().toUpperCase() !== 'COP') {
    throw new Error('El pipeline COP requiere conversión documentada de moneda antes de importar.');
  }
  if (!/^(?:\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/.test(tb.period)) {
    throw new Error('Periodo ERP inválido o no soportado.');
  }
  for (const account of tb.accounts.filter(a => a.isAuxiliary)) {
    if (!/^\d+$/.test(account.code) ||
        ![account.balance, account.debit, account.credit].every(value =>
          Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)))) {
      throw new Error('Cuenta ERP inválida o importe fuera del rango de precisión soportado.');
    }
  }
}
export function trialBalanceToRawRows(tb: ERPTrialBalance): RawAccountRow[] {
  validateTrialBalance(tb);
  return tb.accounts.filter(a => a.isAuxiliary).map(a => ({
    code: a.code, name: a.name, level: 'Auxiliar', transactional: true,
    balancesByPeriod: { [tb.period]: a.balance },
  }));
}
export function trialBalanceToCSV(tb: ERPTrialBalance): string {
  validateTrialBalance(tb);
  // Explicit period tokens preserve months/quarters as well as fiscal years.
  const header = `codigo,nombre,nivel,transaccional,debito,credito,Saldo [${tb.period}]`;
  const rows = tb.accounts.filter(a => a.isAuxiliary).map(a => {
    const name = a.name.replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
    return `${a.code},"${name}",Auxiliar,1,${a.debit},${a.credit},${a.balance}`;
  });
  return [header, ...rows].join('\n');
}

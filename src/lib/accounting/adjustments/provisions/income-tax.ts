// ─── WS4 — Provisión impuesto de renta (Art. 240 ET 2026) ───────────────────
//
// Tasa: 35% sobre utilidad antes de impuestos del período.
//
// Utilidad antes de impuestos = INGRESO (saldo crédito neto, clase 4)
//                               - GASTO (saldo débito neto, clase 5)
//                               - COSTO  (saldo débito neto, clase 6)
//
// Esta función es un helper usado por el provisions/calculator.ts cuando
// provisionType === 'income_tax' y pretaxIncome no viene precalculado.
// También puede importarse directamente por el endpoint o por WS5.
//
// Nota: la provisión fiscal (diferida NIC 12) queda diferida para Ola 2.
// En MVP solo se provisiona el impuesto corriente estimado del período.

import type { PeriodAccountBalance } from './calculator';

const SCALE = BigInt(100);
const ZERO = BigInt(0);

function toCentavos(raw: string): bigint {
  const trimmed = (raw ?? '0').trim() || '0';
  const dot = trimmed.indexOf('.');
  const intPart = dot < 0 ? trimmed : trimmed.slice(0, dot) || '0';
  let fracPart = dot < 0 ? '' : trimmed.slice(dot + 1);
  fracPart = fracPart.padEnd(2, '0').slice(0, 2);
  return BigInt(intPart) * SCALE + BigInt(fracPart);
}

function fromCentavos(c: bigint): string {
  const abs = c < ZERO ? -c : c;
  return `${c < ZERO ? '-' : ''}${abs / SCALE}.${(abs % SCALE).toString().padStart(2, '0')}`;
}

/**
 * Calcula la utilidad antes de impuestos del período a partir de los saldos
 * por cuenta. Retorna NUMERIC string; puede ser negativo (pérdida).
 *
 * Convención de saldos:
 *   Ingresos (clase 4): saldo crédito neto = credit - debit.
 *   Gastos   (clase 5): saldo débito neto  = debit - credit.
 *   Costos   (clase 6): saldo débito neto  = debit - credit.
 *
 * PnL = ingresos_netos - gastos_netos - costos_netos
 */
export function computePretaxIncome(
  periodBalances: PeriodAccountBalance[],
): string {
  let ingresos = ZERO;
  let gastos = ZERO;
  let costos = ZERO;

  for (const b of periodBalances) {
    const debit = toCentavos(b.totalDebit);
    const credit = toCentavos(b.totalCredit);
    const code = b.code;

    if (code.startsWith('4')) {
      // INGRESO — saldo normal crédito
      ingresos += credit >= debit ? credit - debit : ZERO;
    } else if (code.startsWith('5')) {
      // GASTO — saldo normal débito
      gastos += debit >= credit ? debit - credit : ZERO;
    } else if (code.startsWith('6')) {
      // COSTO — saldo normal débito
      costos += debit >= credit ? debit - credit : ZERO;
    }
  }

  const pnl = ingresos - gastos - costos;
  return fromCentavos(pnl);
}

/** Tasa renta 2026 — Art. 240 E.T. */
export const INCOME_TAX_RATE_2026 = '0.350000'; // 35.0000%

/**
 * Calcula la provisión de renta = pretaxIncome × 35%.
 * Si pretaxIncome es negativo (pérdida), retorna "0.00".
 */
export function computeIncomeTaxProvision(pretaxIncomeCop: string): string {
  const base = toCentavos(pretaxIncomeCop);
  if (base <= ZERO) return '0.00';

  const RATE_SCALE = BigInt(1_000_000);
  // 35% = 0.350000 → 350000 / 1_000_000
  const rateBig = BigInt(350000);
  const provision = (base * rateBig) / RATE_SCALE;
  return fromCentavos(provision);
}

// ─── WS4 — Provisión impuesto de renta (Art. 240 ET 2026) ───────────────────
//
// Tasa: 35% sobre utilidad antes de impuestos del período.
//
// Utilidad antes de impuestos = INGRESOS NETOS (clase 4, neto de devoluciones)
//                               - GASTOS (clase 5, SIN el grupo 54)
//                               - COSTOS DE VENTAS (clase 6)
//                               - COSTOS DE PRODUCCIÓN (clase 7)
//
// Esta identidad es la MISMA de `controlTotals.utilidadAntesImpuestos` del
// preprocesador canónico (`src/lib/preprocessing/trial-balance.ts`):
//   gastosTotales = clase5 + clase6 + clase7
//   UAI           = ingresosNetos − (gastosTotales − grupo 54)
// Duplicarla con otra regla es lo que produjo el defecto de la auditoría
// 2026-08: este motor POSTEA ASIENTOS REALES, así que una base distinta
// significa dinero mal registrado en los libros.
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
 * Grupo PUC del impuesto de renta y complementarios como GASTO (5405 «De renta
 * y complementarios», 5410 «Industria y comercio», …). Va dentro de la clase 5
 * pero NO puede restarse de la base: la utilidad es ANTES de impuestos, y
 * restarla equivale a provisionar sobre una base ya neta de impuesto.
 */
const GRUPO_IMPUESTOS_GASTO = '54';

/**
 * Calcula la utilidad antes de impuestos del período a partir de los saldos
 * por cuenta. Retorna NUMERIC string; puede ser negativo (pérdida).
 *
 * Convención de saldos — FIRMADA, sin clamp por cuenta:
 *   Ingresos (clase 4): crédito − débito. Una 4175 «Devoluciones en ventas»
 *     tiene naturaleza débito, así que RESTA sola. Clamparla a 0 (lo que hacía
 *     la versión anterior) publicaba el ingreso BRUTO como base del impuesto.
 *     NIIF 15 §47 exige presentar el ingreso neto de devoluciones y rebajas.
 *   Gastos (clase 5): débito − crédito, EXCLUYENDO el grupo 54.
 *   Costos de ventas (clase 6) y de producción (clase 7): débito − crédito.
 *     La clase 7 se ignoraba: una manufacturera con costos abiertos en 7
 *     quedaba con la base inflada por todo el costo de producción.
 *
 * UAI = ingresosNetos − gastos(sin 54) − costos6 − costos7
 *
 * Idéntica a `controlTotals.cents.utilidadAntesImpuestos` del preprocesador.
 */
export function computePretaxIncome(
  periodBalances: PeriodAccountBalance[],
): string {
  let ingresosNetos = ZERO;
  let gastosSin54 = ZERO;
  let costosVentas = ZERO;
  let costosProduccion = ZERO;

  for (const b of periodBalances) {
    const debit = toCentavos(b.totalDebit);
    const credit = toCentavos(b.totalCredit);
    const code = b.code;

    if (code.startsWith('4')) {
      // INGRESO — saldo normal crédito. Firmado: las devoluciones restan.
      ingresosNetos += credit - debit;
    } else if (code.startsWith('5')) {
      // El impuesto de renta causado no entra en su propia base.
      if (code.startsWith(GRUPO_IMPUESTOS_GASTO)) continue;
      // GASTO — saldo normal débito. Firmado: un gasto reversado suma de vuelta.
      gastosSin54 += debit - credit;
    } else if (code.startsWith('6')) {
      // COSTO DE VENTAS — saldo normal débito.
      costosVentas += debit - credit;
    } else if (code.startsWith('7')) {
      // COSTO DE PRODUCCIÓN / DE OPERACIÓN — saldo normal débito.
      costosProduccion += debit - credit;
    }
  }

  const pnl = ingresosNetos - gastosSin54 - costosVentas - costosProduccion;
  return fromCentavos(pnl);
}

/** Tasa renta 2026 — Art. 240 E.T. */
export const INCOME_TAX_RATE_2026 = '0.350000'; // 35.0000%

/**
 * Calcula la provisión de renta = pretaxIncome × 35%.
 * Si pretaxIncome es negativo (pérdida), retorna "0.00".
 *
 * Redondeo half-up al centavo, el mismo que usa el Âncora Fiscal para F02
 * (`pctOfCents` en `fiscal-anchor/calculator.ts`). Truncar aquí y redondear
 * allá hacía que dos superficies del mismo informe difirieran en centavos.
 */
export function computeIncomeTaxProvision(pretaxIncomeCop: string): string {
  const base = toCentavos(pretaxIncomeCop);
  if (base <= ZERO) return '0.00';

  const RATE_SCALE = BigInt(1_000_000);
  // 35% = 0.350000 → 350000 / 1_000_000. Art. 240 E.T. (mod. Art. 10 Ley 2277/2022).
  const rateBig = BigInt(350000);
  const numerator = base * rateBig;
  const quotient = numerator / RATE_SCALE;
  const remainder = numerator % RATE_SCALE;
  const provision =
    remainder * BigInt(2) >= RATE_SCALE ? quotient + BigInt(1) : quotient;
  return fromCentavos(provision);
}

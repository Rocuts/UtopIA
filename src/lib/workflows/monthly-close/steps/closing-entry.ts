// ─── WS5 — Step: closing-entry (zero-out) ────────────────────────────────────
// Genera el asiento de cierre que:
//   - Cancela todos los saldos de cuentas de INGRESO, GASTO y COSTO del período.
//   - Traslada el resultado neto a Patrimonio (cuenta 360500 — Utilidades del
//     Ejercicio / Pérdida del Ejercicio).
//
// Si la suma no cuadra → FatalError (no debería ocurrir dado el invariante de
// partida doble, pero se protege por defensa).

import { FatalError } from 'workflow';
import type { CloseMonthInput, ClosingEntryResult } from '@/lib/accounting/closing/types';
import { createEntry } from '@/lib/accounting/double-entry/service';
import type { JournalLineInput } from '@/lib/accounting/types';
import {
  getAccountPeriodBalance,
  getPeriodById,
  getResultAccounts,
} from '../repository';

// Cuenta destino del resultado neto (Patrimonio — Utilidades del Ejercicio)
const RETAINED_EARNINGS_CODE = '360500';

export async function generateClosingEntry(
  input: CloseMonthInput & { runId: string },
): Promise<ClosingEntryResult> {
  'use step';

  const { workspaceId, periodId } = input;

  const period = await getPeriodById(workspaceId, periodId);
  if (!period) {
    throw new FatalError(`Período ${periodId} no encontrado al generar asiento de cierre.`);
  }

  // Cuentas de resultado activas y postables
  const resultAccounts = await getResultAccounts(workspaceId);
  if (resultAccounts.length === 0) {
    // Sin cuentas de resultado: cierre con resultado cero
    const noopEntry = await createEntry({
      workspaceId,
      periodId,
      entryDate: period.endsAt,
      description: `Cierre mensual período ${period.year}-${String(period.month).padStart(2, '0')} — sin movimientos de resultado`,
      sourceType: 'closing',
      sourceRef: `period:${periodId}`,
      status: 'posted',
      lines: [],
    });
    return {
      closingEntryId: noopEntry.entry.id,
      totalIncomeCop: '0.00',
      totalExpenseAndCostCop: '0.00',
      netResultCop: '0.00',
      retainedEarningsAccountCode: RETAINED_EARNINGS_CODE,
    };
  }

  // Calcular saldos del período por cuenta
  const lines: JournalLineInput[] = [];
  let totalIncome = 0;
  let totalExpenseAndCost = 0;

  for (const account of resultAccounts) {
    // balance > 0 = saldo deudor (neto en el debe); < 0 = saldo acreedor (neto en el haber)
    const balanceStr = await getAccountPeriodBalance(workspaceId, periodId, account.id);
    const balance = parseFloat(balanceStr);

    if (balance === 0) continue;

    if (account.type === 'INGRESO') {
      // Cuentas de ingreso: naturaleza crédito → para cancelar se debita
      // Si balance > 0 (saldo deudor anormal): crédito para cancelar
      // Si balance < 0 (saldo acreedor normal): débito para cancelar
      if (balance < 0) {
        lines.push({
          accountId: account.id,
          debit: Math.abs(balance).toFixed(2),
          credit: '0',
          description: `Cierre ${account.code} ${account.name}`,
        });
        totalIncome += Math.abs(balance);
      } else {
        lines.push({
          accountId: account.id,
          debit: '0',
          credit: balance.toFixed(2),
          description: `Cierre ${account.code} ${account.name}`,
        });
        totalIncome -= balance; // ingreso negativo (poco frecuente)
      }
    } else {
      // GASTO o COSTO: naturaleza débito → para cancelar se acredita
      if (balance > 0) {
        lines.push({
          accountId: account.id,
          debit: '0',
          credit: balance.toFixed(2),
          description: `Cierre ${account.code} ${account.name}`,
        });
        totalExpenseAndCost += balance;
      } else {
        lines.push({
          accountId: account.id,
          debit: Math.abs(balance).toFixed(2),
          credit: '0',
          description: `Cierre ${account.code} ${account.name}`,
        });
        totalExpenseAndCost -= Math.abs(balance);
      }
    }
  }

  // Resultado neto: ingresos - gastos/costos
  const netResult = totalIncome - totalExpenseAndCost;

  // Buscar la cuenta 360500 por código
  const { getDb } = await import('@/lib/db/client');
  const { chartOfAccounts } = await import('@/lib/db/schema');
  const { and, eq } = await import('drizzle-orm');

  const db = getDb();
  const retainedRows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.code, RETAINED_EARNINGS_CODE),
        eq(chartOfAccounts.active, true),
      ),
    )
    .limit(1);

  const retainedAccount = retainedRows[0];

  if (!retainedAccount) {
    // Si no existe la cuenta 360500, omitimos la línea de balance (el asiento
    // podría no cuadrar — se registra el error pero no se lanza FatalError
    // para no bloquear clientes que no han configurado el PUC completo).
    console.warn('[closing-entry] Cuenta 360500 no encontrada — asiento de cierre sin línea de patrimonio.');

    // Si no hay líneas (sin movimientos), retornar noop
    if (lines.length === 0) {
      return {
        closingEntryId: 'no-op',
        totalIncomeCop: '0.00',
        totalExpenseAndCostCop: '0.00',
        netResultCop: '0.00',
        retainedEarningsAccountCode: RETAINED_EARNINGS_CODE,
      };
    }
  } else {
    // Línea de balance hacia patrimonio
    if (netResult > 0) {
      // Utilidad: acreditamos patrimonio
      lines.push({
        accountId: retainedAccount.id,
        debit: '0',
        credit: netResult.toFixed(2),
        description: 'Utilidad neta del ejercicio — cierre mensual',
      });
    } else if (netResult < 0) {
      // Pérdida: debitamos patrimonio
      lines.push({
        accountId: retainedAccount.id,
        debit: Math.abs(netResult).toFixed(2),
        credit: '0',
        description: 'Pérdida neta del ejercicio — cierre mensual',
      });
    }
  }

  // Validar que cuadra (defensa extra)
  if (lines.length > 0) {
    const sumDebit = lines.reduce((s, l) => s + parseFloat(l.debit || '0'), 0);
    const sumCredit = lines.reduce((s, l) => s + parseFloat(l.credit || '0'), 0);
    if (Math.abs(sumDebit - sumCredit) > 0.01) {
      throw new FatalError(
        `Asiento de cierre no cuadra: Débito ${sumDebit.toFixed(2)} ≠ Crédito ${sumCredit.toFixed(2)}. Verificar cuentas de resultado.`,
      );
    }
  }

  // Si no hay líneas (período sin movimientos de resultado)
  if (lines.length === 0) {
    return {
      closingEntryId: 'no-op',
      totalIncomeCop: '0.00',
      totalExpenseAndCostCop: '0.00',
      netResultCop: '0.00',
      retainedEarningsAccountCode: RETAINED_EARNINGS_CODE,
    };
  }

  const periodLabel = `${period.year}-${String(period.month).padStart(2, '0')}`;
  const created = await createEntry({
    workspaceId,
    periodId,
    entryDate: period.endsAt,
    description: `Cierre mensual período ${periodLabel}`,
    sourceType: 'closing',
    sourceRef: `period:${periodId}`,
    status: 'posted',
    lines,
  });

  return {
    closingEntryId: created.entry.id,
    totalIncomeCop: totalIncome.toFixed(2),
    totalExpenseAndCostCop: totalExpenseAndCost.toFixed(2),
    netResultCop: netResult.toFixed(2),
    retainedEarningsAccountCode: RETAINED_EARNINGS_CODE,
  };
}

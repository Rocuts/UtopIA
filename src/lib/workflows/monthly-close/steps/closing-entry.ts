// ─── WS5 — Step: closing-entry ───────────────────────────────────────────────
//
// Auditoría contab-nomina-04 / -03.
//
// Cierre MENSUAL (períodos 1–12): NO traslada resultados a patrimonio. Antes
// el asiento de cierre cancelaba ingresos/gastos dentro del mismo período y
// todo mes cerrado quedaba con P&G/EBITDA 0 en la vista de pilares, el P&G
// del PDF y cualquier reporte por período. El paso sólo calcula el resultado
// del mes (informativo); el bloqueo y el hash lo hacen los pasos siguientes.
//
// Cierre ANUAL (período 13 — "ajustes de cierre", 31-dic): cancela los saldos
// del EJERCICIO de las cuentas de resultado (clases 4, 5 y 6) contra
//   360505 Utilidad del ejercicio  (si hay utilidad)  o
//   361005 Pérdida del ejercicio   (si hay pérdida),
// cuentas del PUC sembrado (antes se buscaba "360500", inexistente, y el
// asiento no cuadraba). Las líneas conservan cuenta + centro de costo +
// tercero, porque las cuentas de resultado del PUC sembrado los exigen. El
// asiento vive en el período 13, así que no anula el P&G de diciembre, y la
// vista de pilares excluye source_type='closing' (migración 0022).
//
// Clase 7 (costos de producción): se traslada a inventarios (14) / costo de
// ventas (61) ANTES del cierre; si tiene saldo, el cierre se detiene con un
// error explícito en vez de llevarla a patrimonio.
//
// Idempotente: sourceRef `fiscal-year:<año>`; un reintento devuelve el
// asiento existente.

import { FatalError } from 'workflow';
import type { CloseMonthInput, ClosingEntryResult } from '@/lib/accounting/closing/types';
import { createEntry } from '@/lib/accounting/double-entry/service';
import { DoubleEntryError, ERR, type JournalLineInput } from '@/lib/accounting/types';
import {
  getPeriodById,
  getPostableAccountByCode,
  getResultBalances,
  type ResultBalanceRow,
} from '../repository';

/** Utilidad del ejercicio (PUC 3605 → subcuenta sembrada). */
export const PROFIT_ACCOUNT_CODE = '360505';
/** Pérdida del ejercicio (PUC 3610 → subcuenta sembrada). */
export const LOSS_ACCOUNT_CODE = '361005';

const SCALE = BigInt(100);
const ZERO = BigInt(0);

function toCents(raw: string): bigint {
  const t = (raw ?? '0').trim() || '0';
  const neg = t.startsWith('-');
  const abs = neg ? t.slice(1) : t;
  const [i, f = ''] = abs.split('.');
  const c = BigInt(i || '0') * SCALE + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
}

function fromCents(c: bigint): string {
  const neg = c < ZERO;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / SCALE}.${(a % SCALE).toString().padStart(2, '0')}`;
}

interface ResultSummary {
  /** Ingresos netos (crédito − débito de INGRESO). */
  income: bigint;
  /** Gastos + costos netos (débito − crédito de GASTO/COSTO). */
  expenseAndCost: bigint;
}

function summarize(rows: ResultBalanceRow[]): ResultSummary {
  let income = ZERO;
  let expenseAndCost = ZERO;
  for (const r of rows) {
    const b = toCents(r.balance);
    if (r.type === 'INGRESO') income -= b;
    else expenseAndCost += b;
  }
  return { income, expenseAndCost };
}

export async function generateClosingEntry(
  input: CloseMonthInput & { runId: string },
): Promise<ClosingEntryResult> {
  'use step';

  const { workspaceId, periodId } = input;

  const period = await getPeriodById(workspaceId, periodId);
  if (!period) {
    throw new FatalError(`Período ${periodId} no encontrado al generar asiento de cierre.`);
  }

  // ── Cierre mensual: sin traslado a patrimonio ──────────────────────────────
  if (period.month !== 13) {
    const s = summarize(await getResultBalances(workspaceId, { periodId }));
    return {
      closingEntryId: 'no-op',
      totalIncomeCop: fromCents(s.income),
      totalExpenseAndCostCop: fromCents(s.expenseAndCost),
      netResultCop: fromCents(s.income - s.expenseAndCost),
      retainedEarningsAccountCode: null,
    };
  }

  // ── Cierre anual (período 13) ──────────────────────────────────────────────
  const rows = (await getResultBalances(workspaceId, { year: period.year })).filter(
    (r) => toCents(r.balance) !== ZERO,
  );

  const class7 = rows.filter((r) => r.code.startsWith('7'));
  if (class7.length > 0) {
    throw new FatalError(
      `Cierre anual ${period.year}: las cuentas de costos de producción (clase 7) ` +
        `${[...new Set(class7.map((r) => r.code))].join(', ')} tienen saldo. Trasládelas a ` +
        'inventarios (14) o costo de ventas (61) antes de cerrar; no se llevan a patrimonio.',
    );
  }

  const s = summarize(rows);
  const net = s.income - s.expenseAndCost;

  const lines: JournalLineInput[] = rows.map((r) => {
    const b = toCents(r.balance);
    // Saldo deudor (b > 0) se cancela con crédito; saldo acreedor con débito.
    return {
      accountId: r.accountId,
      costCenterId: r.costCenterId,
      thirdPartyId: r.thirdPartyId,
      debit: b < ZERO ? fromCents(-b) : '0.00',
      credit: b > ZERO ? fromCents(b) : '0.00',
      description: `Cierre ${period.year} ${r.code} ${r.name}`,
    };
  });

  let equityCode: string | null = null;
  if (net !== ZERO) {
    equityCode = net > ZERO ? PROFIT_ACCOUNT_CODE : LOSS_ACCOUNT_CODE;
    const equity = await getPostableAccountByCode(workspaceId, equityCode);
    if (!equity) {
      throw new FatalError(
        `Cierre anual ${period.year}: falta la cuenta ${equityCode} ` +
          `(${net > ZERO ? 'Utilidad' : 'Pérdida'} del ejercicio) activa y postable en el PUC del workspace.`,
      );
    }
    lines.push({
      accountId: equity.id,
      debit: net < ZERO ? fromCents(-net) : '0.00',
      credit: net > ZERO ? fromCents(net) : '0.00',
      description: `${net > ZERO ? 'Utilidad' : 'Pérdida'} del ejercicio ${period.year}`,
    });
  }

  const summaryOut = {
    totalIncomeCop: fromCents(s.income),
    totalExpenseAndCostCop: fromCents(s.expenseAndCost),
    netResultCop: fromCents(net),
    retainedEarningsAccountCode: equityCode,
  };

  if (lines.length < 2) {
    return { closingEntryId: 'no-op', ...summaryOut };
  }

  try {
    const created = await createEntry(
      {
        workspaceId,
        periodId,
        entryDate: period.endsAt,
        description: `Cierre del ejercicio ${period.year}: traslado del resultado a patrimonio`,
        sourceType: 'closing',
        sourceRef: `fiscal-year:${period.year}`,
        status: 'posted',
        createdBy: input.triggeredBy ?? null,
        lines,
      },
      { idempotentBySource: true },
    );
    return { closingEntryId: created.entry.id, ...summaryOut };
  } catch (err) {
    if (err instanceof DoubleEntryError && err.code === ERR.DUPLICATE_SOURCE) {
      const existing = (err.details as { existingEntryId?: string } | undefined)?.existingEntryId;
      return { closingEntryId: existing ?? 'no-op', ...summaryOut };
    }
    if (err instanceof DoubleEntryError) {
      // Determinista (cuenta inactiva, período no abierto, …): no reintentar.
      throw new FatalError(`Asiento de cierre anual rechazado: ${err.message}`);
    }
    throw err;
  }
}

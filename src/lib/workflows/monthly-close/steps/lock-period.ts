// ─── WS5 — Step: lock-period ─────────────────────────────────────────────────
// Bloquea el período contable: accounting_periods.status = 'locked'.
// Tras este punto ningún asiento nuevo puede crearse en el período.

import { FatalError } from 'workflow';
import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import { getDb } from '@/lib/db/client';
import { accountingPeriods } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getPeriodById } from '../repository';

export async function lockPeriod(input: CloseMonthInput & { runId: string }): Promise<void> {
  'use step';

  const { workspaceId, periodId } = input;

  const period = await getPeriodById(workspaceId, periodId);
  if (!period) {
    throw new FatalError(`lockPeriod: Período ${periodId} no encontrado.`);
  }

  if (period.status === 'locked') {
    // Ya bloqueado — idempotente
    return;
  }

  if (period.status !== 'open' && period.status !== 'closed') {
    throw new FatalError(
      `lockPeriod: No se puede bloquear un período en estado "${period.status}".`,
    );
  }

  const db = getDb();
  const now = new Date();

  await db
    .update(accountingPeriods)
    .set({
      status: 'locked',
      lockedAt: now,
    })
    .where(
      and(
        eq(accountingPeriods.id, periodId),
        eq(accountingPeriods.workspaceId, workspaceId),
      ),
    );
}

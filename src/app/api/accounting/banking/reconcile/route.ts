// ---------------------------------------------------------------------------
// /api/accounting/banking/reconcile
// POST → run heuristic reconciliation for (periodId, bankAccountId)
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { runReconciliation } from '@/lib/accounting/banking';
import { checkEnabled, bankingErrorResponse, badRequestZod, ok } from '../_shared';

const bodySchema = z.object({
  periodId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  dayWindow: z.number().int().min(1).max(30).optional(),
  amountToleranceCop: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = checkEnabled();
  if (guard) return guard;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return ok({ error: 'invalid_json' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await runReconciliation({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      bankAccountId: parsed.data.bankAccountId,
      dayWindow: parsed.data.dayWindow,
      amountToleranceCop: parsed.data.amountToleranceCop,
    });
    return ok(result);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}

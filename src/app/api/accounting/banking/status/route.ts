// ---------------------------------------------------------------------------
// /api/accounting/banking/status
// GET → ?periodId=<uuid>  → ReconciliationStatus[] for all bank accounts
//
// Consumed by: WS5 health check + ReconciliationView UI.
// ---------------------------------------------------------------------------

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { bankReconciliationPort } from '@/lib/accounting/banking';
import { checkEnabled, bankingErrorResponse, ok } from '../_shared';

export async function GET(req: Request) {
  const guard = checkEnabled();
  if (guard) return guard;

  const url = new URL(req.url);
  const periodId = url.searchParams.get('periodId');
  if (!periodId) {
    return ok({ error: 'invalid_query', message: 'periodId es requerido' }, 400);
  }

  try {
    const ws = await getOrCreateWorkspace();
    const statuses = await bankReconciliationPort.getReconciliationStatus({
      workspaceId: ws.id,
      periodId,
    });
    return ok(statuses);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}

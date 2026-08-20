// ─── /api/v1/trial-balances/{id} — detalle recomputado (GET) y borrado ──────
// GET recomputa con el preprocesador vigente (cero desync). DELETE = borrado
// físico (Ley 1581, derecho de supresión). 404 uniforme para id malformado,
// inexistente o ajeno (anti-BOLA: no se distingue).

import { getDb } from '@/lib/db/client';
import { apiJson, withApiV1 } from '@/lib/api/handler';
import { problemResponse } from '@/lib/api/problems';
import { deleteTrialBalance, getTrialBalanceDetail } from '@/lib/api/trial-balances';

export const maxDuration = 60;

export const GET = withApiV1(
  { scopes: ['trial_balances:read'], kind: 'read' },
  async ({ params, requestId, workspaceId }) => {
    const detail = await getTrialBalanceDetail(getDb(), workspaceId, params.id ?? '');
    if (!detail) {
      return problemResponse('not_found', {
        requestId,
        instance: `/api/v1/trial-balances/${params.id}`,
      });
    }
    return apiJson(200, detail, requestId);
  },
);

export const DELETE = withApiV1(
  { scopes: ['trial_balances:write'], kind: 'write' },
  async ({ params, requestId, workspaceId }) => {
    const deleted = await deleteTrialBalance(getDb(), workspaceId, params.id ?? '');
    if (!deleted) {
      return problemResponse('not_found', {
        requestId,
        instance: `/api/v1/trial-balances/${params.id}`,
      });
    }
    return apiJson(204, null, requestId);
  },
);

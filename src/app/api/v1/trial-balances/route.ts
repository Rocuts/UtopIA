// ─── /api/v1/trial-balances — remitir (POST, idempotente) y listar (GET) ────
// Spec: docs/spec/api-clientes-v1.md §7. El POST corre el preprocesador
// determinista (anclas en centavos + curator NIIF) y emite el webhook
// trial_balance.processed. Un balance descuadrado NO es error (status
// unbalanced en el recurso).

import { getDb } from '@/lib/db/client';
import { apiJson, withApiV1 } from '@/lib/api/handler';
import { parsePageParams } from '@/lib/api/pagination';
import { problemResponse } from '@/lib/api/problems';
import { createTrialBalance, listTrialBalances } from '@/lib/api/trial-balances';

export const maxDuration = 60;

export const POST = withApiV1(
  {
    scopes: ['trial_balances:write'],
    kind: 'write',
    readBody: true,
    idempotencyEndpoint: 'trial-balances.create',
  },
  async ({ body, requestId, workspaceId, req }) => {
    const result = await createTrialBalance(getDb(), {
      workspaceId,
      body,
      idempotencyKey: req.headers.get('idempotency-key'),
    });

    if ('problem' in result) {
      return problemResponse(result.problem, {
        requestId,
        instance: '/api/v1/trial-balances',
        errors: 'errors' in result ? result.errors : undefined,
      });
    }

    return apiJson(201, result.body, requestId, {
      Location: `/api/v1/trial-balances/${result.publicId}`,
    });
  },
);

export const GET = withApiV1(
  { scopes: ['trial_balances:read'], kind: 'read' },
  async ({ req, requestId, workspaceId }) => {
    const page = parsePageParams(new URL(req.url));
    if ('invalid' in page) {
      return problemResponse('validation_failed', {
        requestId,
        instance: '/api/v1/trial-balances',
        errors: [{ detail: page.invalid, pointer: '' }],
      });
    }

    const result = await listTrialBalances(getDb(), workspaceId, page);
    const headers: Record<string, string> = {};
    if (result.next_cursor) {
      // RFC 8288 — duplica next_cursor para clientes genéricos.
      const url = new URL(req.url);
      url.searchParams.set('cursor', result.next_cursor);
      headers.Link = `<${url.pathname}?${url.searchParams.toString()}>; rel="next"`;
    }
    return apiJson(200, result, requestId, headers);
  },
);

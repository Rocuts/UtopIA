// ─── /api/v1/webhook-endpoints — registrar (POST) y listar (GET) ────────────
// El secreto whsec_ viaja UNA sola vez en la respuesta del POST. URLs
// validadas anti-SSRF (https, puerto 443, host público).

import { getDb } from '@/lib/db/client';
import { apiJson, withApiV1 } from '@/lib/api/handler';
import { parsePageParams } from '@/lib/api/pagination';
import { problemResponse } from '@/lib/api/problems';
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
} from '@/lib/api/webhook-endpoints';

export const maxDuration = 15;

export const POST = withApiV1(
  { scopes: ['webhooks:manage'], kind: 'write', readBody: true },
  async ({ body, requestId, workspaceId }) => {
    const result = await createWebhookEndpoint(getDb(), workspaceId, body);
    if ('problem' in result) {
      return problemResponse(result.problem, {
        requestId,
        instance: '/api/v1/webhook-endpoints',
        errors: result.errors,
      });
    }
    return apiJson(201, result.body, requestId, {
      Location: `/api/v1/webhook-endpoints/${(result.body as { id: string }).id}`,
    });
  },
);

export const GET = withApiV1(
  { scopes: ['webhooks:manage'], kind: 'read' },
  async ({ req, requestId, workspaceId }) => {
    const page = parsePageParams(new URL(req.url));
    if ('invalid' in page) {
      return problemResponse('validation_failed', {
        requestId,
        instance: '/api/v1/webhook-endpoints',
        errors: [{ detail: page.invalid, pointer: '' }],
      });
    }
    return apiJson(200, await listWebhookEndpoints(getDb(), workspaceId, page), requestId);
  },
);

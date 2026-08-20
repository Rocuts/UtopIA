// ─── /api/v1/webhook-endpoints/{id} — detalle, PATCH (If-Match) y DELETE ────
// Concurrencia optimista RFC 9110: GET expone ETag fuerte; PATCH exige
// If-Match (428 precondition_required sin header, 412 si no coincide).

import { getDb } from '@/lib/db/client';
import { apiJson, withApiV1 } from '@/lib/api/handler';
import { problemResponse } from '@/lib/api/problems';
import {
  deleteWebhookEndpoint,
  endpointEtag,
  findWebhookEndpoint,
  secretPreviewOf,
  serializeWebhookEndpoint,
  updateWebhookEndpoint,
} from '@/lib/api/webhook-endpoints';

export const maxDuration = 15;

export const GET = withApiV1(
  { scopes: ['webhooks:manage'], kind: 'read' },
  async ({ params, requestId, workspaceId }) => {
    const row = await findWebhookEndpoint(getDb(), workspaceId, params.id ?? '');
    if (!row) {
      return problemResponse('not_found', {
        requestId,
        instance: `/api/v1/webhook-endpoints/${params.id}`,
      });
    }
    return apiJson(
      200,
      serializeWebhookEndpoint(row, { secretPreview: secretPreviewOf(row) }),
      requestId,
      { ETag: endpointEtag(row) },
    );
  },
);

export const PATCH = withApiV1(
  { scopes: ['webhooks:manage'], kind: 'write', readBody: true },
  async ({ params, body, req, requestId, workspaceId }) => {
    const instance = `/api/v1/webhook-endpoints/${params.id}`;
    const result = await updateWebhookEndpoint(
      getDb(),
      workspaceId,
      params.id ?? '',
      body,
      req.headers.get('if-match'),
    );

    if ('row' in result) {
      return apiJson(200, serializeWebhookEndpoint(result.row), requestId, {
        ETag: endpointEtag(result.row),
      });
    }
    if ('problem' in result) {
      return problemResponse(result.problem, { requestId, instance, errors: result.errors });
    }
    if (result.status === 428) {
      return problemResponse('precondition_required', { requestId, instance });
    }
    if (result.status === 412) {
      return problemResponse('precondition_failed', { requestId, instance });
    }
    return problemResponse('not_found', { requestId, instance });
  },
);

export const DELETE = withApiV1(
  { scopes: ['webhooks:manage'], kind: 'write' },
  async ({ params, requestId, workspaceId }) => {
    const deleted = await deleteWebhookEndpoint(getDb(), workspaceId, params.id ?? '');
    if (!deleted) {
      return problemResponse('not_found', {
        requestId,
        instance: `/api/v1/webhook-endpoints/${params.id}`,
      });
    }
    return apiJson(204, null, requestId);
  },
);

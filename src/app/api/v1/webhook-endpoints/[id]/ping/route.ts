// ─── POST /api/v1/webhook-endpoints/{id}/ping — prueba de integración ───────
// Encola un evento `ping` firmado (Standard Webhooks) hacia ESE endpoint por
// el mismo pipeline durable de entrega. 202: la entrega es asíncrona.

import { withApiV1, apiJson } from '@/lib/api/handler';
import { problemResponse } from '@/lib/api/problems';
import { parseTypeId, ID_PREFIXES } from '@/lib/api/ids';
import { sendPingToEndpoint } from '@/lib/api/webhook-emitter';

export const maxDuration = 30;

export const POST = withApiV1(
  { scopes: ['webhooks:manage'], kind: 'write' },
  async ({ params, requestId, workspaceId }) => {
    const instance = `/api/v1/webhook-endpoints/${params.id}/ping`;
    const uuid = parseTypeId(ID_PREFIXES.webhookEndpoint, params.id ?? '');
    if (!uuid) return problemResponse('not_found', { requestId, instance });

    const result = await sendPingToEndpoint(workspaceId, uuid);
    if (!result) return problemResponse('not_found', { requestId, instance });

    return apiJson(202, { message_id: result.messageId }, requestId);
  },
);

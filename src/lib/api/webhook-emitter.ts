// ---------------------------------------------------------------------------
// Emisión de eventos de webhook del API v1.
//
// Separado de webhooks.ts a propósito: este módulo toca DB y el runtime de
// Workflow DevKit; webhooks.ts se mantiene puro (firma/validación) y
// testeable sin infraestructura. Emitir JAMÁS rompe al caller: cualquier
// fallo se loggea y se traga (el recurso ya se creó).
// ---------------------------------------------------------------------------

import { and, arrayContains, eq } from 'drizzle-orm';
import { start } from 'workflow/api';

import { getDb } from '@/lib/db/client';
import { apiWebhookEndpoints, apiWebhookMessages } from '@/lib/db/schema';

import { newTypeId, typeIdFrom, ID_PREFIXES } from './ids';
import type { WebhookEventType } from './webhooks';
import { deliverWebhookMessage } from '@/lib/workflows/webhook-delivery';

interface EndpointTarget {
  id: string;
}

async function createAndStartMessage(
  workspaceId: string,
  endpoint: EndpointTarget,
  eventType: WebhookEventType,
  data: unknown,
): Promise<string> {
  const db = getDb();
  const { uuid } = newTypeId(ID_PREFIXES.webhookMessage);
  // Envelope Standard Webhooks: {type, timestamp RFC3339, data}. El timestamp
  // del envelope es el de CREACIÓN del evento (el header webhook-timestamp se
  // re-firma fresco en cada intento).
  const envelope = {
    type: eventType,
    timestamp: new Date().toISOString(),
    data,
  };
  await db.insert(apiWebhookMessages).values({
    id: uuid,
    workspaceId,
    endpointId: endpoint.id,
    eventType,
    payload: envelope,
  });
  await start(deliverWebhookMessage, [{ messageId: uuid }]);
  return typeIdFrom(ID_PREFIXES.webhookMessage, uuid);
}

/**
 * Emite un evento a TODOS los endpoints habilitados del workspace suscritos
 * a ese tipo. Fire-and-safe: los errores se loggean, nunca se propagan.
 */
export async function emitWebhookEvent(
  workspaceId: string,
  eventType: WebhookEventType,
  data: unknown,
): Promise<void> {
  try {
    const db = getDb();
    const endpoints = await db
      .select({ id: apiWebhookEndpoints.id })
      .from(apiWebhookEndpoints)
      .where(
        and(
          eq(apiWebhookEndpoints.workspaceId, workspaceId),
          eq(apiWebhookEndpoints.status, 'enabled'),
          arrayContains(apiWebhookEndpoints.events, [eventType]),
        ),
      );

    for (const endpoint of endpoints) {
      await createAndStartMessage(workspaceId, endpoint, eventType, data);
    }
  } catch (err) {
    console.error('[api-v1] emitWebhookEvent falló:', err);
  }
}

/**
 * Envía un evento `ping` firmado a UN endpoint concreto (prueba de
 * integración). Devuelve el message_id público o null si el endpoint no
 * existe / no pertenece al workspace / está deshabilitado.
 */
export async function sendPingToEndpoint(
  workspaceId: string,
  endpointUuid: string,
): Promise<{ messageId: string } | null> {
  const db = getDb();
  const rows = await db
    .select({ id: apiWebhookEndpoints.id, status: apiWebhookEndpoints.status })
    .from(apiWebhookEndpoints)
    .where(
      and(
        eq(apiWebhookEndpoints.id, endpointUuid),
        eq(apiWebhookEndpoints.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const endpoint = rows[0];
  if (!endpoint || endpoint.status !== 'enabled') return null;

  const messageId = await createAndStartMessage(workspaceId, endpoint, 'ping', {
    message: 'Prueba de integración de UtopIA — si verificaste la firma, todo está en orden.',
  });
  return { messageId };
}

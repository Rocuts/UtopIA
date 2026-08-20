// ─── Webhook delivery — Step: attempt ────────────────────────────────────────
// Un intento de entrega: carga mensaje+endpoint, firma Standard Webhooks v1
// con timestamp fresco, POST con timeout 10 s y sin redirects, y registra la
// bitácora. Devuelve { done } para que el workflow decida si sigue el schedule.

import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  apiWebhookAttempts,
  apiWebhookEndpoints,
  apiWebhookMessages,
} from '@/lib/db/schema';
import { typeIdFrom, ID_PREFIXES } from '@/lib/api/ids';
import { signWebhookPayload, validateWebhookUrl } from '@/lib/api/webhooks';
import { decryptSecret } from '@/lib/security/vault';

import { DELIVERY_TIMEOUT_MS, isDeliverySuccess } from '../policy';

export interface AttemptDeliveryResult {
  /** true = no hay más que hacer (entregado, o mensaje/endpoint fuera de juego). */
  done: boolean;
}

export async function attemptDelivery(input: {
  messageId: string;
  attemptN: number;
}): Promise<AttemptDeliveryResult> {
  'use step';

  const db = getDb();

  const messages = await db
    .select()
    .from(apiWebhookMessages)
    .where(eq(apiWebhookMessages.id, input.messageId))
    .limit(1);
  const message = messages[0];
  if (!message || message.status !== 'pending') return { done: true };

  const endpoints = await db
    .select()
    .from(apiWebhookEndpoints)
    .where(eq(apiWebhookEndpoints.id, message.endpointId))
    .limit(1);
  const endpoint = endpoints[0];
  if (!endpoint || endpoint.status !== 'enabled') {
    await db
      .update(apiWebhookMessages)
      .set({ status: 'exhausted' })
      .where(eq(apiWebhookMessages.id, message.id));
    return { done: true };
  }

  // Anti-SSRF también en tiempo de entrega (la URL pudo registrarse antes de
  // un cambio de reglas): si dejó de ser válida, no se intenta jamás.
  const urlCheck = validateWebhookUrl(endpoint.url);
  if (!urlCheck.ok) {
    await db
      .update(apiWebhookMessages)
      .set({ status: 'exhausted' })
      .where(eq(apiWebhookMessages.id, message.id));
    return { done: true };
  }

  const secret = decryptSecret(endpoint.secretEncrypted);
  const publicMsgId = typeIdFrom(ID_PREFIXES.webhookMessage, message.id);
  const timestampSec = Math.floor(Date.now() / 1000);
  // jsonb normaliza el orden de claves → el stringify es estable entre
  // intentos; la firma cubre EXACTAMENTE los bytes enviados.
  const body = JSON.stringify(message.payload);
  const signature = signWebhookPayload(secret, publicMsgId, timestampSec, body);

  const startedAt = Date.now();
  let responseStatus: number | null = null;
  let errorText: string | null = null;

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'webhook-id': publicMsgId,
        'webhook-timestamp': String(timestampSec),
        'webhook-signature': signature,
      },
      body,
    });
    responseStatus = res.status;
    // Consumir/cerrar el body sin usarlo (API10: la respuesta es opaca).
    res.body?.cancel().catch(() => undefined);
  } catch (err) {
    errorText = err instanceof Error ? err.message.slice(0, 500) : 'fetch failed';
  }

  const elapsedMs = Date.now() - startedAt;
  const delivered = responseStatus !== null && isDeliverySuccess(responseStatus);

  await db.insert(apiWebhookAttempts).values({
    messageId: message.id,
    attemptN: input.attemptN,
    responseStatus,
    error: errorText,
    elapsedMs,
  });

  if (delivered) {
    await db
      .update(apiWebhookMessages)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        attemptCount: input.attemptN,
        nextAttemptAt: null,
      })
      .where(eq(apiWebhookMessages.id, message.id));
    // Cualquier 2xx resetea el reloj de desactivación del endpoint.
    await db
      .update(apiWebhookEndpoints)
      .set({ firstFailingAt: null })
      .where(eq(apiWebhookEndpoints.id, endpoint.id));
    return { done: true };
  }

  await db
    .update(apiWebhookMessages)
    .set({ attemptCount: input.attemptN })
    .where(eq(apiWebhookMessages.id, message.id));
  // Arrancar el reloj de fallo continuo solo si no estaba corriendo.
  await db
    .update(apiWebhookEndpoints)
    .set({ firstFailingAt: new Date() })
    .where(
      and(
        eq(apiWebhookEndpoints.id, endpoint.id),
        isNull(apiWebhookEndpoints.firstFailingAt),
      ),
    );

  return { done: false };
}

// ─── Webhook delivery — Step: finalize ───────────────────────────────────────
// Al agotar el schedule: mensaje `exhausted` y, si el endpoint acumula ≥5 días
// de fallo continuo, se desactiva (patrón Svix).

import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { apiWebhookEndpoints, apiWebhookMessages } from '@/lib/db/schema';

import { shouldDisableEndpoint } from '../policy';

export async function finalizeExhausted(input: { messageId: string }): Promise<void> {
  'use step';

  const db = getDb();

  const messages = await db
    .select()
    .from(apiWebhookMessages)
    .where(eq(apiWebhookMessages.id, input.messageId))
    .limit(1);
  const message = messages[0];
  if (!message) return;

  if (message.status === 'pending') {
    await db
      .update(apiWebhookMessages)
      .set({ status: 'exhausted' })
      .where(eq(apiWebhookMessages.id, message.id));
  }

  const endpoints = await db
    .select()
    .from(apiWebhookEndpoints)
    .where(eq(apiWebhookEndpoints.id, message.endpointId))
    .limit(1);
  const endpoint = endpoints[0];
  if (!endpoint || endpoint.status !== 'enabled') return;

  if (shouldDisableEndpoint(endpoint.firstFailingAt, new Date())) {
    await db
      .update(apiWebhookEndpoints)
      .set({ status: 'disabled', disabledAt: new Date() })
      .where(eq(apiWebhookEndpoints.id, endpoint.id));
    console.warn(
      `[api-v1] webhook endpoint ${endpoint.id} desactivado tras 5 días de fallo continuo`,
    );
  }
}

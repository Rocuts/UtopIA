// ─── Webhook delivery — Workflow durable (Vercel Workflow DevKit) ───────────
//
// Un workflow por mensaje: recorre el schedule Svix con sleeps durables
// (sobreviven deploys y evicciones de instancia) y delega cada intento a un
// step con acceso Node completo. Patrón idéntico a monthly-close.
//
// Reglas del workflow sandbox:
//   - 'use workflow' → orquestación pura (sin fetch/fs/Date directos).
//   - 'use step' (attempt/finalize) → full Node.js.
//   - start() se llama desde webhook-emitter.ts, NO desde aquí.

import { sleep } from 'workflow';

import { RETRY_DELAYS_MS } from './policy';
import { attemptDelivery } from './steps/attempt';
import { finalizeExhausted } from './steps/finalize';

export async function deliverWebhookMessage(input: {
  messageId: string;
}): Promise<void> {
  'use workflow';

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    const delayMs = RETRY_DELAYS_MS[i];
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    const result = await attemptDelivery({
      messageId: input.messageId,
      attemptN: i + 1,
    });
    if (result.done) return;
  }

  await finalizeExhausted({ messageId: input.messageId });
}

/**
 * WhatsApp stub — canal no activo en MVP.
 *
 * D3 (MVP_DECISIONS_DEFERRED): WhatsApp Business API se activa en WS6.1
 * una vez se aprueben las plantillas en el portal de Meta Business.
 */

import type { DispatchResult } from './types';

export async function dispatchWhatsApp(
  _subscriptionId: string,
  _recipientId: string,
  _payload: unknown,
): Promise<DispatchResult['perRecipient'][number]> {
  return {
    subscriptionId: _subscriptionId,
    channel: 'whatsapp',
    recipientId: _recipientId,
    status: 'skipped',
    errorMessage: 'channel_disabled_in_mvp',
  };
}

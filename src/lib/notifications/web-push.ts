/**
 * Web Push stub — canal no activo en MVP.
 *
 * D3 (MVP_DECISIONS_DEFERRED): Web Push y WhatsApp se habilitan en WS6.1
 * cuando se provisione el servicio de push y se obtengan credenciales WABA.
 * Este stub cumple el contrato de tipo para que `dispatch.ts` pueda iterar
 * todos los canales sin condicionales adicionales.
 */

import type { DispatchResult } from './types';

export async function dispatchWebPush(
  _subscriptionId: string,
  _recipientId: string,
  _payload: unknown,
): Promise<DispatchResult['perRecipient'][number]> {
  return {
    subscriptionId: _subscriptionId,
    channel: 'web_push',
    recipientId: _recipientId,
    status: 'skipped',
    errorMessage: 'channel_disabled_in_mvp',
  };
}

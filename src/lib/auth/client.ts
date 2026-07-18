'use client';

/**
 * authClient — cliente BetterAuth compartido (singleton).
 *
 * Antes cada página (login, signup) instanciaba su propio createAuthClient();
 * este módulo centraliza la instancia para que header, settings y los flujos
 * de contraseña consuman la MISMA sesión cacheada (cookieCache de 5 min).
 *
 * Métodos usados en la app:
 *   - authClient.signIn.email / signUp.email / signOut
 *   - authClient.useSession (hook React)
 *   - authClient.requestPasswordReset / resetPassword
 *   - authClient.changePassword / listSessions / revokeSession
 *   - authClient.subscription.upgrade / list / cancel (billing — panel Plan
 *     en /workspace/settings; el server solo monta el plugin Stripe cuando
 *     STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET existen, así que la UI debe
 *     consultar GET /api/system/capabilities.billing antes de ofrecer upgrade)
 */

import { createAuthClient } from 'better-auth/react';
import { stripeClient } from '@better-auth/stripe/client';

export const authClient = createAuthClient({
  plugins: [stripeClient({ subscription: true })],
});

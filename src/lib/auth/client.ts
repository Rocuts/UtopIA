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
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

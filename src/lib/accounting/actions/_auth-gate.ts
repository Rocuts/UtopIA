import 'server-only';
// ---------------------------------------------------------------------------
// Gate de sesión para las Server Actions del núcleo contable.
// ---------------------------------------------------------------------------
// Las 13 actions de `@/lib/accounting/actions` mutan el libro (asientos,
// periodos, PUC, saldos de apertura) exactamente igual que los Route Handlers
// de `/api/accounting/*`, pero nacieron sin el gate que esos sí llevan. Este
// helper cierra esa asimetría.
//
// Por qué NO devolvemos `gate.response` como en los Route Handlers:
// `requireAuthSession()` devuelve un `NextResponse` y una Server Action tiene
// que devolver un valor SERIALIZABLE a través del borde RSC. Un NextResponse
// no lo es (ni encaja en los tipos `*ActionError` que ya consume la UI). Así
// que traducimos la denegación al mismo contrato `{ ok:false, code, message }`
// que usan el resto de errores de las actions.
//
// Contrato de fases (idéntico al de `requireAuthSession`):
//   Fase 1 — BETTER_AUTH_SECRET ausente: no-op, `null` = "siga". El
//            comportamiento observable de la app HOY no cambia.
//   Fase 2 — BETTER_AUTH_SECRET puesto: sin sesión válida la action rechaza
//            antes de resolver el tenant y antes de tocar el dominio.
//
// El gate va como PRIMERA línea de cada action, incluso antes de Zod: un
// caller sin sesión no debe poder inferir la forma del schema a punta de
// mensajes de validación.
// ---------------------------------------------------------------------------

import { requireAuthSession } from '@/lib/auth/require-session';

/** Código de error único para la denegación por falta de sesión. */
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

export type UnauthenticatedActionError = {
  ok: false;
  code: typeof UNAUTHENTICATED;
  message: string;
};

/**
 * Devuelve `null` si el caller puede continuar, o el error serializable de
 * denegación si no. Uso:
 *
 *   const denied = await denyIfNoSession();
 *   if (denied) return denied;
 */
export async function denyIfNoSession(): Promise<UnauthenticatedActionError | null> {
  const gate = await requireAuthSession();
  if (gate.ok) return null;
  return {
    ok: false,
    code: UNAUTHENTICATED,
    message: 'Sesión requerida. Inicie sesión para continuar.',
  };
}

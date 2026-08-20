import { anonymousPhaseResponse } from '@/lib/auth/anonymous-phase';
import { isAuthConfigured } from '@/lib/auth/enabled';

// ---------------------------------------------------------------------------
// Catch-all de BetterAuth — montado SOLO en fase 2 (BETTER_AUTH_SECRET puesto).
//
// El import de `@/lib/auth/config` es dinámico y va DESPUÉS del guard: en
// fase 1 ese módulo construye un `betterAuth()` cuyo contexto rechaza con
// `BetterAuthError("You are using the default secret…")` en cuanto se le
// espera, y Next.js lo traduce a 500 con cuerpo vacío. Ver
// src/lib/auth/enabled.ts para el análisis completo.
//
// Fase 2 delega ÍNTEGRAMENTE en BetterAuth: el guard no relaja, filtra ni
// intercepta nada cuando el secret existe.
// ---------------------------------------------------------------------------

type Verb = 'GET' | 'POST';

async function delegate(request: Request, verb: Verb): Promise<Response> {
  const [{ auth }, { toNextJsHandler }] = await Promise.all([
    import('@/lib/auth/config'),
    import('better-auth/next-js'),
  ]);
  const handlers = toNextJsHandler(auth);
  return verb === 'GET' ? handlers.GET(request) : handlers.POST(request);
}

async function handle(request: Request, verb: Verb): Promise<Response> {
  if (!isAuthConfigured()) return anonymousPhaseResponse(request);
  return delegate(request, verb);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, 'GET');
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, 'POST');
}

import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Respuestas del catch-all /api/auth/* en FASE 1 (sin BETTER_AUTH_SECRET).
//
// BetterAuth no está montado en esta fase, así que el router nunca ve estas
// peticiones. En vez de reventar (500 con cuerpo vacío — el bug que provocaba
// un error de consola en cada carga de página), contestamos con honestidad:
//
//   GET|POST /api/auth/get-session  → 200 `null`
//       Es EXACTAMENTE lo que devuelve BetterAuth cuando no hay cookie de
//       sesión (src/api/routes/session.mjs: `if (!sessionCookieToken) return
//       null`), así que `authClient.useSession()` resuelve a "sin sesión" sin
//       ruido. Mentir aquí no es posible: no hay sesión que ocultar.
//
//   cualquier otro endpoint        → 503 AUTH_NOT_CONFIGURED
//       Sign-in, sign-up, reset de contraseña, webhooks de Stripe… no existen
//       sin secret. 503 + código estable es honesto y accionable; un 200
//       falso o un 404 mudo no lo serían.
//
// `no-store` en ambos casos: la respuesta depende de una variable de entorno
// que cambia al activar la fase 2 — nada de cachearla en el CDN.
// ---------------------------------------------------------------------------

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const AUTH_NOT_CONFIGURED_CODE = 'AUTH_NOT_CONFIGURED';

/** `true` si la ruta pedida es el endpoint de lectura de sesión. */
function isGetSession(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').endsWith('/get-session');
  } catch {
    return false;
  }
}

export function anonymousPhaseResponse(request: Request): NextResponse {
  if (isGetSession(request.url)) {
    return NextResponse.json(null, { headers: NO_STORE });
  }

  return NextResponse.json(
    {
      code: AUTH_NOT_CONFIGURED_CODE,
      message:
        'La autenticación no está habilitada en este despliegue (fase anónima). Configure BETTER_AUTH_SECRET para activarla.',
    },
    { status: 503, headers: NO_STORE },
  );
}

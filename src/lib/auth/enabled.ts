// ---------------------------------------------------------------------------
// isAuthConfigured — única fuente de verdad del contrato de fases de auth.
//
//   Fase 1 (BETTER_AUTH_SECRET ausente): la app corre anónima (cookie
//     `utopia_workspace_id`). BetterAuth NO se monta.
//   Fase 2 (BETTER_AUTH_SECRET presente): BetterAuth es la autoridad.
//
// Por qué existe este módulo y no un `process.env` inline: BetterAuth 1.6
// NO lanza al construirse — `betterAuth()` devuelve un objeto cuyo
// `$context` es una promesa que se resuelve (o RECHAZA) perezosamente. Sin
// secret, `createAuthContext` cae al DEFAULT_SECRET y `validateSecret()`
// lanza `BetterAuthError("You are using the default secret…")` cuando
// NODE_ENV === 'production'. El rechazo solo aflora en el primer
// `auth.handler(req)` / `auth.api.*`, es decir: 500 en TODAS las rutas
// /api/auth/*. Por eso los consumidores deben preguntar ANTES de importar
// `@/lib/auth/config`.
//
// Deliberadamente sin `server-only`: es una lectura de env pura, importable
// desde route handlers y desde tests sin arrastrar pg.Pool.
// ---------------------------------------------------------------------------

/**
 * Los tres nombres que BetterAuth 1.6 resuelve por su cuenta:
 * `options.secret || env.BETTER_AUTH_SECRET || env.AUTH_SECRET`, más
 * `BETTER_AUTH_SECRETS` para la rotación. Si el guard mirara sólo el primero,
 * un despliegue que pasa el secreto por cualquiera de los otros dos tenía login
 * antes de este cambio y se quedaría sin él: BetterAuth no se montaría y todo
 * inicio de sesión respondería 503.
 */
const SECRET_VARS = ['BETTER_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRETS'] as const;

export function isAuthConfigured(): boolean {
  return SECRET_VARS.some((name) => Boolean(process.env[name]));
}

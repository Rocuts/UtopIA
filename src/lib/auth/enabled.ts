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

export function isAuthConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

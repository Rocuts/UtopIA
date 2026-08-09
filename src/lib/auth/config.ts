import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { stripe as stripePlugin } from '@better-auth/stripe';
import Stripe from 'stripe';
import { getDb } from '@/lib/db/client';
import * as authSchema from '@/lib/db/schema-auth';

// ---------------------------------------------------------------------------
// Closed-beta signup allowlist.
//
//   UTOPIA_AUTH_ALLOWLIST — comma-separated list of emails permitted to
//   register (case-insensitive). Sign-IN of already-registered users is NOT
//   gated by this — only account creation.
//
// FAIL-CLOSED: if the env var is unset/empty, NO ONE can register. This is the
// intended closed-beta default — set the allowlist (including the admin email)
// before onboarding. Remove/relax this hook to open registration.
//
// ⚠️  RIESGO DE LOCK-OUT EN EL FLIP A FASE 2 — leer antes de activar auth.
//     El hook `databaseHooks.user.create.before` (más abajo) rechaza con
//     APIError FORBIDDEN cualquier email que no esté en UTOPIA_AUTH_ALLOWLIST.
//     No hay seed de administrador ni bypass del primer usuario: si se pone
//     BETTER_AUTH_SECRET en producción con UTOPIA_AUTH_ALLOWLIST vacía, NADIE
//     puede registrarse — ni siquiera el dueño — y como no hay cuentas
//     previas, tampoco hay forma de entrar a arreglarlo desde la app. La
//     recuperación exige tocar env vars en Vercel (y redesplegar) o insertar
//     el usuario a mano en la DB.
//     Checklist del flip: setear UTOPIA_AUTH_ALLOWLIST con el email del admin
//     ANTES (o a la vez que) BETTER_AUTH_SECRET, nunca después.
//     No se "arregla" aquí a propósito: abrir el registro cuando falta la
//     variable convertiría un despliegue mal configurado en un registro
//     público abierto — peor que quedarse fuera.
// ---------------------------------------------------------------------------
function signupAllowlist(): Set<string> {
  return new Set(
    (process.env.UTOPIA_AUTH_ALLOWLIST ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------------------
// BetterAuth — configuration
//
// Environment variables required (add to .env.local + Vercel):
//   BETTER_AUTH_SECRET   — random 32+ char secret (openssl rand -base64 32)
//   BETTER_AUTH_URL      — base URL (https://utopia.sequal.com.co in prod,
//                          http://localhost:3000 in dev)
//
// Optional OAuth providers (add when OAuth apps are registered):
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
//
// Billing (@better-auth/stripe — phase-gated, same pattern as BETTER_AUTH_SECRET;
// without these vars the plugin is NOT mounted and the app behaves as today):
//   STRIPE_SECRET_KEY          — sk_live_... / sk_test_...
//   STRIPE_WEBHOOK_SECRET      — whsec_... (webhook endpoint: /api/auth/stripe/webhook)
//   STRIPE_PRICE_ID_PRO        — price_... (monthly Pro)
//   STRIPE_PRICE_ID_PRO_ANNUAL — price_... (optional annual Pro)
//   STRIPE_PRICE_ID_ENTERPRISE — price_... (optional Enterprise)
// Runbook: docs/BILLING.md
//
// To activate a provider: uncomment the relevant block below and add the
// env vars to Vercel. No code change needed beyond that.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stripe billing — mounted only when fully configured (fail-closed on partial
// config: secret without webhook secret would silently skip signature checks).
// Webhook route (auto-mounted by the plugin under the BetterAuth catch-all):
//   POST /api/auth/stripe/webhook — exempted from CSRF in src/proxy.ts because
//   Stripe servers send no Origin header; authenticity = HMAC signature.
// Subscriptions hang off the BetterAuth user id (referenceId). Workspace plan
// resolves via workspaces.user_id → subscription.reference_id (1 user = 1
// workspace today — ADR-05 Opción A). Plan helper: src/lib/billing/plan.ts
// ---------------------------------------------------------------------------

const BILLING_ACTIVE = Boolean(
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
);

function buildStripePlans() {
  const plans: { name: string; priceId: string; annualDiscountPriceId?: string }[] = [];
  if (process.env.STRIPE_PRICE_ID_PRO) {
    plans.push({
      name: 'pro',
      priceId: process.env.STRIPE_PRICE_ID_PRO,
      ...(process.env.STRIPE_PRICE_ID_PRO_ANNUAL
        ? { annualDiscountPriceId: process.env.STRIPE_PRICE_ID_PRO_ANNUAL }
        : {}),
    });
  }
  if (process.env.STRIPE_PRICE_ID_ENTERPRISE) {
    plans.push({
      name: 'enterprise',
      priceId: process.env.STRIPE_PRICE_ID_ENTERPRISE,
    });
  }
  return plans;
}

function buildBillingPlugins() {
  if (!BILLING_ACTIVE) return [];
  return [
    stripePlugin({
      stripeClient: new Stripe(process.env.STRIPE_SECRET_KEY as string),
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET as string,
      createCustomerOnSignUp: true,
      subscription: {
        enabled: true,
        plans: buildStripePlans(),
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Assert de arranque — BETTER_AUTH_URL es obligatoria en producción.
//
// El `baseURL` de abajo cae a `https://${VERCEL_URL}` cuando falta
// BETTER_AUTH_URL. En preview eso es deliberado: cada deploy efímero emite sus
// cookies para su propio host y no hay que tocar env por rama. En PRODUCCIÓN
// el mismo fallback es un fallo silencioso caro — VERCEL_URL es el host
// interno del deployment, no el dominio canónico, así que las cookies de
// sesión se emiten para un origen que el usuario nunca visita y los callbacks
// OAuth apuntan a una URL muerta. El síntoma es "el login no funciona" sin un
// solo error en los logs.
//
// Sólo dispara en la combinación exacta que importa (fase 2 + producción):
// en fase 1 y en preview/dev no cambia absolutamente nada.
//
// Nota sobre dónde aterriza el throw: los consumidores importan este módulo de
// forma perezosa y dentro de try/catch (`require-session.ts`,
// `db/workspace.ts`), así que en caliente el efecto es que la validación de
// sesión falla CERRADA (401) en vez de emitir cookies para el origen
// equivocado. Es el modo de fallo correcto.
// ---------------------------------------------------------------------------
type AuthEnvVars = {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  VERCEL_ENV?: string;
  /** Sólo documenta el fallback que este assert impide usar en producción. */
  VERCEL_URL?: string;
  /**
   * Marcador EXPLÍCITO de fase 2: '1' declara que este despliegue espera auth
   * activa. Existe porque la fase no es inferible desde VERCEL_ENV — producción
   * corre hoy en fase 1 anónima a propósito.
   */
  UTOPIA_AUTH_REQUIRED?: string;
  // La firma de índice existe para poder pasar `process.env` tal cual: sin
  // ella TS aplica la regla de "weak type" (todas las props opcionales) y
  // rechaza ProcessEnv por no compartir propiedades declaradas.
  [key: string]: string | undefined;
};

export function assertAuthUrlConfigured(
  env: AuthEnvVars = process.env,
): void {
  if (!env.BETTER_AUTH_SECRET) return; // fase 1: auth apagada, nada que validar
  if (env.VERCEL_ENV !== 'production') return; // preview/dev: el fallback es válido
  if (env.BETTER_AUTH_URL) return;
  throw new Error(
    '[auth] BETTER_AUTH_URL es obligatoria cuando BETTER_AUTH_SECRET está ' +
      'definida en producción. Sin ella baseURL cae a https://$VERCEL_URL (el ' +
      'host interno del deployment) y las cookies de sesión se emiten para un ' +
      'origen distinto del dominio canónico: el login falla en silencio. ' +
      'Defina BETTER_AUTH_URL=https://<dominio-canónico> en las env vars de ' +
      'producción en Vercel.',
  );
}

assertAuthUrlConfigured();

// ---------------------------------------------------------------------------
// Assert de arranque — BETTER_AUTH_SECRET, la variable que arma TODOS los gates.
//
// Sin ella la plataforma entera se degrada a no-op SILENCIOSO y con 200 en todo:
// el bloque de auth del proxy no corre (ni /workspace/* redirige a /login ni las
// rutas protegidas devuelven 401), `requireAuthSession()` devuelve {ok:true},
// `denyIfNoSession()` devuelve null y `getAuthSession()` devuelve null, con lo
// que la cookie `utopia_workspace_id` queda como ÚNICO bearer del tenant. Un
// rollback de Vercel, la promoción de un preview o una rotación de secreto que
// deje la variable vacía borran la autenticación de toda la plataforma sin un
// solo error en los logs.
//
// NO se infiere la fase desde VERCEL_ENV a propósito: hoy producción corre
// deliberadamente en fase 1 anónima SIN el secreto, así que un
// `VERCEL_ENV==='production' && !BETTER_AUTH_SECRET → throw` tumbaría el
// despliegue actual y no distinguiría "fase 1 intencional" de "fase 2 mal
// desplegada". La fase se declara explícitamente con UTOPIA_AUTH_REQUIRED=1, que
// debe añadirse a las env vars de producción EN EL MISMO cambio que introduce
// BETTER_AUTH_SECRET. Hoy la variable no existe, así que este assert es inerte.
//
// El console.error es la red de seguridad barata para el caso que el assert no
// puede cubrir todavía: deja rastro inequívoco en los logs de arranque de
// producción mientras la fase siga siendo implícita.
// ---------------------------------------------------------------------------
export function assertAuthSecretConfigured(
  env: AuthEnvVars = process.env,
): void {
  if (env.BETTER_AUTH_SECRET) return;
  if (env.UTOPIA_AUTH_REQUIRED === '1') {
    throw new Error(
      '[auth] UTOPIA_AUTH_REQUIRED=1 pero BETTER_AUTH_SECRET está ausente: ' +
        'todos los gates de autenticación (proxy, requireAuthSession, ' +
        'denyIfNoSession) serían no-op y la cookie utopia_workspace_id quedaría ' +
        'como único bearer del tenant. Defina BETTER_AUTH_SECRET en las env vars ' +
        'de producción en Vercel, o retire UTOPIA_AUTH_REQUIRED si el despliegue ' +
        'debe seguir en fase 1 anónima.',
    );
  }
  if (env.VERCEL_ENV === 'production') {
    console.error(
      '[auth] AUTENTICACIÓN DESACTIVADA en producción: BETTER_AUTH_SECRET no ' +
        'está definida. Todos los gates de sesión son no-op y el acceso al ' +
        'workspace depende sólo de la cookie utopia_workspace_id. Esto es ' +
        'esperado en fase 1; si NO lo es, el despliegue está mal configurado.',
    );
  }
}

assertAuthSecretConfigured();

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: authSchema.authUsers,
      session: authSchema.authSessions,
      account: authSchema.authAccounts,
      verification: authSchema.authVerifications,
      subscription: authSchema.authSubscriptions,
    },
  }),

  plugins: buildBillingPlugins(),

  secret: process.env.BETTER_AUTH_SECRET,
  // Prod: explicit BETTER_AUTH_URL (canonical origin). Preview/dev: fall back to
  // the deployment's own VERCEL_URL so session cookies are issued for the host
  // the tester actually visits (no per-preview env fiddling). Local: localhost.
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'),

  // Origins allowed to initiate auth flows. BetterAuth always trusts the
  // baseURL origin; ADEMÁS añadimos los hosts del propio deployment para que el
  // login funcione en las URLs de preview sin fijar a mano cada host efímero.
  //
  // Esta lista se recalcula POR REQUEST y alimenta dos controles distintos: el
  // chequeo CSRF del header Origin y la validación de callbackURL/redirectTo.
  // La versión anterior derivaba el origen confiable del header `Origin` que
  // manda el cliente, aceptando cualquier host que terminara en `.vercel.app` y
  // CONTUVIERA la subcadena 'utopia'. Ese namespace no lo controla la
  // organización: los nombres de proyecto en Vercel no están reservados
  // globalmente, así que cualquiera podía crear `utopia-x` en SU cuenta,
  // obtener `https://utopia-x-<hash>.vercel.app` y quedar dentro de la lista de
  // confianza del dominio de producción — se le desactivaba el CSRF propio de
  // BetterAuth y, el día que se monten proveedores OAuth, sus redirectores
  // aceptarían un callbackURL hacia el atacante con el sello de la marca.
  //
  // Por eso ya no se lee NUNCA el Origin del solicitante: los hosts confiables
  // salen de las env vars que inyecta el propio deployment, por igualdad exacta
  // y sólo fuera de producción. Producción no pierde nada (el origen canónico
  // sigue llegando por BETTER_AUTH_URL y BetterAuth confía siempre en su
  // baseURL) y las previews siguen funcionando, porque VERCEL_URL es
  // precisamente el host que el tester visita.
  trustedOrigins: () => {
    const origins: string[] = [];
    const base = process.env.BETTER_AUTH_URL;
    if (base) {
      try {
        origins.push(new URL(base).origin);
      } catch {
        /* malformed BETTER_AUTH_URL — baseURL fallback handles it */
      }
    }
    if (process.env.VERCEL_ENV !== 'production') {
      for (const host of [
        process.env.VERCEL_URL,
        process.env.VERCEL_BRANCH_URL,
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
      ]) {
        if (host) origins.push(`https://${host}`);
      }
    }
    return origins;
  },

  // Lifecycle hooks — closed-beta gate + anonymous-workspace claiming.
  databaseHooks: {
    user: {
      create: {
        // Reject registration for emails outside the closed-beta allowlist.
        before: async (user) => {
          const allow = signupAllowlist();
          const email = (user.email ?? '').trim().toLowerCase();
          if (!allow.has(email)) {
            throw new APIError('FORBIDDEN', {
              message:
                'El registro está restringido a la beta cerrada. Solicite acceso al administrador.',
            });
          }
          return { data: user };
        },
        // Link the caller's anonymous (cookie) workspace to the new account so
        // pre-signup data isn't orphaned. Best-effort — never blocks signup.
        after: async (user) => {
          try {
            const { cookies } = await import('next/headers');
            const cookieWorkspaceId = (await cookies()).get(
              'utopia_workspace_id',
            )?.value;
            if (cookieWorkspaceId) {
              const { claimAnonymousWorkspace } = await import(
                '@/lib/db/workspace'
              );
              await claimAnonymousWorkspace(user.id, cookieWorkspaceId);
            }
          } catch (err) {
            console.error(
              '[auth] claimAnonymousWorkspace failed:',
              err instanceof Error ? err.message : 'unknown',
            );
          }
        },
      },
    },
  },

  // Email + password sign-in (always enabled).
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // set true once Resend is configured
    // Reset de contraseña: entrega vía Resend (mismo patrón lazy que
    // sentinel-insight). OJO: better-auth 1.6.x envuelve este hook en
    // runInBackgroundOrAwait, que CAPTURA y no re-lanza — el throw de abajo
    // solo queda en el log del servidor y el endpoint responde status:true
    // igual. La honestidad hacia el usuario se garantiza ANTES, en
    // /forgot-password vía GET /api/system/capabilities (sin RESEND_API_KEY
    // la página ni muestra el formulario).
    sendResetPassword: async ({ user, url }) => {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        throw new Error(
          'email_delivery_unavailable: RESEND_API_KEY no configurada — el reset de contraseña requiere email transaccional.',
        );
      }
      const { Resend } = await import('resend');
      const { fromAddress } = await import('@/lib/notifications/email/from-address');
      const resend = new Resend(key);
      const from = fromAddress();
      const { error } = await resend.emails.send({
        from,
        to: user.email,
        subject: 'Restablecer su contraseña — 1+1',
        text:
          `Hola${user.name ? ` ${user.name}` : ''},\n\n` +
          `Recibimos una solicitud para restablecer su contraseña. ` +
          `Abra este enlace para crear una nueva (válido por tiempo limitado):\n\n${url}\n\n` +
          `Si usted no lo solicitó, ignore este correo — su contraseña no cambia.`,
      });
      if (error) {
        throw new Error(`email_delivery_failed: ${error.message ?? 'resend_error'}`);
      }
    },
  },

  // -------------------------------------------------------------------------
  // Social providers — uncomment each block when OAuth app is registered.
  // -------------------------------------------------------------------------

  // socialProviders: {
  //   google: {
  //     clientId: process.env.GOOGLE_CLIENT_ID!,
  //     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  //   },
  //   github: {
  //     clientId: process.env.GITHUB_CLIENT_ID!,
  //     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  //   },
  // },

  session: {
    // Sessions last 30 days; renew when 1 day remains.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5-min client-side cache
    },
  },

  user: {
    // Map BetterAuth's user model to our naming conventions.
    additionalFields: {
      displayName: {
        type: 'string',
        required: false,
        defaultValue: null,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

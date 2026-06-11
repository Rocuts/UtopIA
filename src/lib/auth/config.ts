import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '@/lib/db/client';
import * as authSchema from '@/lib/db/schema-auth';

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
// To activate a provider: uncomment the relevant block below and add the
// env vars to Vercel. No code change needed beyond that.
// ---------------------------------------------------------------------------

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: authSchema.authUsers,
      session: authSchema.authSessions,
      account: authSchema.authAccounts,
      verification: authSchema.authVerifications,
    },
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',

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

import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
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

  // Origins allowed to initiate auth flows. BetterAuth always trusts the
  // baseURL origin; we ADD Vercel preview deployments (utopia-*.vercel.app) so
  // login works on preview URLs without hardcoding each ephemeral host.
  trustedOrigins: (request) => {
    const origins: string[] = [];
    const base = process.env.BETTER_AUTH_URL;
    if (base) {
      try {
        origins.push(new URL(base).origin);
      } catch {
        /* malformed BETTER_AUTH_URL — baseURL fallback handles it */
      }
    }
    const reqOrigin = request?.headers.get('origin');
    if (reqOrigin) {
      try {
        const host = new URL(reqOrigin).host;
        if (host.endsWith('.vercel.app') && host.includes('utopia')) {
          origins.push(new URL(reqOrigin).origin);
        }
      } catch {
        /* ignore malformed Origin header */
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

import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// requireAuthSession — REAL session validation for costly API routes.
//
// Phased rollout contract (mirrors src/proxy.ts):
//   Phase 1 — BETTER_AUTH_SECRET absent:  no-op, returns { ok: true }.
//             Preserves the current anonymous-cookie behavior so the app keeps
//             working in dev / pre-auth production.
//   Phase 2 — BETTER_AUTH_SECRET set:     validates the session against the DB
//             via BetterAuth (`auth.api.getSession`). The proxy's cookie
//             PRESENCE check is only a cheap pre-filter and is forgeable
//             (`Cookie: better-auth.session_token=x`); THIS is the
//             authoritative gate.
//
// If session lookup throws (e.g. auth tables not migrated yet), we log and
// treat it as "no session" — fail closed in phase 2.
//
// Usage (first line of the handler):
//   const gate = await requireAuthSession();
//   if (!gate.ok) return gate.response;
// ---------------------------------------------------------------------------

export async function requireAuthSession(
  _req?: Request,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  // Phase 1 — auth not configured: no-op.
  if (!process.env.BETTER_AUTH_SECRET) {
    return { ok: true };
  }

  // Phase 2 — validate the session for real (lazy import keeps pg.Pool out
  // of routes until actually needed, same pattern as src/lib/db/workspace.ts).
  let session: unknown = null;
  try {
    const { auth } = await import('@/lib/auth/config');
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.error(
      '[auth] session validation failed:',
      err instanceof Error ? err.message : 'unknown',
    );
    session = null;
  }

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}

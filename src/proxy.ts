import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js 16 Proxy (formerly middleware.ts).
 *
 * Responsibilities for /api/*:
 *  1. Rate limiting — Vercel WAF via `@vercel/firewall` `checkRateLimit` when
 *     a rate-limit rule with the matching ID exists in the project firewall
 *     dashboard. We ALSO keep an in-memory per-process fallback as defense in
 *     depth and for local development (Fluid Compute may run multiple
 *     instances; the WAF is the source of truth in production).
 *  2. CSRF protection — Origin header check, fail-closed for mutating
 *     methods. Server-to-server endpoints that legitimately don't carry
 *     Origin (e.g. /api/cron/*) are explicitly allowlisted.
 *  3. Security headers — X-Content-Type-Options, X-Request-Id.
 *
 * Migration notes (vs the old src/middleware.ts):
 *  - File renamed `middleware.ts` -> `proxy.ts` (Next 16 convention).
 *  - Function renamed `middleware` -> `proxy`.
 *  - CSRF is now FAIL-CLOSED when Origin is missing on mutating methods.
 *  - Rate limit is now identified per-route by `rateLimitId` so the Vercel
 *    WAF dashboard can override or augment without a redeploy.
 *  - More endpoints are explicitly listed in RATE_LIMITS (the old default of
 *    60/min was too generous for LLM-backed routes).
 */

// ---------------------------------------------------------------------------
// Vercel WAF — checkRateLimit. Dynamically imported so the proxy still works
// if the package is missing locally (e.g. before `npm install`).
// ---------------------------------------------------------------------------

type CheckRateLimitFn = (
  rateLimitId: string,
  options: { request: Request; rateLimitKey?: string },
) => Promise<{ rateLimited: boolean }>;

let _wafChecker: CheckRateLimitFn | null | undefined;

async function getWafChecker(): Promise<CheckRateLimitFn | null> {
  if (_wafChecker !== undefined) return _wafChecker;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('@vercel/firewall');
    _wafChecker = (mod?.checkRateLimit ?? null) as CheckRateLimitFn | null;
  } catch {
    _wafChecker = null;
  }
  return _wafChecker;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (fallback / dev). Do NOT rely on this in
// multi-instance Fluid Compute. Configure Vercel WAF rules in the dashboard.
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Per-endpoint rate limits (requests per minute, per key).
 *
 * Tighter limits for LLM-backed routes (OCR, multi-agent pipelines) because
 * they cost real money per invocation. Pyme uploads run gpt-4o vision (~$0.015
 * per photo). Financial pipelines fan out to multiple agents at gpt-4o-mini.
 *
 * Cron endpoints are intentionally NOT rate-limited here — they are protected
 * by bearer token auth and run on a fixed schedule.
 */
const RATE_LIMITS: Record<string, number> = {
  // Chat / Q&A
  '/api/chat': 30,
  '/api/realtime': 30,
  '/api/repair-chat': 10,
  '/api/repair-session': 30,
  '/api/rag': 30,
  '/api/web-search': 20,
  '/api/tools/sanction': 30,
  '/api/tools/calendar': 30,

  // Financial / advisory pipelines (LLM heavy, $$$)
  '/api/financial-report': 10,
  '/api/financial-audit': 10,
  '/api/financial-quality': 10,
  '/api/tax-planning': 10,
  '/api/transfer-pricing': 10,
  '/api/business-valuation': 10,
  '/api/fiscal-audit-opinion': 10,
  '/api/tax-reconciliation': 10,
  '/api/feasibility-study': 10,

  // Document ingestion (OCR, parsing)
  '/api/upload': 20,
  '/api/pyme/uploads': 20,
  '/api/pyme/entries': 60,
  '/api/pyme/books': 60,
  '/api/pyme/reports/monthly': 5,

  // ERP integrations (sensitive — credentials)
  '/api/erp/connect': 5,
  '/api/erp/disconnect': 10,
  '/api/erp/status': 60,
  '/api/erp/providers': 60,
  '/api/erp/sync': 10,

  // Workspace bootstrap
  '/api/workspace': 60,

  // Future Ola 1 (núcleo contable). Listed pre-emptively so when these
  // routes ship they ALREADY have explicit limits instead of inheriting
  // the default and getting hammered.
  '/api/accounting/journal': 30,
  '/api/accounting/opening-balance': 5,
  '/api/accounting/accounts': 60,
};
const DEFAULT_RATE_LIMIT = 60;

/**
 * Endpoints that legitimately receive server-to-server traffic with no
 * `Origin` header. Vercel cron jobs hit these with a bearer token + no
 * browser origin; rejecting them on origin-grounds would break the schedule.
 *
 * Wildcards via prefix-match. Add NEW server-to-server endpoints (webhooks
 * etc.) here EXPLICITLY rather than loosening the global rule.
 */
const CSRF_ALLOWLIST: readonly string[] = ['/api/cron/'];

function getRateLimitConfig(pathname: string): { limit: number; id: string } {
  for (const [prefix, limit] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      // Convert "/api/financial-audit" -> "api_financial_audit"
      const id = `api${prefix.replace(/\//g, '_').replace(/-/g, '_')}`;
      return { limit, id };
    }
  }
  return { limit: DEFAULT_RATE_LIMIT, id: 'api_default' };
}

function isInMemoryLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > limit;
}

// Periodic cleanup to avoid memory leaks (every 5 minutes).
// Only meaningful in long-lived Fluid Compute instances; harmless otherwise.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
  }, 5 * 60_000);
}

function isCsrfAllowlisted(pathname: string): boolean {
  return CSRF_ALLOWLIST.some((prefix) => pathname.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Proxy entrypoint
// ---------------------------------------------------------------------------

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Defensive: matcher already restricts to /api/*, but this guards against
  // accidental matcher edits.
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // -------------------------------------------------------------------------
  // 1. CSRF / Origin check for mutating methods (fail-closed).
  //
  // The old middleware allowed requests with no Origin header through. That
  // bypasses CSRF entirely for any client willing to omit Origin. We now
  // require Origin on POST/PUT/PATCH/DELETE except for explicit
  // server-to-server allowlist entries.
  // -------------------------------------------------------------------------
  const isMutating =
    req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';

  if (isMutating && !isCsrfAllowlisted(pathname)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');

    if (!origin || !host) {
      return NextResponse.json(
        {
          error:
            'Cross-origin request blocked: missing Origin or Host header.',
        },
        { status: 403 },
      );
    }

    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json(
        { error: 'Cross-origin request blocked: malformed Origin header.' },
        { status: 403 },
      );
    }

    if (originHost !== host) {
      return NextResponse.json(
        { error: 'Cross-origin request blocked.' },
        { status: 403 },
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. Rate limiting.
  //
  // Key prefers the anonymous workspace cookie (stable per-tenant) over IP
  // (which is shared by NAT'd users and proxies). Falls back to IP.
  // -------------------------------------------------------------------------
  const workspaceId = req.cookies.get('utopia_workspace_id')?.value;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const rateKey = workspaceId ?? ip;

  const { limit, id: rateLimitId } = getRateLimitConfig(pathname);

  // Vercel WAF (preferred). Only effective when a rule with the matching
  // `rateLimitId` is configured in the project firewall dashboard. If the
  // rule is absent, checkRateLimit returns `rateLimited: false` and we fall
  // through to the in-memory limiter. Failures (e.g. local dev without the
  // package) also fall through.
  const wafCheck = await getWafChecker();
  if (wafCheck) {
    try {
      const { rateLimited } = await wafCheck(rateLimitId, {
        request: req,
        rateLimitKey: rateKey,
      });
      if (rateLimited) {
        return NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429 },
        );
      }
    } catch {
      // Swallow — fall through to the in-memory limiter so a WAF outage
      // doesn't take the API down.
    }
  }

  // In-memory backstop (per-process; not authoritative across instances).
  if (isInMemoryLimited(`${rateKey}:${pathname}`, limit)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }

  // -------------------------------------------------------------------------
  // 3. Security headers on the API response.
  // -------------------------------------------------------------------------
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Request-Id', crypto.randomUUID());

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};

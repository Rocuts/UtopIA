import { NextRequest, NextResponse } from 'next/server';

/**
 * In-memory rate limiter (per-process). For production, replace with
 * a shared store (Upstash Redis, etc.).
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMITS: Record<string, number> = {
  '/api/chat': 20,
  '/api/upload': 10,
  '/api/realtime': 10,
  '/api/rag': 30,
  '/api/web-search': 20,
  '/api/tools/sanction': 30,
  // Modulo Pyme — uploads disparan OCR (gpt-4o vision, ~$0.015/foto), por eso
  // mas estricto que /api/upload generico. reports/monthly llama al LLM
  // summarizer, costo medio.
  '/api/pyme/uploads': 8,
  '/api/pyme/reports/monthly': 10,
};
const DEFAULT_RATE_LIMIT = 60;

function getRateLimit(pathname: string): number {
  for (const [prefix, limit] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) return limit;
  }
  return DEFAULT_RATE_LIMIT;
}

function isRateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > limit;
}

// Periodic cleanup to avoid memory leaks (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // --- Origin check (CSRF protection) ---
  // Block requests from unknown origins to mutating endpoints
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');

    // Allow same-origin and server-to-server (no origin header)
    if (origin && host) {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { error: 'Cross-origin request blocked.' },
          { status: 403 }
        );
      }
    }
  }

  // --- Rate limiting ---
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `${ip}:${pathname}`;
  const limit = getRateLimit(pathname);

  if (isRateLimited(key, limit)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  // --- Add security headers to API responses ---
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Request-Id', crypto.randomUUID());

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};

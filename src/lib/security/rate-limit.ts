// ---------------------------------------------------------------------------
// Rate limiter — sliding window (in-memory) or Upstash Redis (distributed)
// ---------------------------------------------------------------------------
// Selects backend at startup:
//   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set → Upstash fixed-window
//     counter via REST API (no npm install needed, works across all instances).
//   - Variables absent → in-memory sliding window (single-instance / dev).
//
// To activate Upstash:
//   1. vercel integration add upstash   (provisions the vars automatically)
//   2. vercel env pull .env.local       (sync to local)
//   No code change needed — the backend switches automatically.
//
// Limits (per IP, per 60-second window):
//   'upload' — 10 requests  (file uploads are expensive: OCR + embedding)
//   'chat'   — 30 requests  (LLM calls)
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000; // 1 minute
const WINDOW_SECS = WINDOW_MS / 1000;

const LIMITS: Record<string, number> = {
  upload: 10,
  chat: 30,
};

// ---------------------------------------------------------------------------
// Shared result type
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Upstash REST adapter (fixed-window, no npm dependency)
// ---------------------------------------------------------------------------

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function upstashPipeline(
  commands: [string, ...(string | number)[]][],
): Promise<unknown[]> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash pipeline ${res.status}`);
  const body = (await res.json()) as { result: unknown }[];
  return body.map((r) => r.result);
}

async function checkRateLimitUpstash(
  key: string,
  endpoint: string,
): Promise<RateLimitResult> {
  const limit = LIMITS[endpoint] ?? 20;
  // Fixed-window bucket key: resets every WINDOW_MS.
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const redisKey = `rl:${endpoint}:${key}:${bucket}`;

  const [count] = await upstashPipeline([
    ['INCR', redisKey],
    ['EXPIRE', redisKey, WINDOW_SECS + 5], // +5s grace to avoid edge race
  ]);

  const n = typeof count === 'number' ? count : Number(count);
  const remaining = Math.max(0, limit - n);
  return { allowed: n <= limit, remaining, limit };
}

// ---------------------------------------------------------------------------
// In-memory sliding window (single-instance fallback)
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, Map<string, WindowEntry>>();

function checkRateLimitMemory(key: string, endpoint: string): RateLimitResult {
  const limit = LIMITS[endpoint] ?? 20;
  const now = Date.now();

  if (!store.has(endpoint)) store.set(endpoint, new Map());
  const endpointMap = store.get(endpoint)!;

  const entry = endpointMap.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    endpointMap.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, limit };
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, remaining, limit };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether `key` (typically client IP) has exceeded the rate limit for
 * `endpoint`. Uses Upstash Redis when env vars are configured, falls back to
 * in-memory sliding window otherwise.
 */
export async function checkRateLimit(
  key: string,
  endpoint: string,
): Promise<RateLimitResult> {
  if (USE_UPSTASH) {
    try {
      return await checkRateLimitUpstash(key, endpoint);
    } catch (err) {
      // Upstash unreachable — fail open with in-memory fallback to avoid
      // blocking all requests during a Redis outage.
      console.warn('[rate-limit] Upstash error, falling back to memory:', err);
      return checkRateLimitMemory(key, endpoint);
    }
  }
  return checkRateLimitMemory(key, endpoint);
}

/**
 * Extracts the best-effort client IP from a Request's headers.
 * Prefers x-forwarded-for (set by Vercel / reverse proxies).
 */
export function getClientIp(req: Request): string {
  const xfwd = req.headers.get('x-forwarded-for');
  if (xfwd) return xfwd.split(',')[0].trim();
  return 'unknown';
}

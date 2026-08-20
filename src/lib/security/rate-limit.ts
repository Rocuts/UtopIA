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
//
// `checkRateLimitDynamic` (API v1) acepta un límite explícito por llave y
// reporta `resetSeconds` para los headers RateLimit del draft IETF. El
// `checkRateLimit` legado delega en él sin cambiar su contrato.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000; // 1 minute
const WINDOW_SECS = WINDOW_MS / 1000;

const LIMITS: Record<string, number> = {
  upload: 10,
  chat: 30,
};

const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

export interface DynamicRateLimitResult extends RateLimitResult {
  /** Segundos hasta que la ventana actual expira (para Retry-After/RateLimit). */
  resetSeconds: number;
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

async function checkUpstashDynamic(
  name: string,
  limit: number,
): Promise<DynamicRateLimitResult> {
  const now = Date.now();
  // Fixed-window bucket key: resets every WINDOW_MS.
  const bucket = Math.floor(now / WINDOW_MS);
  const redisKey = `rl:${name}:${bucket}`;
  const resetSeconds = Math.max(1, Math.ceil(((bucket + 1) * WINDOW_MS - now) / 1000));

  const [count] = await upstashPipeline([
    ['INCR', redisKey],
    ['EXPIRE', redisKey, WINDOW_SECS + 5], // +5s grace to avoid edge race
  ]);

  const n = typeof count === 'number' ? count : Number(count);
  const remaining = Math.max(0, limit - n);
  return { allowed: n <= limit, remaining, limit, resetSeconds };
}

// ---------------------------------------------------------------------------
// In-memory sliding window (single-instance fallback)
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

function checkMemoryDynamic(name: string, limit: number): DynamicRateLimitResult {
  const now = Date.now();

  const entry = store.get(name);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    store.set(name, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, limit, resetSeconds: WINDOW_SECS };
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  const resetSeconds = Math.max(1, Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000));
  return { allowed: entry.count <= limit, remaining, limit, resetSeconds };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Variante con límite explícito (API v1: cuota por llave, no por endpoint
 * fijo). `name` debe ser único por bucket lógico (p.ej. `apiv1:read:<keyId>`).
 * Upstash cuando está configurado; memoria como fallback fail-open.
 */
export async function checkRateLimitDynamic(
  name: string,
  limit: number,
): Promise<DynamicRateLimitResult> {
  if (USE_UPSTASH) {
    try {
      return await checkUpstashDynamic(name, limit);
    } catch (err) {
      // Upstash unreachable — fail open with in-memory fallback to avoid
      // blocking all requests during a Redis outage.
      console.warn('[rate-limit] Upstash error, falling back to memory:', err);
      return checkMemoryDynamic(name, limit);
    }
  }
  return checkMemoryDynamic(name, limit);
}

/**
 * Check whether `key` (typically client IP) has exceeded the rate limit for
 * `endpoint`. Uses Upstash Redis when env vars are configured, falls back to
 * in-memory sliding window otherwise.
 *
 * Contrato legado intacto: mismo shape de retorno y mismas claves Redis
 * (`rl:${endpoint}:${key}:${bucket}`) que antes del refactor dinámico.
 */
export async function checkRateLimit(
  key: string,
  endpoint: string,
): Promise<RateLimitResult> {
  const limit = LIMITS[endpoint] ?? DEFAULT_LIMIT;
  const { allowed, remaining } = await checkRateLimitDynamic(
    `${endpoint}:${key}`,
    limit,
  );
  return { allowed, remaining, limit };
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

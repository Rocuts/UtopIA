// ---------------------------------------------------------------------------
// Cuota por llave del API v1 + headers RateLimit del draft IETF.
//
// Dos capas (spec §6): el WAF de Vercel por IP es el escudo volumétrico
// exterior (proxy.ts); esta es la cuota APLICATIVA por llave autenticada,
// separada en read/write (OWASP API4). Los headers siguen la sintaxis
// Structured Fields de draft-ietf-httpapi-ratelimit-headers-11 (aún draft —
// documentados como tales); el contrato estable es 429 + Retry-After.
// ---------------------------------------------------------------------------

import {
  checkRateLimitDynamic,
  type DynamicRateLimitResult,
} from '@/lib/security/rate-limit';

import { problemResponse } from './problems';

export type RateLimitKind = 'read' | 'write';

/** Headers draft-11: RateLimit-Policy (cuota configurada) + RateLimit (estado). */
export function rateLimitHeaders(
  policy: string,
  r: DynamicRateLimitResult,
): Record<string, string> {
  return {
    'RateLimit-Policy': `"${policy}";q=${r.limit};w=60`,
    RateLimit: `"${policy}";r=${r.remaining};t=${r.resetSeconds}`,
  };
}

export async function enforceKeyRateLimit(
  keyId: string,
  kind: RateLimitKind,
  limitRpm: number,
  requestId: string,
): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response }
> {
  const result = await checkRateLimitDynamic(`apiv1:${kind}:${keyId}`, limitRpm);
  const headers = rateLimitHeaders(kind, result);

  if (!result.allowed) {
    return {
      ok: false,
      response: problemResponse('rate_limited', {
        requestId,
        detail: `Cuota de ${kind === 'read' ? 'lectura' : 'escritura'} agotada (${limitRpm}/min). Reintente en ${result.resetSeconds}s.`,
        headers: { 'Retry-After': String(result.resetSeconds), ...headers },
      }),
    };
  }

  return { ok: true, headers };
}

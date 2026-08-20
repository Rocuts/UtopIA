// ---------------------------------------------------------------------------
// withApiV1 — pipeline de todo route handler de /api/v1.
//
// Orden fijo (spec §5): request_id → auth → scope → cuota por llave →
// body (tamaño + JSON) → Idempotency-Key → handler → headers estándar.
// Cualquier throw sale como problem+json 500 SIN filtrar internals (patrón
// /api/admin/telemetry). Las dependencias con DB se resuelven LAZY por
// request (getDb lanza sin DATABASE_URL en build-time).
// ---------------------------------------------------------------------------

import { getDb } from '@/lib/db/client';

import {
  authenticateApiRequest,
  createDrizzleAuthDeps,
  hasScopes,
  type AuthDeps,
  type AuthenticatedKey,
} from './auth';
import {
  createDrizzleIdempotencyStore,
  fingerprintBody,
  runIdempotent,
  type IdempotencyStore,
} from './idempotency';
import { newTypeId, ID_PREFIXES } from './ids';
import { problemResponse } from './problems';
import { enforceKeyRateLimit, type RateLimitKind } from './rate-limit';

export const API_VERSION = '2026-08-19';

const MAX_BODY_BYTES_DEFAULT = 2_097_152; // 2 MB — presupuesto OWASP API4
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export interface HandlerDeps {
  auth: AuthDeps;
  idempotencyStore: IdempotencyStore;
  rateLimit: typeof enforceKeyRateLimit;
}

export interface ApiV1Context {
  req: Request;
  requestId: string;
  key: AuthenticatedKey;
  workspaceId: string;
  /** Body crudo (solo si readBody). El JSON parseado va en `body`. */
  rawBody: string | null;
  body: unknown;
  params: Record<string, string>;
}

export interface ApiV1Config {
  scopes: string[];
  kind: RateLimitKind;
  /** Leer y parsear el body (POST/PATCH). */
  readBody?: boolean;
  /** Habilita Idempotency-Key con este identificador lógico de endpoint. */
  idempotencyEndpoint?: string;
  maxBodyBytes?: number;
  /** Inyección para tests; en producción se resuelven contra Drizzle. */
  deps?: Partial<HandlerDeps>;
}

/** Respuesta JSON del API con los headers estándar de toda respuesta v1. */
export function apiJson(
  status: number,
  body: unknown,
  requestId: string,
  headers?: Record<string, string>,
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      'Utopia-Api-Version': API_VERSION,
      ...headers,
    },
  });
}

let cachedDefaultDeps: HandlerDeps | null = null;

function resolveDeps(overrides?: Partial<HandlerDeps>): HandlerDeps {
  if (overrides?.auth && overrides.idempotencyStore && overrides.rateLimit) {
    return overrides as HandlerDeps;
  }
  if (!cachedDefaultDeps) {
    const db = getDb();
    cachedDefaultDeps = {
      auth: createDrizzleAuthDeps(db),
      idempotencyStore: createDrizzleIdempotencyStore(db),
      rateLimit: enforceKeyRateLimit,
    };
  }
  return { ...cachedDefaultDeps, ...overrides };
}

type RouteContext = { params: Promise<Record<string, string>> };

export function withApiV1(
  config: ApiV1Config,
  handler: (ctx: ApiV1Context) => Promise<Response>,
): (req: Request, route?: RouteContext) => Promise<Response> {
  return async (req, route) => {
    // El proxy propaga x-request-id; fallback local para tests/dev directo.
    const requestId =
      req.headers.get('x-request-id') ?? newTypeId(ID_PREFIXES.request).id;
    const instance = new URL(req.url).pathname;

    try {
      const deps = resolveDeps(config.deps);

      // ── Auth ──────────────────────────────────────────────────────────
      const auth = await authenticateApiRequest(req, deps.auth);
      if (!auth.ok) {
        return problemResponse(auth.code, { requestId, instance });
      }
      const key = auth.key;

      if (!hasScopes(key, config.scopes)) {
        return problemResponse('insufficient_scope', {
          requestId,
          instance,
          detail: `La operación requiere: ${config.scopes.join(', ')}.`,
        });
      }

      // ── Cuota por llave ───────────────────────────────────────────────
      const limitRpm = config.kind === 'read' ? key.rpmRead : key.rpmWrite;
      const rl = await deps.rateLimit(key.id, config.kind, limitRpm, requestId);
      if (!rl.ok) return rl.response;
      const rateHeaders = rl.headers;

      // ── Body ──────────────────────────────────────────────────────────
      let rawBody: string | null = null;
      let body: unknown = null;
      if (config.readBody) {
        rawBody = await req.text();
        const maxBytes = config.maxBodyBytes ?? MAX_BODY_BYTES_DEFAULT;
        if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
          return problemResponse('payload_too_large', {
            requestId,
            instance,
            detail: `El cuerpo supera el máximo de ${maxBytes} bytes.`,
          });
        }
        try {
          body = rawBody.length === 0 ? null : JSON.parse(rawBody);
        } catch {
          return problemResponse('malformed_json', { requestId, instance });
        }
      }

      const params = route?.params ? await route.params : {};
      const ctx: ApiV1Context = {
        req,
        requestId,
        key,
        workspaceId: key.workspaceId,
        rawBody,
        body,
        params,
      };

      // ── Idempotencia (opcional por endpoint, activada por el header) ──
      const idemKey = config.idempotencyEndpoint
        ? req.headers.get('idempotency-key')
        : null;

      if (idemKey !== null) {
        if (idemKey.length === 0 || idemKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
          return problemResponse('validation_failed', {
            requestId,
            instance,
            errors: [
              {
                detail: `Idempotency-Key debe tener entre 1 y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres.`,
                pointer: '',
              },
            ],
          });
        }

        const outcome = await runIdempotent(
          deps.idempotencyStore,
          {
            workspaceId: key.workspaceId,
            endpoint: config.idempotencyEndpoint!,
            key: idemKey,
            fingerprint: fingerprintBody(rawBody ?? ''),
          },
          async () => {
            const res = await handler(ctx);
            const text = await res.text();
            return {
              status: res.status,
              body: {
                payload: text.length > 0 ? JSON.parse(text) : null,
                location: res.headers.get('location'),
              },
            };
          },
        );

        if ('conflict' in outcome) {
          return problemResponse(
            outcome.conflict === 'in_use'
              ? 'idempotency_key_in_use'
              : 'idempotency_payload_mismatch',
            { requestId, instance },
          );
        }

        const stored = outcome.body as { payload: unknown; location: string | null };
        return apiJson(outcome.status, stored.payload, requestId, {
          ...rateHeaders,
          ...(stored.location ? { Location: stored.location } : {}),
          ...(outcome.replayed ? { 'Idempotent-Replayed': 'true' } : {}),
        });
      }

      // ── Camino directo ────────────────────────────────────────────────
      const res = await handler(ctx);
      res.headers.set('X-Request-Id', requestId);
      res.headers.set('Utopia-Api-Version', API_VERSION);
      res.headers.set('Cache-Control', 'no-store');
      for (const [name, value] of Object.entries(rateHeaders)) {
        res.headers.set(name, value);
      }
      return res;
    } catch (err) {
      // Detail server-side only: err puede traer internals de Postgres.
      console.error('[api-v1]', requestId, instance, err);
      return problemResponse('internal_error', { requestId, instance });
    }
  };
}

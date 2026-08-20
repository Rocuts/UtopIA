// ---------------------------------------------------------------------------
// Errores del API público — RFC 9457 (Problem Details for HTTP APIs).
//
// Contrato: TODO error no-2xx de /api/v1 sale por problemResponse() con
// Content-Type application/problem+json. `code` es el identificador estable
// que los clientes deben matchear (el `type` URI puede cambiar de dominio);
// `detail` va en español (integradores colombianos), `type`/`code` en inglés.
// Extensión `errors[]` = validación con JSON Pointer (ejemplo canónico del
// propio RFC 9457 §3).
// ---------------------------------------------------------------------------

import type { z } from 'zod';

export type ProblemCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'api_disabled'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'malformed_json'
  | 'validation_failed'
  | 'empty_trial_balance'
  | 'idempotency_key_in_use'
  | 'idempotency_payload_mismatch'
  | 'not_found'
  | 'payload_too_large'
  | 'precondition_required'
  | 'precondition_failed'
  | 'internal_error';

export interface ProblemValidationError {
  detail: string;
  pointer: string;
}

interface ProblemDefinition {
  status: number;
  title: string;
}

// `title` describe el TIPO de problema (estable por code), no la ocurrencia
// concreta — eso va en `detail` (RFC 9457 §3.1.3).
const PROBLEM_CATALOG: Record<ProblemCode, ProblemDefinition> = {
  missing_api_key: { status: 401, title: 'Falta la llave del API' },
  invalid_api_key: { status: 401, title: 'Llave del API inválida' },
  api_disabled: { status: 503, title: 'El API no está habilitado en este entorno' },
  insufficient_scope: { status: 403, title: 'La llave no tiene el scope requerido' },
  rate_limited: { status: 429, title: 'Se excedió la cuota de solicitudes' },
  malformed_json: { status: 400, title: 'El cuerpo no es JSON válido' },
  validation_failed: { status: 400, title: 'El cuerpo no cumple el contrato del recurso' },
  empty_trial_balance: { status: 422, title: 'La remisión no contiene filas PUC reconocibles' },
  idempotency_key_in_use: { status: 409, title: 'La Idempotency-Key tiene una solicitud en curso' },
  idempotency_payload_mismatch: {
    status: 422,
    title: 'La Idempotency-Key ya se usó con un cuerpo distinto',
  },
  not_found: { status: 404, title: 'El recurso no existe' },
  payload_too_large: { status: 413, title: 'El cuerpo excede el tamaño máximo' },
  precondition_required: { status: 428, title: 'La operación exige el header If-Match' },
  precondition_failed: { status: 412, title: 'El If-Match no coincide con la versión actual' },
  internal_error: { status: 500, title: 'Error interno' },
};

export const PROBLEM_STATUS = Object.fromEntries(
  Object.entries(PROBLEM_CATALOG).map(([code, def]) => [code, def.status]),
) as Record<ProblemCode, number>;

// Identificador estable y dereferenciable en la doc pública. Los clientes
// matchean por `code`; el host del type puede evolucionar sin romper a nadie.
const PROBLEM_TYPE_BASE = 'https://utopia.app/docs/api/problems#';

export interface ProblemOptions {
  requestId: string;
  detail?: string;
  instance?: string;
  errors?: ProblemValidationError[];
  headers?: Record<string, string>;
}

/** Construye la Response problem+json para un code del catálogo. */
export function problemResponse(code: ProblemCode, opts: ProblemOptions): Response {
  const def = PROBLEM_CATALOG[code];
  const body: Record<string, unknown> = {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title: def.title,
    status: def.status,
    code,
    request_id: opts.requestId,
  };
  if (opts.detail) body.detail = opts.detail;
  if (opts.instance) body.instance = opts.instance;
  if (opts.errors && opts.errors.length > 0) body.errors = opts.errors;

  return new Response(JSON.stringify(body), {
    status: def.status,
    headers: {
      'Content-Type': 'application/problem+json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': opts.requestId,
      ...opts.headers,
    },
  });
}

/** Mapea issues de Zod a la extensión errors[] con JSON Pointers. */
export function zodIssuesToErrors(error: z.ZodError): ProblemValidationError[] {
  return error.issues.map((issue) => ({
    detail: issue.message,
    pointer: issue.path.length === 0 ? '' : `/${issue.path.map(String).join('/')}`,
  }));
}

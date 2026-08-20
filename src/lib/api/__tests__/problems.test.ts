// ---------------------------------------------------------------------------
// problems.ts — errores RFC 9457 (application/problem+json).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PROBLEM_STATUS, problemResponse, zodIssuesToErrors } from '../problems';

describe('problemResponse', () => {
  it('produce problem+json con los miembros RFC 9457 + extensiones', async () => {
    const res = problemResponse('rate_limited', {
      requestId: 'req_x',
      detail: 'Cuota de escritura agotada.',
      instance: '/api/v1/trial-balances',
      headers: { 'Retry-After': '30' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('x-request-id')).toBe('req_x');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = await res.json();
    expect(body.type).toContain('rate_limited');
    expect(body.title).toBeTruthy();
    expect(body.status).toBe(429);
    expect(body.code).toBe('rate_limited');
    expect(body.detail).toBe('Cuota de escritura agotada.');
    expect(body.instance).toBe('/api/v1/trial-balances');
    expect(body.request_id).toBe('req_x');
  });

  it('incluye errors[] cuando se pasan errores de validación', async () => {
    const res = problemResponse('validation_failed', {
      requestId: 'req_y',
      errors: [{ detail: 'Se esperaba string', pointer: '/csv' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual([{ detail: 'Se esperaba string', pointer: '/csv' }]);
  });

  it('mantiene el catálogo de status coherente', () => {
    expect(PROBLEM_STATUS.not_found).toBe(404);
    expect(PROBLEM_STATUS.api_disabled).toBe(503);
    expect(PROBLEM_STATUS.idempotency_key_in_use).toBe(409);
    expect(PROBLEM_STATUS.idempotency_payload_mismatch).toBe(422);
    expect(PROBLEM_STATUS.precondition_required).toBe(428);
  });
});

describe('zodIssuesToErrors', () => {
  it('convierte paths de Zod a JSON Pointers', () => {
    const schema = z.strictObject({
      csv: z.string(),
      nested: z.strictObject({ items: z.array(z.number()) }).optional(),
    });
    const parsed = schema.safeParse({ csv: 5, nested: { items: ['x'] } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const errors = zodIssuesToErrors(parsed.error);
    const pointers = errors.map((e) => e.pointer);
    expect(pointers).toContain('/csv');
    expect(pointers).toContain('/nested/items/0');
    for (const e of errors) expect(e.detail.length).toBeGreaterThan(0);
  });
});

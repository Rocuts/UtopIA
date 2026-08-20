// ---------------------------------------------------------------------------
// pagination.ts — cursores opacos firmados con HMAC (DB_HMAC_KEY).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { decodeCursor, encodeCursor, parsePageParams } from '../pagination';

const ORIGINAL = process.env.DB_HMAC_KEY;

beforeEach(() => {
  process.env.DB_HMAC_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DB_HMAC_KEY;
  else process.env.DB_HMAC_KEY = ORIGINAL;
});

describe('encodeCursor / decodeCursor', () => {
  it('roundtrip preserva createdAt (ms) e id', () => {
    const createdAt = new Date('2026-08-19T15:04:05.123Z');
    const id = 'a3bb189e-8bf9-7888-9912-ace4e6543002';
    const cursor = encodeCursor(createdAt, id);
    // opaco: base64url sin '.', '+', '/'
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt.getTime()).toBe(createdAt.getTime());
    expect(decoded!.id).toBe(id);
  });

  it('rechaza manipulación (firma inválida) y basura', () => {
    const cursor = encodeCursor(new Date(), 'a3bb189e-8bf9-7888-9912-ace4e6543002');
    const tampered = cursor.slice(0, -2) + (cursor.endsWith('AA') ? 'BB' : 'AA');
    expect(decodeCursor(tampered)).toBeNull();
    expect(decodeCursor('no-es-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('la firma depende de la clave', () => {
    const cursor = encodeCursor(new Date(), 'a3bb189e-8bf9-7888-9912-ace4e6543002');
    process.env.DB_HMAC_KEY = randomBytes(32).toString('base64');
    expect(decodeCursor(cursor)).toBeNull();
  });
});

describe('parsePageParams', () => {
  it('aplica default 20 y clamp 1..100', () => {
    const base = 'https://x.test/api/v1/trial-balances';
    const p1 = parsePageParams(new URL(base));
    expect('invalid' in p1 ? null : p1.limit).toBe(20);
    const p2 = parsePageParams(new URL(`${base}?limit=200`));
    expect('invalid' in p2 ? null : p2.limit).toBe(100);
    const p3 = parsePageParams(new URL(`${base}?limit=1`));
    expect('invalid' in p3 ? null : p3.limit).toBe(1);
  });

  it('reporta limit no numérico y cursor con firma rota', () => {
    const base = 'https://x.test/api/v1/trial-balances';
    expect(parsePageParams(new URL(`${base}?limit=abc`))).toHaveProperty('invalid');
    expect(parsePageParams(new URL(`${base}?cursor=roto`))).toHaveProperty('invalid');
  });

  it('devuelve cursor null cuando no viene', () => {
    const p = parsePageParams(new URL('https://x.test/api/v1/trial-balances'));
    if ('invalid' in p) throw new Error('no debía ser inválido');
    expect(p.cursor).toBeNull();
  });
});

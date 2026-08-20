// ---------------------------------------------------------------------------
// encoding.ts — base62 CSPRNG, CRC32 (IEEE 802.3) y Crockford base32 (TypeID).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  crc32,
  crc32Base62,
  decodeCrockford32,
  encodeCrockford32,
  randomBase62,
} from '../encoding';

const BASE62_RE = /^[0-9A-Za-z]+$/;

describe('crc32', () => {
  it('coincide con el vector canónico IEEE ("123456789" → 0xCBF43926)', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
  });

  it('es determinista y distinto para entradas distintas', () => {
    expect(crc32('utopia')).toBe(crc32('utopia'));
    expect(crc32('utopia')).not.toBe(crc32('utopib'));
  });
});

describe('crc32Base62', () => {
  it('siempre produce 6 caracteres base62 (pad a la izquierda)', () => {
    for (const input of ['x', '', 'utop_sk_live_abc', '123456789']) {
      const out = crc32Base62(input);
      expect(out).toHaveLength(6);
      expect(out).toMatch(BASE62_RE);
    }
  });
});

describe('randomBase62', () => {
  it('produce la longitud pedida con alfabeto base62', () => {
    const out = randomBase62(26);
    expect(out).toHaveLength(26);
    expect(out).toMatch(BASE62_RE);
  });

  it('dos llamadas difieren (CSPRNG)', () => {
    expect(randomBase62(26)).not.toBe(randomBase62(26));
  });
});

describe('crockford base32 (TypeID)', () => {
  it('roundtrip encode→decode para 16 bytes aleatorios', () => {
    for (let i = 0; i < 20; i++) {
      const bytes = new Uint8Array(randomBytes(16));
      const encoded = encodeCrockford32(bytes);
      expect(encoded).toHaveLength(26);
      expect(decodeCrockford32(encoded)).toEqual(bytes);
    }
  });

  it('el primer carácter cae en 0..7 (los 2 bits altos de 130 son cero)', () => {
    const bytes = new Uint8Array(16).fill(0xff);
    const encoded = encodeCrockford32(bytes);
    expect('01234567').toContain(encoded[0]);
  });

  it('rechaza longitud incorrecta, alfabeto inválido y overflow', () => {
    expect(decodeCrockford32('abc')).toBeNull();
    // 'u' no pertenece al alfabeto crockford lowercase
    expect(decodeCrockford32('u'.repeat(26))).toBeNull();
    // primer char 'z' (valor 31) implica >= 2^128 → overflow
    expect(decodeCrockford32('z' + '0'.repeat(25))).toBeNull();
  });
});

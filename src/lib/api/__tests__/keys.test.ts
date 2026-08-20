// ---------------------------------------------------------------------------
// keys.ts — tokens utop_sk_{live|test}_ con checksum CRC32 y HMAC-pepper.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  generateApiKeyToken,
  hashApiKeyToken,
  isApiKeyPepperConfigured,
  parseApiKeyToken,
  verifyApiKeyChecksum,
} from '../keys';

const TOKEN_RE = /^utop_sk_(live|test)_[0-9A-Za-z]{32}$/;

const ORIGINAL_PEPPER = process.env.UTOPIA_API_KEY_PEPPER;

beforeEach(() => {
  process.env.UTOPIA_API_KEY_PEPPER = randomBytes(32).toString('base64');
});

afterEach(() => {
  if (ORIGINAL_PEPPER === undefined) delete process.env.UTOPIA_API_KEY_PEPPER;
  else process.env.UTOPIA_API_KEY_PEPPER = ORIGINAL_PEPPER;
});

describe('generateApiKeyToken', () => {
  it('produce el formato utop_sk_{mode}_ + 26 body + 6 checksum', () => {
    const live = generateApiKeyToken('live');
    const test = generateApiKeyToken('test');
    expect(live.token).toMatch(TOKEN_RE);
    expect(live.token).toContain('utop_sk_live_');
    expect(test.token).toContain('utop_sk_test_');
    expect(live.mode).toBe('live');
    expect(live.prefix).toBe('utop_sk_live_');
    expect(live.last4).toBe(live.token.slice(-4));
  });

  it('el checksum del token generado siempre verifica', () => {
    for (let i = 0; i < 10; i++) {
      expect(verifyApiKeyChecksum(generateApiKeyToken('live').token)).toBe(true);
    }
  });
});

describe('verifyApiKeyChecksum / parseApiKeyToken', () => {
  it('detecta corrupción de un carácter del cuerpo', () => {
    const { token } = generateApiKeyToken('test');
    const i = 'utop_sk_test_'.length + 3;
    const flipped = token[i] === 'A' ? 'B' : 'A';
    const corrupted = token.slice(0, i) + flipped + token.slice(i + 1);
    expect(verifyApiKeyChecksum(corrupted)).toBe(false);
  });

  it('rechaza basura y prefijos ajenos', () => {
    expect(parseApiKeyToken('garbage')).toBeNull();
    expect(parseApiKeyToken('sk_live_abc')).toBeNull();
    expect(parseApiKeyToken('utop_sk_prod_' + '0'.repeat(32))).toBeNull();
    expect(parseApiKeyToken('utop_sk_live_' + '0'.repeat(10))).toBeNull();
    expect(verifyApiKeyChecksum('garbage')).toBe(false);
  });

  it('parsea modo, cuerpo y checksum', () => {
    const { token } = generateApiKeyToken('live');
    const parsed = parseApiKeyToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.mode).toBe('live');
    expect(parsed!.body).toHaveLength(26);
    expect(parsed!.checksum).toHaveLength(6);
  });
});

describe('hashApiKeyToken', () => {
  it('es determinista (64 hex) y depende del pepper', () => {
    const { token } = generateApiKeyToken('live');
    const h1 = hashApiKeyToken(token);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKeyToken(token)).toBe(h1);
    process.env.UTOPIA_API_KEY_PEPPER = randomBytes(32).toString('base64');
    expect(hashApiKeyToken(token)).not.toBe(h1);
  });

  it('sin pepper: isApiKeyPepperConfigured false y hash lanza', () => {
    delete process.env.UTOPIA_API_KEY_PEPPER;
    expect(isApiKeyPepperConfigured()).toBe(false);
    expect(() => hashApiKeyToken('utop_sk_live_x')).toThrow();
  });
});

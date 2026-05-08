import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import {
  encryptSecret,
  decryptSecret,
  tryDecryptWithRotation,
  isEncryptedEnvelope,
} from '../vault';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshKey(): string {
  return randomBytes(32).toString('base64');
}

// Flip the first base64url character of a segment to a different value.
function tamperSegment(envelope: string, segmentIndex: number): string {
  const parts = envelope.split(':');
  const seg = parts[segmentIndex];
  // Replace first char with a different char (cycle through a→b→a etc.)
  const first = seg[0];
  const replacement = first === 'A' ? 'B' : 'A';
  parts[segmentIndex] = replacement + seg.slice(1);
  return parts.join(':');
}

// ---------------------------------------------------------------------------
// State management — save/restore env per test
// ---------------------------------------------------------------------------

let savedKey: string | undefined;
let savedKeyPrev: string | undefined;

beforeEach(() => {
  savedKey = process.env.UTOPIA_VAULT_KEY;
  savedKeyPrev = process.env.UTOPIA_VAULT_KEY_PREV;
  // Reset to a fresh key for each test
  process.env.UTOPIA_VAULT_KEY = freshKey();
  delete process.env.UTOPIA_VAULT_KEY_PREV;
});

afterEach(() => {
  if (savedKey === undefined) {
    delete process.env.UTOPIA_VAULT_KEY;
  } else {
    process.env.UTOPIA_VAULT_KEY = savedKey;
  }
  if (savedKeyPrev === undefined) {
    delete process.env.UTOPIA_VAULT_KEY_PREV;
  } else {
    process.env.UTOPIA_VAULT_KEY_PREV = savedKeyPrev;
  }
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('encryptSecret / decryptSecret', () => {
  it('round-trips ASCII plaintext', () => {
    const envelope = encryptSecret('hello');
    expect(decryptSecret(envelope)).toBe('hello');
  });

  it('round-trips UTF-8 with Spanish accents', () => {
    const plaintext = 'señor pérez 1234';
    const envelope = encryptSecret(plaintext);
    expect(decryptSecret(envelope)).toBe(plaintext);
  });

  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({ apiKey: 'k', accessToken: 't' });
    const envelope = encryptSecret(payload);
    expect(decryptSecret(envelope)).toBe(payload);
  });

  it('produces different IVs on repeated encryptions of the same plaintext', () => {
    const e1 = encryptSecret('same');
    const e2 = encryptSecret('same');
    // IVs are segment index 2
    const iv1 = e1.split(':')[2];
    const iv2 = e2.split(':')[2];
    expect(iv1).not.toBe(iv2);
    expect(e1).not.toBe(e2);
  });
});

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

describe('tamper detection', () => {
  it('throws when the auth tag is flipped', () => {
    const envelope = encryptSecret('tamper me');
    const tampered = tamperSegment(envelope, 3); // segment 3 = tag
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws when the ciphertext is flipped', () => {
    const envelope = encryptSecret('tamper me');
    const tampered = tamperSegment(envelope, 4); // segment 4 = ciphertext
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------

describe('key validation', () => {
  it('throws with generation recipe when UTOPIA_VAULT_KEY is missing', () => {
    delete process.env.UTOPIA_VAULT_KEY;
    expect(() => encryptSecret('x')).toThrow(/node -e/);
  });

  it('throws with actual vs expected length when key decodes to wrong length', () => {
    // 16-byte key → base64 is 24 chars — wrong length
    process.env.UTOPIA_VAULT_KEY = randomBytes(16).toString('base64');
    expect(() => encryptSecret('x')).toThrow(/16.*32|expected 32/i);
  });
});

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------

describe('envelope parsing', () => {
  it('throws on unknown version', () => {
    expect(() => decryptSecret('v2:gcm:a:b:c')).toThrow(/unknown version/i);
  });

  it('throws on malformed envelope (fewer than 5 segments)', () => {
    expect(() => decryptSecret('not-an-envelope')).toThrow(/malformed segments/i);
  });

  it('throws on malformed envelope (4 segments)', () => {
    expect(() => decryptSecret('v1:gcm:a:b')).toThrow(/malformed segments/i);
  });

  it('throws on unknown algorithm', () => {
    expect(() => decryptSecret('v1:cbc:a:b:c')).toThrow(/unknown algorithm/i);
  });
});

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

describe('tryDecryptWithRotation', () => {
  it('returns keyVersion "current" when current key decrypts successfully', () => {
    const envelope = encryptSecret('rotation test');
    const result = tryDecryptWithRotation(envelope);
    expect(result.plaintext).toBe('rotation test');
    expect(result.keyVersion).toBe('current');
  });

  it('falls back to PREV key and returns keyVersion "prev"', () => {
    const keyA = freshKey();
    process.env.UTOPIA_VAULT_KEY = keyA;
    const envelope = encryptSecret('rotation payload');

    // Rotate: A becomes PREV, B becomes current
    const keyB = freshKey();
    process.env.UTOPIA_VAULT_KEY = keyB;
    process.env.UTOPIA_VAULT_KEY_PREV = keyA;

    const result = tryDecryptWithRotation(envelope);
    expect(result.plaintext).toBe('rotation payload');
    expect(result.keyVersion).toBe('prev');
  });

  it('throws when neither current nor PREV key can decrypt', () => {
    const keyA = freshKey();
    process.env.UTOPIA_VAULT_KEY = keyA;
    const envelope = encryptSecret('secret');

    // Both keys differ from the one that encrypted
    process.env.UTOPIA_VAULT_KEY = freshKey();
    process.env.UTOPIA_VAULT_KEY_PREV = freshKey();

    expect(() => tryDecryptWithRotation(envelope)).toThrow();
  });

  it('throws when there is no PREV key to fall back to', () => {
    const keyA = freshKey();
    process.env.UTOPIA_VAULT_KEY = keyA;
    const envelope = encryptSecret('secret');

    process.env.UTOPIA_VAULT_KEY = freshKey();
    delete process.env.UTOPIA_VAULT_KEY_PREV;

    expect(() => tryDecryptWithRotation(envelope)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isEncryptedEnvelope
// ---------------------------------------------------------------------------

describe('isEncryptedEnvelope', () => {
  it('returns true for a valid v1:gcm envelope', () => {
    const envelope = encryptSecret('check');
    expect(isEncryptedEnvelope(envelope)).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isEncryptedEnvelope('plain')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEncryptedEnvelope('')).toBe(false);
  });

  it('returns false for v1:cbc:... envelope shape', () => {
    expect(isEncryptedEnvelope('v1:cbc:iv:tag:ct')).toBe(false);
  });

  it('returns false for a 4-segment string starting with v1:gcm:', () => {
    // Only 4 colons would be 5 segments, let's do 3 colons = 4 segments
    expect(isEncryptedEnvelope('v1:gcm:a:b')).toBe(false);
  });

  it('returns false for v2:gcm:... envelope shape', () => {
    expect(isEncryptedEnvelope('v2:gcm:a:b:c')).toBe(false);
  });
});

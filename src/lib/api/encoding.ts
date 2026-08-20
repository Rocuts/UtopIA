// ---------------------------------------------------------------------------
// Encodings del API público — base62, CRC32 y Crockford base32.
//
// - base62: cuerpo aleatorio de las llaves `utop_sk_*` (rejection sampling
//   para no sesgar la distribución con el módulo).
// - CRC32 (IEEE 802.3): checksum offline de la llave, diseño del formato de
//   tokens de GitHub — descarta basura sin tocar la DB y elimina falsos
//   positivos de secret scanning.
// - Crockford base32 lowercase: sufijo de 26 chars de los IDs públicos
//   estilo TypeID (`tb_…`), codificación de un UUID de 128 bits.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Alfabeto Crockford (sin i, l, o, u) en minúscula — el que usa TypeID.
const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

const CROCKFORD_INDEX: Record<string, bigint> = {};
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_INDEX[CROCKFORD_ALPHABET[i]] = BigInt(i);
}

// 248 = 62 * 4: el mayor múltiplo de 62 que cabe en un byte. Bytes >= 248 se
// descartan para que `b % 62` sea uniforme.
const BASE62_REJECTION_LIMIT = 248;

/** Cadena aleatoria base62 de `length` chars desde CSPRNG, sin sesgo. */
export function randomBase62(length: number): string {
  const out: string[] = [];
  while (out.length < length) {
    const chunk = randomBytes(length * 2);
    for (const byte of chunk) {
      if (byte >= BASE62_REJECTION_LIMIT) continue;
      out.push(BASE62_ALPHABET[byte % 62]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// CRC32 — tabla precomputada, polinomio reflejado 0xEDB88320 (IEEE 802.3).
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (unsigned) del UTF-8 de `input`. Vector: '123456789' → 0xCBF43926. */
export function crc32(input: string): number {
  const bytes = Buffer.from(input, 'utf8');
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC32_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC32 codificado en base62, siempre 6 chars (pad '0' a la izquierda). */
export function crc32Base62(input: string): string {
  let n = crc32(input);
  let out = '';
  while (n > 0) {
    out = BASE62_ALPHABET[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out.padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Crockford base32 — 16 bytes ↔ 26 chars (130 bits, los 2 altos en cero).
// ---------------------------------------------------------------------------

const UUID_BIT_LIMIT = 1n << 128n;

/** Codifica exactamente 16 bytes en 26 chars Crockford lowercase. */
export function encodeCrockford32(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`encodeCrockford32 espera 16 bytes, llegaron ${bytes.length}`);
  }
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) | BigInt(byte);
  }
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD_ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/** Decodifica 26 chars Crockford a 16 bytes; null si es inválido u overflow. */
export function decodeCrockford32(s: string): Uint8Array | null {
  if (s.length !== 26) return null;
  let n = 0n;
  for (const ch of s) {
    const v = CROCKFORD_INDEX[ch];
    if (v === undefined) return null;
    n = (n << 5n) | v;
  }
  if (n >= UUID_BIT_LIMIT) return null;
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

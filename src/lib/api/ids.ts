// ---------------------------------------------------------------------------
// IDs públicos del API — estilo TypeID: `<prefijo>_<uuid v7 en crockford32>`.
//
// El PK uuid de la fila ES el ID público decodificado: cero columnas
// duplicadas, cero desync. UUIDv7 (RFC 9562) da localidad de índice B-tree
// en Neon y 74 bits aleatorios (no enumerable). La autorización JAMÁS
// depende del secreto del ID: todo query filtra por workspace_id de la
// llave (ver spec §2 Q5 para el caveat RFC 9562 registrado).
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import { decodeCrockford32, encodeCrockford32 } from './encoding';

export const ID_PREFIXES = {
  trialBalance: 'tb',
  webhookEndpoint: 'whe',
  webhookMessage: 'msg',
  apiKey: 'key',
  request: 'req',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES] | string;

/** UUIDv7 canónico: 48 bits de unix-ms + versión 7 + variante 10 + random. */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  // Target ES2017: sin literales BigInt — se opera el timestamp en number
  // (48 bits < 2^53, seguro hasta el año 10889).
  const ms = Date.now();
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidToBytes(uuid: string): Uint8Array | null {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** ID público desde un uuid existente: `tb_0698fq7yv7f7btkdjq8x2xz3ec`. */
export function typeIdFrom(prefix: IdPrefix, uuid: string): string {
  const bytes = uuidToBytes(uuid);
  if (!bytes) {
    throw new Error(`typeIdFrom: uuid inválido para prefijo ${prefix}`);
  }
  return `${prefix}_${encodeCrockford32(bytes)}`;
}

/** Genera uuid v7 nuevo + su ID público. El uuid va al PK, el id al cliente. */
export function newTypeId(prefix: IdPrefix): { id: string; uuid: string } {
  const uuid = uuidv7();
  return { id: typeIdFrom(prefix, uuid), uuid };
}

/** Decodifica un ID público al uuid del PK; null si no es de este prefijo. */
export function parseTypeId(prefix: IdPrefix, value: string): string | null {
  const expected = `${prefix}_`;
  if (!value.startsWith(expected)) return null;
  const bytes = decodeCrockford32(value.slice(expected.length));
  if (!bytes) return null;
  return bytesToUuid(bytes);
}

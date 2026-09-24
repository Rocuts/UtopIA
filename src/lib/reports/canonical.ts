import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Serialización canónica y huella SHA-256 de versiones de informe
// ---------------------------------------------------------------------------
// La huella identifica una versión persistida del informe y del balance del
// que salió. Tiene que ser reproducible por cualquiera que tenga el mismo
// contenido, así que la serialización es canónica:
//
//   - claves de objetos ordenadas lexicográficamente en todos los niveles;
//   - arreglos en su orden (el orden de renglones de un estado es semántico);
//   - bigint → cadena decimal (MoneyCop: centavos sin pérdida de precisión);
//   - misma semántica que JSON para `undefined` (se omite en objetos, `null`
//     en arreglos) y para números no finitos (`null`).
//
// Es la forma del contenido tras un viaje de ida y vuelta por `jsonb`: lo que
// se guarda y lo que se lee producen la misma huella.
// ---------------------------------------------------------------------------

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    out[key] = normalize(v);
  }
  return out;
}

/** JSON canónico (claves ordenadas, bigint como cadena decimal). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? 'null';
}

/** Huella SHA-256 hexadecimal (64 caracteres) de un texto UTF-8. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Huella SHA-256 del JSON canónico de un valor. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Clon JSON-safe canónico (lo que devolvería `jsonb`). */
export function toCanonicalJsonValue<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

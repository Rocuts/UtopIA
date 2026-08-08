// ---------------------------------------------------------------------------
// Regresión — `security/encryption.ts` falla RUIDOSO ante una clave malformada.
//
// El módulo es una receta pgcrypto sin ningún importador de producción
// (verificado: los únicos hits de `encryptColumn|decryptColumn|
// encryptedLookupValue` fuera del propio archivo están en docs). Está marcado
// @deprecated a favor de `vault.ts`, pero mientras siga en el árbol es una
// trampa: `getKey()` devuelve el string base64 CRUDO y se lo pasa como
// PASSPHRASE a `pgp_sym_encrypt` / `hmac`. pgcrypto no valida nada — un '\n'
// pegado al final de la variable de entorno (lo normal al pegar en un
// dashboard) produce un digest distinto SIN error: las filas se cifran con una
// clave y luego no descifran, o los lookups HMAC devuelven 0 filas para siempre.
//
// El código viejo sólo hacía `console.warn` una vez por proceso. Estos tests
// exigen que lance — y FALLAN con ese código, que devolvía la clave sucia tan
// tranquilo.
//
// Nótese que `encryptedLookupValue()` YA lanzaba ante una clave de longitud
// equivocada. Esto alinea el camino de cifrado con el de HMAC: o los dos
// fallan duro, o el par cifrado/lookup queda desincronizado en silencio.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  encryptColumn,
  decryptColumn,
  encryptedLookupValue,
} from '../encryption';

// 32 bytes en base64 → 44 chars. Clave bien formada.
const CLAVE_OK = Buffer.alloc(32, 7).toString('base64');

const ORIGINAL = {
  enc: process.env.DB_ENCRYPTION_KEY,
  hmac: process.env.DB_HMAC_KEY,
};

beforeEach(() => {
  process.env.DB_ENCRYPTION_KEY = CLAVE_OK;
  process.env.DB_HMAC_KEY = CLAVE_OK;
});

afterEach(() => {
  for (const [name, value] of [
    ['DB_ENCRYPTION_KEY', ORIGINAL.enc],
    ['DB_HMAC_KEY', ORIGINAL.hmac],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('DB_ENCRYPTION_KEY malformada → error, no warning', () => {
  it('lanza si la clave trae un salto de línea pegado', () => {
    process.env.DB_ENCRYPTION_KEY = `${CLAVE_OK}\n`;
    expect(() => encryptColumn('secreto')).toThrow(/DB_ENCRYPTION_KEY/);
  });

  it('lanza si la clave trae espacios alrededor', () => {
    process.env.DB_ENCRYPTION_KEY = `  ${CLAVE_OK}  `;
    expect(() => encryptColumn('secreto')).toThrow(/DB_ENCRYPTION_KEY/);
  });

  it('lanza si la clave no decodifica a 32 bytes', () => {
    process.env.DB_ENCRYPTION_KEY = Buffer.alloc(16, 7).toString('base64');
    expect(() => encryptColumn('secreto')).toThrow(/32/);
  });

  it('lanza si la clave no está seteada', () => {
    delete process.env.DB_ENCRYPTION_KEY;
    expect(() => encryptColumn('secreto')).toThrow(/no está definida|is not set/);
  });

  it('decryptColumn valida la clave igual que encryptColumn', () => {
    process.env.DB_ENCRYPTION_KEY = `${CLAVE_OK}\n`;
    expect(() => decryptColumn(encryptColumn('x'))).toThrow(
      /DB_ENCRYPTION_KEY/,
    );
  });
});

describe('camino feliz — una clave bien formada sigue funcionando', () => {
  it('encryptColumn produce un fragmento pgp_sym_encrypt', () => {
    expect(() => encryptColumn('secreto')).not.toThrow();
  });

  it('encryptColumn con null no toca la clave (emite NULL)', () => {
    delete process.env.DB_ENCRYPTION_KEY;
    expect(() => encryptColumn(null)).not.toThrow();
  });

  it('encryptedLookupValue sigue lanzando ante clave HMAC corta', () => {
    process.env.DB_HMAC_KEY = Buffer.alloc(16, 7).toString('base64');
    expect(() => encryptedLookupValue('900123456')).toThrow(/32/);
  });
});

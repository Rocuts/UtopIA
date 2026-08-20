// ---------------------------------------------------------------------------
// ids.ts — UUIDv7 (RFC 9562) + IDs públicos estilo TypeID (prefijo + base32).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { ID_PREFIXES, newTypeId, parseTypeId, typeIdFrom, uuidv7 } from '../ids';

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produce UUID canónico con versión 7 y variante RFC', () => {
    for (let i = 0; i < 10; i++) {
      expect(uuidv7()).toMatch(UUID_V7_RE);
    }
  });

  it('ordena lexicográficamente ascendente con el tiempo', async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 3));
    const b = uuidv7();
    expect(a < b).toBe(true);
  });
});

describe('typeId', () => {
  it('roundtrip typeIdFrom → parseTypeId devuelve el mismo uuid', () => {
    const uuid = uuidv7();
    const id = typeIdFrom(ID_PREFIXES.trialBalance, uuid);
    expect(id.startsWith('tb_')).toBe(true);
    expect(parseTypeId(ID_PREFIXES.trialBalance, id)).toBe(uuid);
  });

  it('newTypeId entrega id público y uuid consistentes', () => {
    const { id, uuid } = newTypeId(ID_PREFIXES.webhookEndpoint);
    expect(id.startsWith('whe_')).toBe(true);
    expect(parseTypeId(ID_PREFIXES.webhookEndpoint, id)).toBe(uuid);
  });

  it('rechaza prefijo ajeno, longitud incorrecta y alfabeto inválido', () => {
    const uuid = uuidv7();
    const id = typeIdFrom('whe', uuid);
    expect(parseTypeId('tb', id)).toBeNull();
    expect(parseTypeId('tb', 'tb_' + '0'.repeat(25))).toBeNull();
    // 'u' está fuera del alfabeto crockford
    expect(parseTypeId('tb', 'tb_' + 'u'.repeat(26))).toBeNull();
    expect(parseTypeId('tb', 'no-es-un-id')).toBeNull();
  });
});

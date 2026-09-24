// auditoria-calidad-27 — tercero "nuevo": se compara sólo contra períodos
// ANTERIORES (no contra cualquier otro, que incluye los posteriores) y el
// umbral se mide sobre el movimiento de un solo lado (factura + pago de la
// misma compra no se suman).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const state = vi.hoisted(() => ({
  where: [] as unknown[],
  results: [] as unknown[][],
}));

vi.mock('@/lib/db/client', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: (cond: unknown) => {
        state.where.push(cond);
        return chain;
      },
      orderBy: async () => state.results.shift() ?? [],
      then: (resolve: (v: unknown[]) => void) => resolve(state.results.shift() ?? []),
    });
    return chain;
  };
  return { getDb: () => makeChain() };
});

import { getNewThirdPartiesForPeriod } from '../repository';

const dialect = new PgDialect();
const toSql = (c: unknown) => dialect.sqlToQuery(c as SQL).sql;

const TP = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  state.where.length = 0;
  state.results.length = 0;
});

describe('getNewThirdPartiesForPeriod', () => {
  it('factura de $3M y su pago de $3M son $3M de movimiento: no superan el umbral de $5M', async () => {
    state.results.push([
      { thirdPartyId: TP, entryId: 'fac', debit: '0.00', credit: '3000000.00' },
      { thirdPartyId: TP, entryId: 'pago', debit: '3000000.00', credit: '0.00' },
    ]);
    const res = await getNewThirdPartiesForPeriod('ws', 'p1', 5_000_000);
    expect(res).toEqual([]);
  });

  it('los períodos de comparación son los de inicio anterior al evaluado', async () => {
    state.results.push(
      [{ thirdPartyId: TP, entryId: 'fac', debit: '0.00', credit: '7000000.00' }],
      [], // sin apariciones anteriores
      [], // sin perfil tributario
    );
    const res = await getNewThirdPartiesForPeriod('ws', 'p1', 5_000_000);
    expect(res).toHaveLength(1);
    expect(res[0].totalAmountCents).toBe(BigInt(700_000_000));
    expect(res[0].hasVerifiedProfile).toBe(false);

    const previous = toSql(state.where[1]);
    expect(previous).toMatch(/"starts_at" < \(SELECT ap\.starts_at FROM accounting_periods ap WHERE ap\.id = \$\d+/);
    expect(previous).not.toMatch(/"period_id" != /);
  });
});

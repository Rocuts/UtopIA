// IW4 (contab-nomina-01) — Desde WP10 el original reversado y su reverso son
// ambos status='posted' (netean en el libro). Las pruebas forenses de montos
// (Benford, montos repetidos, sesgo a números redondos, terceros nuevos)
// contaban el par anulado dos veces: el mismo monto en débito y crédito
// "repetido", dígitos duplicados y terceros con un monto material que en
// realidad es cero. Esas lecturas deben ignorar los pares anulados; la de
// numeración NO (el reverso consume un número del consecutivo).
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const captured = vi.hoisted(() => ({ where: [] as unknown[] }));

vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: (cond: unknown) => {
      captured.where.push(cond);
      return chain;
    },
    orderBy: async () => [],
    then: (resolve: (v: unknown[]) => void) => resolve([]),
  });
  return { getDb: () => chain };
});

import {
  getJournalLinesForPeriod,
  getNewThirdPartiesForPeriod,
  getPostedEntriesForPeriod,
} from '../repository';

const dialect = new PgDialect();
const toSql = (c: unknown) => dialect.sqlToQuery(c as SQL).sql;

const EXCLUYE_PARES = /"reversed_by_entry_id" IS NULL.*"source_type" <> 'reversal'/s;

describe('forensic repository — pares reversados', () => {
  it('las líneas para Benford / montos repetidos / redondos excluyen original y reverso', async () => {
    captured.where.length = 0;
    await getJournalLinesForPeriod('ws', 'p1');
    expect(toSql(captured.where[0])).toMatch(EXCLUYE_PARES);
  });

  it('terceros nuevos: el monto del periodo no cuenta pares anulados', async () => {
    captured.where.length = 0;
    await getNewThirdPartiesForPeriod('ws', 'p1');
    expect(toSql(captured.where[0])).toMatch(EXCLUYE_PARES);
  });

  it('los asientos para huecos de numeración conservan el consecutivo completo', async () => {
    captured.where.length = 0;
    await getPostedEntriesForPeriod('ws', 'p1');
    expect(toSql(captured.where[0])).not.toMatch(/reversed_by_entry_id/);
  });
});

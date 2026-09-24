// IW4 (contab-nomina-01) — Desde WP10 un asiento reversado conserva
// status='posted' y sólo gana `reversed_by_entry_id` (original + reverso
// netean en el libro). getCachedJournalList seguía filtrando 'reversed' por
// `status = 'reversed'`, que ya no existe: el filtro "Reversados" quedaba
// vacío. Debe usar la misma condición que listEntries.
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const captured = vi.hoisted(() => ({ where: [] as unknown[] }));

vi.mock('@/lib/db/client', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (cond: unknown) => {
      captured.where.push(cond);
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    offset: async () => [],
  };
  return { getDb: () => chain };
});

import { getCachedJournalList } from '../accounting-cache';

function lastWhere(): { sql: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(captured.where[captured.where.length - 1] as SQL);
  return { sql: q.sql, params: q.params };
}

describe('getCachedJournalList — filtro de reversados', () => {
  it("'reversed' = posted con reversed_by_entry_id, no status 'reversed'", async () => {
    await getCachedJournalList('ws', { status: 'reversed' });
    const { sql, params } = lastWhere();
    expect(sql).toMatch(/"reversed_by_entry_id" IS NOT NULL/);
    expect(params).toContain('posted');
    expect(params).not.toContain('reversed');
  });

  it("'posted' y 'draft' siguen filtrando por status", async () => {
    await getCachedJournalList('ws', { status: 'draft' });
    expect(lastWhere().params).toContain('draft');
    expect(lastWhere().sql).not.toMatch(/reversed_by_entry_id/);
  });
});

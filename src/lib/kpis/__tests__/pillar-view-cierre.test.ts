// IW4 (contab-nomina-04) — Las 3 consultas SQL crudas de pillar-view sumaban
// el asiento de cierre (source_type 'closing'), que lleva a cero las clases
// 4/5/6 y mueve el resultado al patrimonio: el "resultado clase 4 − 5 − 6" de
// un periodo cerrado daba 0. Deben excluirlo (y a su reverso), igual que
// `pillar_kpis_view` redefinida en la migración 0022.
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { queryPillarKpisRaw } from '../pillar-view';

describe('pillar-view — sin asientos de cierre', () => {
  it('las consultas del libro mayor excluyen el cierre y su reverso', async () => {
    const queries: string[] = [];
    const dialect = new PgDialect();
    const db = {
      execute: async (q: SQL) => {
        queries.push(dialect.sqlToQuery(q).sql.replace(/\s+/g, ' '));
        return { rows: [] };
      },
    } as unknown as Parameters<typeof queryPillarKpisRaw>[0];

    await queryPillarKpisRaw(db, 'ws', 'p1');

    const ledger = queries.filter((q) => q.includes('journal_lines'));
    expect(ledger).toHaveLength(3);
    for (const q of ledger) {
      expect(q).toContain("je.source_type <> 'closing'");
      expect(q).toMatch(
        /NOT EXISTS \( ?SELECT 1 FROM journal_entries o WHERE o\.id = je\.reversal_of_entry_id AND o\.source_type = 'closing' ?\)/,
      );
    }
  });

  it('caja 1105/1110 incluye las subcuentas (misma regla que la vista)', async () => {
    const queries: string[] = [];
    const dialect = new PgDialect();
    const db = {
      execute: async (q: SQL) => {
        queries.push(dialect.sqlToQuery(q).sql.replace(/\s+/g, ' '));
        return { rows: [] };
      },
    } as unknown as Parameters<typeof queryPillarKpisRaw>[0];
    await queryPillarKpisRaw(db, 'ws', 'p1');
    const futuro = queries.find((q) => q.includes('caja_menos_21'))!;
    expect(futuro).toContain("coa.code LIKE '1105%'");
    expect(futuro).toContain("coa.code LIKE '1110%'");
    expect(futuro).not.toContain("IN ('1105', '1110')");
  });
});

// contab-nomina-04 (W3-C) — SQL de getLedgerTotalsByPeriods: separa las sumas
// de los asientos de cierre (source_type 'closing') y de los reversos de un
// cierre (reversal_of_entry_id → asiento de cierre), con el mismo criterio que
// pillar_kpis_view (migración 0022) y src/lib/kpis/pillar-view.ts.
import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';

vi.mock('server-only', () => ({}));

import * as schema from '@/lib/db/schema';
import { ledgerTotalsByPeriodsQuery } from '@/lib/cache/ledger-queries';

describe('getLedgerTotalsByPeriods — marca de cierre (contab-nomina-04)', () => {
  const db = drizzle.mock({ schema }) as unknown as Parameters<typeof ledgerTotalsByPeriodsQuery>[0];
  const { sql, params } = ledgerTotalsByPeriodsQuery(db, 'ws', ['p1', 'p2']).toSQL();
  const q = sql.replace(/\s+/g, ' ');

  it('marca asientos de cierre y reversos de cierre, y agrupa por esa marca', () => {
    const flag =
      `("journal_entries"."source_type" = 'closing' OR "closing_origin"."id" IS NOT NULL)`;
    // Misma expresión literal en SELECT y GROUP BY (sin parámetros).
    expect(q.split(flag)).toHaveLength(3);
    expect(q).toMatch(/group by "journal_entries"\."period_id", "journal_lines"\."account_id", \(/);
    expect(q).toContain(
      `left join "journal_entries" "closing_origin" on ("closing_origin"."id" = "journal_entries"."reversal_of_entry_id" and "closing_origin"."source_type" = $1)`,
    );
    expect(params[0]).toBe('closing');
  });

  it('conserva el filtro de workspace, periodos y estados', () => {
    expect(q).toContain(`"journal_entries"."workspace_id" = $2`);
    expect(q).toContain(`"journal_entries"."period_id" in ($3, $4)`);
    expect(q).toContain(`"journal_entries"."status" in ($5, $6)`);
    expect(params.slice(1)).toEqual(['ws', 'p1', 'p2', 'posted', 'reversed']);
  });
});

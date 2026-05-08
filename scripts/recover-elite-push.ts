// ---------------------------------------------------------------------------
// Recovery script — reaplica infraestructura DB borrada por drizzle-kit push
// el 2026-05-07 al sincronizar schema-sentinel.ts.
// ---------------------------------------------------------------------------
// drizzle-kit push borra cualquier objeto que esté en la DB pero NO en
// schema-*.ts. La sincronización de Sentinel borró:
//   - rag_chunks.tsv (columna GENERATED) y sus 4 índices (creados por
//     src/lib/rag/init.ts vía DDL idempotente, no por drizzle-kit)
//   - pillar_kpis_view (creada por 0009_pillar_view.sql)
//   - 4 índices pyme_* (creados por 0003_pyme_tables.sql)
//
// Este script reaplica todo de forma idempotente:
//   - rag_chunks.tsv es GENERATED ALWAYS AS, así que recrearla regenera
//     automáticamente los 34604 valores desde `content`. SIN PÉRDIDA REAL.
//   - Los índices y la view son CREATE ... IF NOT EXISTS / OR REPLACE,
//     así que el script puede correrse N veces sin daño.
//
// Uso:
//   npm run db:recover-elite
//
// Driver: pg.Pool con .env.local.
// ---------------------------------------------------------------------------

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

interface Step {
  name: string;
  ddl: string;
}

const STEPS: Step[] = [
  // ─── rag_chunks.tsv (GENERATED column + 4 índices) ────────────────────────
  {
    name: 'rag_chunks.tsv (GENERATED column)',
    ddl: `
      ALTER TABLE rag_chunks
      ADD COLUMN IF NOT EXISTS tsv tsvector
      GENERATED ALWAYS AS (
        to_tsvector('spanish', coalesce(contextual_prefix, '') || ' ' || content)
      ) STORED
    `,
  },
  {
    name: 'rag_chunks_tsv_idx (GIN tsvector)',
    ddl: `CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx ON rag_chunks USING GIN (tsv)`,
  },
  {
    name: 'rag_chunks_hnsw_idx (HNSW vector cosine)',
    ddl: `CREATE INDEX IF NOT EXISTS rag_chunks_hnsw_idx ON rag_chunks USING hnsw (embedding vector_cosine_ops)`,
  },
  {
    name: 'rag_chunks_ws_idx',
    ddl: `CREATE INDEX IF NOT EXISTS rag_chunks_ws_idx ON rag_chunks (workspace_id)`,
  },
  {
    name: 'rag_chunks_source_idx',
    ddl: `CREATE INDEX IF NOT EXISTS rag_chunks_source_idx ON rag_chunks (source)`,
  },

  // ─── pyme_* índices ───────────────────────────────────────────────────────
  {
    name: 'pyme_books_workspace_created_idx',
    ddl: `CREATE INDEX IF NOT EXISTS pyme_books_workspace_created_idx ON pyme_books (workspace_id, created_at DESC)`,
  },
  {
    name: 'pyme_uploads_book_created_idx',
    ddl: `CREATE INDEX IF NOT EXISTS pyme_uploads_book_created_idx ON pyme_uploads (book_id, created_at)`,
  },
  {
    name: 'pyme_entries_book_date_idx',
    ddl: `CREATE INDEX IF NOT EXISTS pyme_entries_book_date_idx ON pyme_entries (book_id, entry_date)`,
  },
  {
    name: 'pyme_entries_book_status_kind_date_idx',
    ddl: `CREATE INDEX IF NOT EXISTS pyme_entries_book_status_kind_date_idx ON pyme_entries (book_id, status, kind, entry_date)`,
  },

  // ─── pillar_kpis_view ─────────────────────────────────────────────────────
  {
    name: 'pillar_kpis_view (CREATE OR REPLACE)',
    ddl: `
      CREATE OR REPLACE VIEW "pillar_kpis_view" AS
      SELECT
        je.workspace_id,
        je.period_id,
        COUNT(DISTINCT je.id)::integer AS posted_entries_count,
        COALESCE(
          SUM(
            CASE WHEN coa.code LIKE '24%' THEN jl.credit - jl.debit ELSE 0 END
          ),
          0
        )::numeric(20, 2) AS resiliencia_total_provision_taxes_cop,
        (
          COALESCE(
            SUM(
              CASE WHEN coa.code LIKE '4%' THEN jl.credit - jl.debit ELSE 0 END
            ),
            0
          )
          - COALESCE(
            SUM(
              CASE WHEN coa.code LIKE '5%' OR coa.code LIKE '6%' OR coa.code LIKE '7%'
                   THEN jl.debit - jl.credit ELSE 0 END
            ),
            0
          )
        )::numeric(20, 2) AS valor_ebitda_cop,
        (
          COALESCE(
            SUM(
              CASE WHEN coa.code LIKE '1105%' OR coa.code LIKE '1110%'
                   THEN jl.debit - jl.credit ELSE 0 END
            ),
            0
          )
          - COALESCE(
            SUM(
              CASE WHEN coa.code LIKE '21%' THEN jl.credit - jl.debit ELSE 0 END
            ),
            0
          )
        )::numeric(20, 2) AS futuro_free_cash_flow_cop
      FROM journal_entries je
      INNER JOIN journal_lines jl ON jl.entry_id = je.id
      INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.status = 'posted'
      GROUP BY je.workspace_id, je.period_id
    `,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is not set. Run `vercel env pull .env.local --yes`.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  console.log(`\n▶  Recovery — reaplicando ${STEPS.length} DDLs idempotentes\n`);

  let okCount = 0;
  let errCount = 0;

  try {
    for (const step of STEPS) {
      try {
        process.stdout.write(`   [...] ${step.name}`);
        await db.execute(sql.raw(step.ddl));
        process.stdout.write(`\r   [✓ ] ${step.name}\n`);
        okCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(`\r   [✗ ] ${step.name}\n          → ${msg}\n`);
        errCount += 1;
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`\n   ${okCount} aplicados · ${errCount} fallidos\n`);
  if (errCount > 0) process.exit(1);

  console.log('   ✅ Recovery completo. Sentinel + RAG + pillar_kpis_view + pyme indexes restaurados.');
}

main().catch((err) => {
  console.error('\n❌ Recovery falló:', err);
  process.exit(1);
});

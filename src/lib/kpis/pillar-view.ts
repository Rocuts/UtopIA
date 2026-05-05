import 'server-only';
import { sql } from 'drizzle-orm';
import type { getDb } from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Pillar KPI view — raw SQL queries for the 4 UtopIA pillars.
//
// MVP approximations (D3 — can be refined in WS6.1+):
//   Resiliencia: SUM(credit - debit) on accounts starting with '24' (taxes
//                payable in PUC Colombia). Positive = liability balance.
//   Valor:       SUM(class-4 income) - SUM(class-5/6 costs+expenses) for the
//                given period. EBITDA-ish, pre-depreciation.
//   Verdad:      % of pyme_entries with status='confirmed' vs total (all
//                periods, MVP simplification — gives a data-quality signal).
//   Futuro:      Cash (1105+1110 accounts) - Accounts Payable (21xxxx) for
//                the period. Simple free-cash-flow proxy.
//
// All queries are defensive: if accounts, period, or workspace don't exist,
// returns '0' (string) or 0 (number) without throwing.
// ---------------------------------------------------------------------------

export interface PillarKpis {
  resiliencia: { totalProvisionTaxesCop: string };
  valor: { ebitdaCop: string };
  verdad: { documentsVerifiedPct: number };
  futuro: { freeCashFlowProjectedCop: string };
}

type DbInstance = ReturnType<typeof getDb>;

// Helper: extract a numeric string from a raw sql result row.
function rowToString(
  result: unknown,
  key: string,
  fallback = '0',
): string {
  if (!result || typeof result !== 'object') return fallback;
  // drizzle-orm/node-postgres wraps execute results as { rows: [...] }
  const rows = (result as { rows?: unknown[] }).rows ?? (Array.isArray(result) ? result : []);
  const first = rows[0];
  if (!first || typeof first !== 'object') return fallback;
  const val = (first as Record<string, unknown>)[key];
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'string' ? parseFloat(val) : Number(val);
  return Number.isFinite(n) ? String(Math.round(n)) : fallback;
}

function rowToNumber(result: unknown, key: string, fallback = 0): number {
  const s = rowToString(result, key, String(fallback));
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

// ── Resiliencia ──────────────────────────────────────────────────────────────
// SUM of (credit - debit) on journal lines for accounts starting with '24'
// (Impuestos, gravámenes y tasas por pagar — Colombian PUC class 24).
// A positive number means the company has outstanding tax provisions.
async function queryResiliencia(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS total_provision
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${workspaceId}
        AND je.period_id = ${periodId}
        AND je.status = 'posted'
        AND coa.code LIKE '24%'
    `);
    return rowToString(result, 'total_provision');
  } catch {
    return '0';
  }
}

// ── Valor ────────────────────────────────────────────────────────────────────
// EBITDA proxy: SUM of income accounts (class 4) minus SUM of cost/expense
// accounts (class 5 + class 6) for the period.
// Colombian PUC: 4=Ingresos, 5=Gastos, 6=Costos de ventas.
// Income accounts carry credit balances; cost/expense carry debit balances.
async function queryValor(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(
          CASE WHEN coa.code ~ '^4' THEN jl.credit - jl.debit ELSE 0 END
        ), 0)
        -
        COALESCE(SUM(
          CASE WHEN coa.code ~ '^[56]' THEN jl.debit - jl.credit ELSE 0 END
        ), 0) AS ebitda
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${workspaceId}
        AND je.period_id = ${periodId}
        AND je.status = 'posted'
        AND coa.code ~ '^[456]'
    `);
    return rowToString(result, 'ebitda');
  } catch {
    return '0';
  }
}

// ── Verdad ───────────────────────────────────────────────────────────────────
// % of pyme_entries confirmed vs total (across all periods for the workspace).
// MVP simplification: we don't filter by periodId since pyme_entries don't have
// a direct period_id FK — they belong to a book and use entry_date.
async function queryVerdad(
  db: DbInstance,
  workspaceId: string,
): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE pe.status = 'confirmed') AS confirmed_count,
        COUNT(*) AS total_count
      FROM pyme_entries pe
      JOIN pyme_books pb ON pb.id = pe.book_id
      WHERE pb.workspace_id = ${workspaceId}
    `);
    const rows = (result as { rows?: unknown[] }).rows ?? (Array.isArray(result) ? result : []);
    const first = rows[0] as Record<string, unknown> | undefined;
    if (!first) return 0;
    const confirmed = Number(first['confirmed_count'] ?? 0);
    const total = Number(first['total_count'] ?? 0);
    if (!Number.isFinite(confirmed) || !Number.isFinite(total) || total === 0) return 0;
    return Math.round((confirmed / total) * 100);
  } catch {
    return 0;
  }
}

// ── Futuro ───────────────────────────────────────────────────────────────────
// Free cash flow proxy: Cash (1105 Caja + 1110 Bancos) minus Accounts Payable
// (21xxxx — Obligaciones financieras and CxP) for the period.
// Positive = net cash surplus over short-term payables.
async function queryFuturo(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(
          CASE WHEN coa.code IN ('1105', '1110') THEN jl.debit - jl.credit ELSE 0 END
        ), 0)
        -
        COALESCE(SUM(
          CASE WHEN coa.code LIKE '21%' THEN jl.credit - jl.debit ELSE 0 END
        ), 0) AS free_cash_flow
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${workspaceId}
        AND je.period_id = ${periodId}
        AND je.status = 'posted'
        AND (
          coa.code IN ('1105', '1110')
          OR coa.code LIKE '21%'
        )
    `);
    return rowToString(result, 'free_cash_flow');
  } catch {
    return '0';
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function queryPillarKpisRaw(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<PillarKpis> {
  // Run 4 queries in parallel — they are independent reads.
  const [totalProvisionTaxesCop, ebitdaCop, documentsVerifiedPct, freeCashFlowProjectedCop] =
    await Promise.all([
      queryResiliencia(db, workspaceId, periodId),
      queryValor(db, workspaceId, periodId),
      queryVerdad(db, workspaceId),
      queryFuturo(db, workspaceId, periodId),
    ]);

  return {
    resiliencia: { totalProvisionTaxesCop },
    valor: { ebitdaCop },
    verdad: { documentsVerifiedPct },
    futuro: { freeCashFlowProjectedCop },
  };
}

import 'server-only';
import { sql } from 'drizzle-orm';
import type { getDb } from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Pillar KPI view — raw SQL queries for the 4 UtopIA pillars.
//
// Señales crudas del libro mayor (NO son KPIs financieros presentables):
//   Resiliencia: movimiento neto del periodo en el grupo 24 (incluye IVA, ICA
//                y retenciones — NO es "provisión de renta").
//   Valor:       resultado clase 4 − clases 5 y 6 del periodo. Es un resultado
//                neto, NO un EBITDA (ratios-kpis-05: el EBITDA canónico vive en
//                `src/lib/pillars/ebitda.ts`).
//   Verdad:      % de pyme_entries confirmados sobre el total del workspace.
//   Futuro:      movimiento de 1105/1110 menos el de 21xx. NO es flujo de caja
//                libre.
//
// Ausencia de datos o error ⇒ `null` (N/D), nunca '0'.
// ---------------------------------------------------------------------------

export interface PillarKpis {
  resiliencia: { movimientoGrupo24Cop: string | null };
  valor: { resultadoClase4Menos5y6Cop: string | null };
  /** `null` cuando no hay asientos pyme (0 de 0 no es 0 %). */
  verdad: { documentsVerifiedPct: number | null };
  futuro: { cajaMenosObligaciones21Cop: string | null };
}

type DbInstance = ReturnType<typeof getDb>;

// Helper: extract a numeric string from a raw sql result row.
function rowToString(
  result: unknown,
  key: string,
  fallback: string | null = null,
): string | null {
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

// ── Resiliencia ──────────────────────────────────────────────────────────────
// SUM of (credit - debit) on journal lines for accounts starting with '24'
// (Impuestos, gravámenes y tasas por pagar — Colombian PUC class 24).
// A positive number means the company has outstanding tax provisions.
async function queryResiliencia(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<string | null> {
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
    return null;
  }
}

// ── Valor ────────────────────────────────────────────────────────────────────
// Resultado neto (NO EBITDA): SUM of income accounts (class 4) minus SUM of cost/expense
// accounts (class 5 + class 6) for the period.
// Colombian PUC: 4=Ingresos, 5=Gastos, 6=Costos de ventas.
// Income accounts carry credit balances; cost/expense carry debit balances.
async function queryValor(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(
          CASE WHEN coa.code ~ '^4' THEN jl.credit - jl.debit ELSE 0 END
        ), 0)
        -
        COALESCE(SUM(
          CASE WHEN coa.code ~ '^[56]' THEN jl.debit - jl.credit ELSE 0 END
        ), 0) AS resultado
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${workspaceId}
        AND je.period_id = ${periodId}
        AND je.status = 'posted'
        AND coa.code ~ '^[456]'
    `);
    return rowToString(result, 'resultado');
  } catch {
    return null;
  }
}

// ── Verdad ───────────────────────────────────────────────────────────────────
// % of pyme_entries confirmed vs total (across all periods for the workspace).
// MVP simplification: we don't filter by periodId since pyme_entries don't have
// a direct period_id FK — they belong to a book and use entry_date.
export async function queryDocumentsVerifiedPct(
  db: DbInstance,
  workspaceId: string,
): Promise<number | null> {
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
    if (!first) return null;
    const confirmed = Number(first['confirmed_count'] ?? 0);
    const total = Number(first['total_count'] ?? 0);
    if (!Number.isFinite(confirmed) || !Number.isFinite(total) || total === 0) return null;
    return Math.round((confirmed / total) * 100);
  } catch {
    return null;
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
): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(
          CASE WHEN coa.code IN ('1105', '1110') THEN jl.debit - jl.credit ELSE 0 END
        ), 0)
        -
        COALESCE(SUM(
          CASE WHEN coa.code LIKE '21%' THEN jl.credit - jl.debit ELSE 0 END
        ), 0) AS caja_menos_21
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
    return rowToString(result, 'caja_menos_21');
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function queryPillarKpisRaw(
  db: DbInstance,
  workspaceId: string,
  periodId: string,
): Promise<PillarKpis> {
  // Run 4 queries in parallel — they are independent reads.
  const [movimientoGrupo24Cop, resultadoClase4Menos5y6Cop, documentsVerifiedPct, cajaMenosObligaciones21Cop] =
    await Promise.all([
      queryResiliencia(db, workspaceId, periodId),
      queryValor(db, workspaceId, periodId),
      queryDocumentsVerifiedPct(db, workspaceId),
      queryFuturo(db, workspaceId, periodId),
    ]);

  return {
    resiliencia: { movimientoGrupo24Cop },
    valor: { resultadoClase4Menos5y6Cop },
    verdad: { documentsVerifiedPct },
    futuro: { cajaMenosObligaciones21Cop },
  };
}

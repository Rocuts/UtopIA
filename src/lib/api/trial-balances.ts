// ---------------------------------------------------------------------------
// Servicio trial-balances del API v1.
//
// Reusa el MISMO motor determinista de la plataforma (parseTrialBalanceCSV +
// preprocessTrialBalance con curator NIIF R1–R4): cero superficie de
// alucinación. Filosofía anti-desync del repo: se persiste la remisión CRUDA
// (cifrada con el vault — Ley 1581) + un summary pequeño sin PII; el detalle
// se RECOMPUTA al leer (determinista ⇒ idéntico, 200–500 ms).
// NO escribe en journal_lines: las remisiones son documentos externos.
// ---------------------------------------------------------------------------

import { and, desc, eq, lt, or } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { apiTrialBalances } from '@/lib/db/schema';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
  type RawAccountRow,
} from '@/lib/preprocessing/trial-balance';
import { decryptSecret, encryptSecret } from '@/lib/security/vault';

import { newTypeId, parseTypeId, typeIdFrom, ID_PREFIXES } from './ids';
import { encodeCursor, type CursorPosition } from './pagination';
import type { ProblemValidationError } from './problems';
import { zodIssuesToErrors } from './problems';
import { TrialBalanceCreateSchema, type RawRowInput } from './schemas';

/**
 * Versión del contrato de preprocesamiento que viaja en cada respuesta.
 * Subirla cuando cambie el preprocesador de forma observable por el cliente.
 */
export const PREPROCESSOR_CONTRACT_VERSION = 'tb-2026-08-19';

export interface Money {
  amount: string;
  currency: 'COP';
}

export function centsToMoney(cents: bigint): Money {
  return { amount: cents.toString(), currency: 'COP' };
}

const CENTS_PER_PESO = 100;

/** Fallback para snapshots legacy sin ancla cents: pesos number → centavos. */
function pesosToCents(pesos: number): bigint {
  return BigInt(Math.round(pesos * CENTS_PER_PESO));
}

// ---------------------------------------------------------------------------
// Entrada → RawAccountRow[]
// ---------------------------------------------------------------------------

export type BuildRowsResult =
  | { ok: true; rows: RawAccountRow[]; source: 'csv' | 'rows' }
  | { ok: false; code: 'empty_trial_balance' };

export function buildRawRowsFromInput(input: {
  csv?: string;
  rows?: RawRowInput[];
  period_label?: string;
}): BuildRowsResult {
  if (input.csv) {
    const parsed = parseTrialBalanceCSV(input.csv, {
      currentYear: input.period_label,
    });
    if (parsed.length === 0) return { ok: false, code: 'empty_trial_balance' };
    return { ok: true, rows: parsed, source: 'csv' };
  }

  const rows = (input.rows ?? []).map(
    (r): RawAccountRow => ({
      code: r.code.replace(/[.\-\s]/g, ''),
      name: r.name,
      level: r.level,
      transactional: r.transactional,
      balancesByPeriod: r.balances_by_period,
    }),
  );
  if (rows.length === 0) return { ok: false, code: 'empty_trial_balance' };
  return { ok: true, rows, source: 'rows' };
}

// ---------------------------------------------------------------------------
// Summary (persistido, sin PII) + serialización pública
// ---------------------------------------------------------------------------

export interface TrialBalanceSummary {
  status: 'balanced' | 'unbalanced';
  period_label: string;
  row_count: number;
  control_totals: {
    activo: Money;
    pasivo: Money;
    patrimonio: Money;
    ingresos_netos: Money;
    equation_delta: Money;
  };
  findings: { discrepancies: number; curator: number };
}

export function summarize(pre: PreprocessedBalance): TrialBalanceSummary {
  const primary = pre.primary;
  const cents = primary.controlTotals.cents;

  const activo = cents?.activo ?? pesosToCents(primary.controlTotals.activo);
  const pasivo = cents?.pasivo ?? pesosToCents(primary.controlTotals.pasivo);
  const patrimonio =
    cents?.patrimonio ?? pesosToCents(primary.controlTotals.patrimonio);
  const ingresosNetos =
    cents?.ingresosNetos ?? pesosToCents(primary.controlTotals.ingresos);
  const delta = activo - pasivo - patrimonio;

  // Nota: preprocessTrialBalance inyecta los findings del curator también en
  // `discrepancies` — el conteo de discrepancies ya los incluye; `curator`
  // reporta cuántos de ellos vienen del curator NIIF.
  return {
    status: delta === BigInt(0) ? 'balanced' : 'unbalanced',
    period_label: primary.period,
    row_count: pre.rawRows.length,
    control_totals: {
      activo: centsToMoney(activo),
      pasivo: centsToMoney(pasivo),
      patrimonio: centsToMoney(patrimonio),
      ingresos_netos: centsToMoney(ingresosNetos),
      equation_delta: centsToMoney(delta),
    },
    findings: {
      discrepancies: primary.discrepancies.length,
      curator: primary.curator?.findings.length ?? 0,
    },
  };
}

export function serializeTrialBalance(
  publicId: string,
  row: {
    createdAt: Date;
    summary: TrialBalanceSummary;
    preprocessorVersion: string;
  },
): Record<string, unknown> {
  return {
    id: publicId,
    object: 'trial_balance',
    status: row.summary.status,
    period_label: row.summary.period_label,
    row_count: row.summary.row_count,
    control_totals: row.summary.control_totals,
    findings: row.summary.findings,
    preprocessor_version: row.preprocessorVersion,
    created_at: row.createdAt.toISOString(),
  };
}

/** Detalle: base + discrepancias y findings del curator (allowlist, sin filas). */
export function serializeTrialBalanceDetail(
  base: Record<string, unknown>,
  pre: PreprocessedBalance,
): Record<string, unknown> {
  const primary = pre.primary;
  return {
    ...base,
    discrepancies: primary.discrepancies.map((d) => ({
      location: d.location,
      reported: d.reported,
      calculated: d.calculated,
      difference: d.difference,
      description: d.description,
    })),
    curator_findings: (primary.curator?.findings ?? []).map((f) => ({
      code: f.code,
      severity: f.severity,
      title: f.title,
      description: f.description,
      norm_reference: f.normReference,
      recommendation: f.recommendation,
    })),
  };
}

// ---------------------------------------------------------------------------
// Operaciones con DB (thin — la lógica pura vive arriba)
// ---------------------------------------------------------------------------

type DbClient = ReturnType<typeof getDb>;

export type CreateTrialBalanceResult =
  | { status: 201; body: Record<string, unknown>; publicId: string }
  | {
      status: 400 | 422;
      problem: 'validation_failed' | 'empty_trial_balance';
      errors?: ProblemValidationError[];
    };

export async function createTrialBalance(
  db: DbClient,
  input: { workspaceId: string; body: unknown; idempotencyKey: string | null },
): Promise<CreateTrialBalanceResult> {
  const parsed = TrialBalanceCreateSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      status: 400,
      problem: 'validation_failed',
      errors: zodIssuesToErrors(parsed.error),
    };
  }

  const built = buildRawRowsFromInput(parsed.data);
  if (!built.ok) {
    return { status: 422, problem: 'empty_trial_balance' };
  }

  const pre = preprocessTrialBalance(built.rows, {
    defaultPeriod: parsed.data.period_label,
  });
  const summary = summarize(pre);

  const { id: publicId, uuid } = newTypeId(ID_PREFIXES.trialBalance);
  await db.insert(apiTrialBalances).values({
    id: uuid,
    workspaceId: input.workspaceId,
    source: built.source,
    periodLabel: summary.period_label,
    rawRowsEncrypted: encryptSecret(JSON.stringify(built.rows)),
    rowCount: summary.row_count,
    status: summary.status,
    summary: summary as unknown as Record<string, unknown>,
    preprocessorVersion: PREPROCESSOR_CONTRACT_VERSION,
    idempotencyKey: input.idempotencyKey,
  });

  const body = serializeTrialBalance(publicId, {
    createdAt: new Date(),
    summary,
    preprocessorVersion: PREPROCESSOR_CONTRACT_VERSION,
  });

  // Import perezoso: el emitter arrastra el runtime de Workflow DevKit y DB;
  // mantenerlo fuera del grafo de imports de los tests de las partes puras.
  const { emitWebhookEvent } = await import('./webhook-emitter');
  await emitWebhookEvent(input.workspaceId, 'trial_balance.processed', body);

  return { status: 201, body, publicId };
}

export async function getTrialBalanceDetail(
  db: DbClient,
  workspaceId: string,
  publicId: string,
): Promise<Record<string, unknown> | null> {
  const uuid = parseTypeId(ID_PREFIXES.trialBalance, publicId);
  if (!uuid) return null;

  const rows = await db
    .select()
    .from(apiTrialBalances)
    .where(
      and(eq(apiTrialBalances.id, uuid), eq(apiTrialBalances.workspaceId, workspaceId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Recompute-on-read: cero desync con el preprocesador vigente.
  const rawRows = JSON.parse(decryptSecret(row.rawRowsEncrypted)) as RawAccountRow[];
  const pre = preprocessTrialBalance(rawRows, { defaultPeriod: row.periodLabel });
  const summary = summarize(pre);

  const base = serializeTrialBalance(publicId, {
    createdAt: row.createdAt,
    summary,
    preprocessorVersion: PREPROCESSOR_CONTRACT_VERSION,
  });
  return serializeTrialBalanceDetail(base, pre);
}

export async function listTrialBalances(
  db: DbClient,
  workspaceId: string,
  page: { limit: number; cursor: CursorPosition | null },
): Promise<{ data: Record<string, unknown>[]; has_more: boolean; next_cursor: string | null }> {
  const where = page.cursor
    ? and(
        eq(apiTrialBalances.workspaceId, workspaceId),
        or(
          lt(apiTrialBalances.createdAt, page.cursor.createdAt),
          and(
            eq(apiTrialBalances.createdAt, page.cursor.createdAt),
            lt(apiTrialBalances.id, page.cursor.id),
          ),
        ),
      )
    : eq(apiTrialBalances.workspaceId, workspaceId);

  const rows = await db
    .select({
      id: apiTrialBalances.id,
      summary: apiTrialBalances.summary,
      preprocessorVersion: apiTrialBalances.preprocessorVersion,
      createdAt: apiTrialBalances.createdAt,
    })
    .from(apiTrialBalances)
    .where(where)
    .orderBy(desc(apiTrialBalances.createdAt), desc(apiTrialBalances.id))
    .limit(page.limit + 1);

  const hasMore = rows.length > page.limit;
  const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    data: pageRows.map((r) =>
      serializeTrialBalance(typeIdFrom(ID_PREFIXES.trialBalance, r.id), {
        createdAt: r.createdAt,
        summary: r.summary as unknown as TrialBalanceSummary,
        preprocessorVersion: r.preprocessorVersion,
      }),
    ),
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** Borrado físico (Ley 1581 — derecho de supresión del Responsable). */
export async function deleteTrialBalance(
  db: DbClient,
  workspaceId: string,
  publicId: string,
): Promise<boolean> {
  const uuid = parseTypeId(ID_PREFIXES.trialBalance, publicId);
  if (!uuid) return false;
  const deleted = await db
    .delete(apiTrialBalances)
    .where(
      and(eq(apiTrialBalances.id, uuid), eq(apiTrialBalances.workspaceId, workspaceId)),
    )
    .returning({ id: apiTrialBalances.id });
  return deleted.length > 0;
}

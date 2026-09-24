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
import { normalizeSignConvention, type SignConvention } from '@/lib/preprocessing/sign-convention';
import {
  parseTrialBalanceCSVWithMeta,
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
 *
 * tb-2026-09-24: status/equation_delta reflejan la cuadratura del archivo de
 * origen (antes del Cierre Virtual R8); `rows` pasa por la misma normalización
 * de signos que `csv`; saldo inicial ≠ saldo del periodo; importes con más de
 * dos decimales ya no se leen como miles; hojas estructurales.
 */
export const PREPROCESSOR_CONTRACT_VERSION = 'tb-2026-09-24';

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
  | {
      ok: true;
      /** Filas ya normalizadas a la convención natural de signos. */
      rows: RawAccountRow[];
      source: 'csv' | 'rows';
      /** Convención de signos detectada en la entrada (antes de normalizar). */
      signConvention: SignConvention;
      /**
       * ingesta-09: periodos leídos SÓLO de columnas de saldo inicial/anterior
       * del CSV (`balanceColumns` con `kind === 'opening'`). `rows` no trae
       * metadatos de columna: lista vacía.
       */
      openingPeriods: string[];
    }
  | { ok: false; code: 'empty_trial_balance' };

/**
 * `csv` y `rows` pasan por la MISMA normalización determinista de signos
 * (`normalizeSignConvention`, ingesta-10): la misma data por cualquiera de las
 * dos entradas da los mismos totales. Antes sólo el CSV se normalizaba y unas
 * filas en convención algebraica llegaban con pasivo negativo que R8 tapaba.
 */
export function buildRawRowsFromInput(input: {
  csv?: string;
  rows?: RawRowInput[];
  period_label?: string;
}): BuildRowsResult {
  if (input.csv) {
    const parsed = parseTrialBalanceCSVWithMeta(input.csv, {
      currentYear: input.period_label,
    });
    if (parsed.rows.length === 0) return { ok: false, code: 'empty_trial_balance' };
    const closing = new Set(
      parsed.balanceColumns.filter((c) => c.kind !== 'opening').map((c) => c.period),
    );
    const openingPeriods = [
      ...new Set(
        parsed.balanceColumns
          .filter((c) => c.kind === 'opening' && !closing.has(c.period))
          .map((c) => c.period),
      ),
    ].sort();
    return {
      ok: true,
      rows: parsed.rows,
      source: 'csv',
      signConvention: parsed.signConvention?.convention ?? 'natural',
      openingPeriods,
    };
  }

  const mapped = (input.rows ?? []).map(
    (r): RawAccountRow => ({
      code: r.code.replace(/[.\-\s]/g, ''),
      name: r.name,
      level: r.level,
      transactional: r.transactional,
      balancesByPeriod: r.balances_by_period,
    }),
  );
  if (mapped.length === 0) return { ok: false, code: 'empty_trial_balance' };
  const normalized = normalizeSignConvention(mapped);
  return {
    ok: true,
    rows: normalized.rows,
    source: 'rows',
    signConvention: normalized.detection.convention,
    openingPeriods: [],
  };
}

/**
 * Preprocesado de una remisión recién construida: el periodo por defecto del
 * cliente y, del CSV, los periodos de apertura (ingesta-09) para que el
 * comparativo leído de la columna de saldo inicial se marque
 * `saldosDeApertura` (sus KPIs de resultados salen N/D). El recompute del
 * detalle (`getTrialBalanceDetail`) parte de las filas persistidas, que no
 * guardan metadatos de columna; el contrato público sólo expone el periodo
 * primario, al que la marca no afecta.
 */
export function preprocessBuiltRows(
  built: Extract<BuildRowsResult, { ok: true }>,
  periodLabel: string | undefined,
): PreprocessedBalance {
  return preprocessTrialBalance(built.rows, {
    defaultPeriod: periodLabel,
    openingPeriods: built.openingPeriods,
  });
}

// ---------------------------------------------------------------------------
// Summary (persistido, sin PII) + serialización pública
// ---------------------------------------------------------------------------

export interface TrialBalanceSummary {
  status: 'balanced' | 'unbalanced';
  period_label: string;
  row_count: number;
  /**
   * Convención de signos detectada en la entrada (`rows` y `csv` se normalizan
   * igual). `null` si no se conoce. Los campos añadidos en tb-2026-09-24 no
   * existen en los summaries persistidos antes de esa versión (el listado los
   * devuelve tal como se guardaron; el detalle los recalcula).
   */
  sign_convention: SignConvention | null;
  control_totals: {
    activo: Money;
    pasivo: Money;
    patrimonio: Money;
    ingresos_netos: Money;
    /**
     * Descuadre del ARCHIVO DE ORIGEN que no explica el traslado del resultado
     * del ejercicio (3605VC) ni la reclasificación de un grupo 36 anterior
     * (3710VC). Desde la auditoría 2026-09 el curador no lo absorbe: ≠ 0 ⇒
     * `status: 'unbalanced'`.
     */
    equation_delta: Money;
    /**
     * Histórico: monto que el Cierre Virtual (R8) absorbía en 3710VC. Desde la
     * auditoría 2026-09 R8 no absorbe residuales y vale 0; se conserva por
     * compatibilidad del contrato (el residual está en `equation_delta`).
     */
    virtual_close_adjustment: Money;
    /** Resultado de un ejercicio anterior (grupo 36) reclasificado a 3710VC; no es descuadre. */
    reclassified_from_3605: Money;
    /** Histórico: brecha que R5 absorbía al anclar el patrimonio al ECP (hoy 0). */
    equity_anchor_adjustment: Money;
  };
  findings: { discrepancies: number; curator: number };
}

/** String canónica de centavos exactos (`-?\d+\.\d{2}`) → centavos. */
function canonicalToCents(raw: string): bigint | null {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(raw);
  if (!m) return null;
  const cents = BigInt(m[2]) * BigInt(CENTS_PER_PESO) + BigInt(m[3]);
  return m[1] === '-' ? -cents : cents;
}

/**
 * Descuadre del archivo de origen en centavos (niif-preproceso-07).
 *
 * R8 (Cierre Virtual) traslada el resultado de las clases 4-7 a 3605VC y, si
 * el grupo 36 traía un resultado anterior, lo reclasifica a 3710VC; ninguna de
 * las dos cosas es descuadre. Desde la auditoría 2026-09 (niif-preproceso-06)
 * R8 NO absorbe el residual `A − P − K` que queda después: lo publica exacto
 * en `unexplainedResidualRaw` (y en pesos en `residualGapBeforeCents`, que ya
 * excluye la reclasificación). Ese residual es la cuadratura real del archivo.
 * Sin P&G R8 no actúa y `summary.equationBalance` conserva la ecuación del
 * archivo (R5 ya no muta el patrimonio).
 */
function sourceEquationDeltaCents(pre: PreprocessedBalance): bigint {
  const primary = pre.primary;
  const vca = primary.virtualCloseAdjustment;
  if (vca) {
    const exact =
      typeof vca.unexplainedResidualRaw === 'string'
        ? canonicalToCents(vca.unexplainedResidualRaw)
        : null;
    return exact ?? pesosToCents(vca.residualGapBeforeCents);
  }
  return pesosToCents(primary.summary.equationBalance);
}

export function summarize(
  pre: PreprocessedBalance,
  meta: { signConvention?: SignConvention | null } = {},
): TrialBalanceSummary {
  const primary = pre.primary;
  const cents = primary.controlTotals.cents;

  const activo = cents?.activo ?? pesosToCents(primary.controlTotals.activo);
  const pasivo = cents?.pasivo ?? pesosToCents(primary.controlTotals.pasivo);
  const patrimonio =
    cents?.patrimonio ?? pesosToCents(primary.controlTotals.patrimonio);
  const ingresosNetos =
    cents?.ingresosNetos ?? pesosToCents(primary.controlTotals.ingresos);
  const delta = sourceEquationDeltaCents(pre);
  const vca = primary.virtualCloseAdjustment;

  // Un importe ilegible, una columna ambigua o un código que no es cuenta PUC
  // impiden certificar la cuadratura aunque la ecuación calculada dé 0.
  const hasIntegrityIssues = (primary.validation.integrityReasons?.length ?? 0) > 0;

  // Nota: preprocessTrialBalance inyecta los findings del curator también en
  // `discrepancies` — el conteo de discrepancies ya los incluye; `curator`
  // reporta cuántos de ellos vienen del curator NIIF.
  return {
    status: delta === BigInt(0) && !hasIntegrityIssues ? 'balanced' : 'unbalanced',
    period_label: primary.period,
    row_count: pre.rawRows.length,
    sign_convention: meta.signConvention ?? null,
    control_totals: {
      activo: centsToMoney(activo),
      pasivo: centsToMoney(pasivo),
      patrimonio: centsToMoney(patrimonio),
      ingresos_netos: centsToMoney(ingresosNetos),
      equation_delta: centsToMoney(delta),
      virtual_close_adjustment: centsToMoney(pesosToCents(vca?.centsAdjustment ?? 0)),
      reclassified_from_3605: centsToMoney(pesosToCents(vca?.reclassifiedAmount ?? 0)),
      equity_anchor_adjustment: centsToMoney(pesosToCents(primary.equityAnchorAdjustment ?? 0)),
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
    sign_convention: row.summary.sign_convention ?? null,
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
    // Motivos bloqueantes del preprocesador (importes ilegibles, columnas
    // ambiguas, códigos que no son cuentas PUC, descuadres): sin ellos el
    // cliente no sabría por qué la remisión no es certificable.
    validation_reasons: [...primary.validation.reasons],
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

  const pre = preprocessBuiltRows(built, parsed.data.period_label);
  const summary = summarize(pre, { signConvention: built.signConvention });

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

  // Recompute-on-read: cero desync con el preprocesador vigente. Las filas
  // `rows` persistidas antes de tb-2026-09-24 no estaban normalizadas; la
  // normalización es idempotente sobre filas ya naturales (ingesta-10).
  const rawRows = JSON.parse(decryptSecret(row.rawRowsEncrypted)) as RawAccountRow[];
  const normalized = normalizeSignConvention(rawRows);
  const pre = preprocessTrialBalance(normalized.rows, { defaultPeriod: row.periodLabel });
  const persisted = row.summary as Partial<TrialBalanceSummary> | null;
  const summary = summarize(pre, {
    signConvention:
      persisted?.sign_convention ??
      (normalized.detection.convention === 'algebraica' ? 'algebraica' : null),
  });

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

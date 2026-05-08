// ---------------------------------------------------------------------------
// Cached PreprocessedBalance — composer Ola Élite +1
// ---------------------------------------------------------------------------
// Une (a) `getCachedLedgerByPeriod` (cacheado, tag-invalidated por las
// Server Actions de journal-actions / period-actions) + (b) `getCachedAccountsFlat`
// (PUC, cacheado por puc:${ws}) y los proyecta al formato `RawAccountRow[]`
// que consume `preprocessTrialBalance`. El curator NIIF ya está cableado
// dentro del preprocesador, así que el resultado trae findings R1-R4
// automáticamente.
//
// Estrategia de cache (Opción D del research 2026):
//   - NO persistimos PreprocessedBalance en DB (zero desync, single source
//     of truth en journal_lines).
//   - Componemos sobre helpers ya cacheados con `'use cache'` (Ola 2 cuando
//     se active `cacheComponents: true`). Ahora corren como queries
//     normales — el comportamiento es correcto, solo sin cache de momento.
//   - Invalidación automática: las Server Actions ya emiten
//     `updateTag('libro-mayor:${ws}:${period}')` al postear/reversar
//     asientos, así que cuando `cacheComponents` flipee, este compositor
//     hereda la invalidación por composición.
// ---------------------------------------------------------------------------

import 'server-only';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  type AccountingPeriodRow,
  type ChartOfAccountsRow,
} from '@/lib/db/schema';
import { preprocessTrialBalance, type RawAccountRow } from '@/lib/preprocessing/trial-balance';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

import { getCachedAccountsFlat } from './ledger-queries';
import { getCachedLedgerByPeriod, type LedgerRow } from './ledger-queries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Etiqueta del periodo para `balancesByPeriod[period]`. */
function periodLabel(p: Pick<AccountingPeriodRow, 'year'>): string {
  return String(p.year);
}

/** Determina el signo natural: ACTIVO/GASTO/COSTO (debit-natural)
 *  vs PASIVO/PATRIMONIO/INGRESO (credit-natural). */
function naturalSide(type: ChartOfAccountsRow['type']): 'debit' | 'credit' {
  if (type === 'ACTIVO' || type === 'GASTO' || type === 'COSTO' || type === 'ORDEN_DEUDORA') {
    return 'debit';
  }
  return 'credit';
}

/** Inferencia de nivel desde el largo del código (mismo algoritmo que el
 *  parser CSV en `trial-balance.ts`). */
function inferLevel(code: string): RawAccountRow['level'] {
  const len = code.length;
  if (len === 1) return 'Clase';
  if (len === 2 || len === 3) return 'Grupo';
  if (len === 4 || len === 5) return 'Cuenta';
  if (len === 6 || len === 7) return 'Subcuenta';
  return 'Auxiliar';
}

/** Suma debit/credit de las líneas, agrupado por accountId. */
interface AggregatedAccount {
  accountId: string;
  totalDebit: number;
  totalCredit: number;
}

function aggregateLedger(rows: LedgerRow[]): Map<string, AggregatedAccount> {
  const map = new Map<string, AggregatedAccount>();
  for (const r of rows) {
    // Solo asientos posted+reversed cuentan para el balance oficial.
    if (r.entry.status !== 'posted' && r.entry.status !== 'reversed') continue;
    const acc = map.get(r.line.accountId);
    const d = parseFloat(r.line.debit ?? '0');
    const c = parseFloat(r.line.credit ?? '0');
    if (acc) {
      acc.totalDebit += d;
      acc.totalCredit += c;
    } else {
      map.set(r.line.accountId, {
        accountId: r.line.accountId,
        totalDebit: d,
        totalCredit: c,
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// loadTrialBalanceRows
//
// Reconstruye `RawAccountRow[]` desde la DB para uno o más periodos. La
// salida incluye TODAS las cuentas activas del PUC (incluso sin
// movimientos en el periodo — quedan con balance 0), porque el preprocesador
// usa la jerarquía completa para detectar cuentas faltantes y calcular
// totales por clase.
// ---------------------------------------------------------------------------

export interface LoadTrialBalanceInput {
  workspaceId: string;
  /** Periodo principal (T) — siempre presente. */
  periodId: string;
  /** Periodo comparativo (T-1) — opcional. */
  comparativePeriodId?: string | null;
}

export async function loadTrialBalanceRows(
  input: LoadTrialBalanceInput,
): Promise<{ rows: RawAccountRow[]; primaryLabel: string; comparativeLabel: string | null }> {
  const db = getDb();

  // Resolver labels desde accounting_periods.
  const periodRows = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, input.workspaceId),
        // Drizzle no tiene IN-array helper compacto sin `inArray`; mejor 2 queries.
      ),
    );
  const primaryRow = periodRows.find((p) => p.id === input.periodId);
  if (!primaryRow) {
    return { rows: [], primaryLabel: 'unknown', comparativeLabel: null };
  }
  const compRow = input.comparativePeriodId
    ? periodRows.find((p) => p.id === input.comparativePeriodId)
    : null;

  const primaryLabel = periodLabel(primaryRow);
  const comparativeLabel = compRow ? periodLabel(compRow) : null;

  // Cargar PUC + ledgers (cacheados — Ola 2 activa heredará el cache).
  const accounts = await getCachedAccountsFlat(input.workspaceId);
  const primaryLedger = await getCachedLedgerByPeriod(input.workspaceId, input.periodId);
  const comparativeLedger = input.comparativePeriodId
    ? await getCachedLedgerByPeriod(input.workspaceId, input.comparativePeriodId)
    : [];

  const aggPrimary = aggregateLedger(primaryLedger);
  const aggComparative = aggregateLedger(comparativeLedger);

  const rows: RawAccountRow[] = accounts
    .filter((a) => a.active !== false)
    .map((a) => {
      const balancesByPeriod: Record<string, number> = {};

      const aggT = aggPrimary.get(a.id);
      const balanceT = aggT
        ? naturalSide(a.type) === 'debit'
          ? aggT.totalDebit - aggT.totalCredit
          : aggT.totalCredit - aggT.totalDebit
        : 0;
      balancesByPeriod[primaryLabel] = balanceT;

      if (comparativeLabel) {
        const aggC = aggComparative.get(a.id);
        const balanceC = aggC
          ? naturalSide(a.type) === 'debit'
            ? aggC.totalDebit - aggC.totalCredit
            : aggC.totalCredit - aggC.totalDebit
          : 0;
        balancesByPeriod[comparativeLabel] = balanceC;
      }

      const inferredLevel = inferLevel(a.code);
      // El nivel del PUC sembrado (`a.level`) debe coincidir con la inferencia
      // de longitud, pero confiamos en el código (la longitud es invariante).
      // `transactional` se proyecta de `isPostable`.
      return {
        code: a.code,
        name: a.name,
        level: inferredLevel,
        transactional: Boolean(a.isPostable),
        balancesByPeriod,
      };
    });

  return { rows, primaryLabel, comparativeLabel };
}

// ---------------------------------------------------------------------------
// getCachedPreprocessedBalance
//
// Función principal: orquesta load + preprocess + curator. El resultado
// es el `PreprocessedBalance` listo para consumir por dashboards y triggers.
//
// El cache aplica indirectamente vía las queries cacheadas de `getCachedAccountsFlat`
// y `getCachedLedgerByPeriod`. Cuando `cacheComponents: true` se active
// (Ola 4), agregar `'use cache'` aquí para cachear el resultado completo
// (curator findings + cashFlowIndirecto + reportes), reduciendo el render
// de 200-500ms a <10ms en hits.
// ---------------------------------------------------------------------------

export interface GetCachedPreprocessedBalanceResult {
  balance: PreprocessedBalance | null;
  primaryLabel: string;
  comparativeLabel: string | null;
}

export async function getCachedPreprocessedBalance(
  workspaceId: string,
  periodId: string,
  comparativePeriodId?: string | null,
): Promise<GetCachedPreprocessedBalanceResult> {
  // Activación futura: descomentar cuando `cacheComponents: true`.
  // 'use cache';
  // cacheLife('hours');
  // cacheTag(`balance:${workspaceId}:${periodId}`);
  // cacheTag(`libro-mayor:${workspaceId}:${periodId}`);
  // cacheTag(`puc:${workspaceId}`);

  const { rows, primaryLabel, comparativeLabel } = await loadTrialBalanceRows({
    workspaceId,
    periodId,
    comparativePeriodId,
  });

  if (rows.length === 0) {
    return { balance: null, primaryLabel, comparativeLabel };
  }

  const balance = preprocessTrialBalance(rows, { defaultPeriod: primaryLabel });
  return { balance, primaryLabel, comparativeLabel };
}

// ---------------------------------------------------------------------------
// findComparativePeriod
//
// Helper para que los callers no tengan que calcular el periodo T-1 manualmente.
// Toma el periodo actual y devuelve el inmediatamente anterior (mes-1, con
// rollover de año). Si no existe en DB, retorna null.
// ---------------------------------------------------------------------------

export async function findComparativePeriod(
  workspaceId: string,
  currentPeriod: AccountingPeriodRow,
): Promise<AccountingPeriodRow | null> {
  const db = getDb();
  // Cálculo del mes anterior con rollover.
  let prevYear = currentPeriod.year;
  let prevMonth = currentPeriod.month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const rows = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, workspaceId),
        eq(accountingPeriods.year, prevYear),
        eq(accountingPeriods.month, prevMonth),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getLatestOpenPeriod
//
// Busca el periodo abierto más reciente del workspace. Útil para landing
// /workspace/comando cuando no se especifica periodId explícito.
// ---------------------------------------------------------------------------

export async function getLatestOpenPeriod(
  workspaceId: string,
): Promise<AccountingPeriodRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, workspaceId),
        eq(accountingPeriods.status, 'open'),
      ),
    );
  if (rows.length === 0) return null;
  // Más reciente = mayor (year, month).
  rows.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
  return rows[0];
}

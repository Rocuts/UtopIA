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

import { getCachedAccountsFlat, getLedgerTotalsByPeriods } from './ledger-queries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Etiqueta del periodo para `balancesByPeriod[period]`: `YYYY-MM`.
 *
 * Auditoría ratios-kpis-03: antes era `String(year)` y, con periodos
 * MENSUALES, T (2026-08) y T-1 (2026-07) colisionaban en '2026' y el
 * comparativo sobrescribía al actual. La etiqueta `YYYY-MM` también le dice a
 * los pilares (shared-metrics.monthsCovered) que los resultados son el
 * acumulado del año hasta ese mes. El mes 13 (periodo de cierre) se conserva.
 */
export function periodLabel(p: Pick<AccountingPeriodRow, 'year' | 'month'>): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Orden cronológico (año, mes). */
function comparePeriods(
  a: Pick<AccountingPeriodRow, 'year' | 'month'>,
  b: Pick<AccountingPeriodRow, 'year' | 'month'>,
): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/** Clases de resultado (se acumulan dentro del año fiscal, no entre años). */
function isResultClass(code: string): boolean {
  const d = code[0];
  return d === '4' || d === '5' || d === '6' || d === '7';
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

// ---------------------------------------------------------------------------
// loadTrialBalanceRows
//
// Reconstruye `RawAccountRow[]` desde la DB para uno o dos periodos. La salida
// incluye TODAS las cuentas activas del PUC (incluso sin movimientos — quedan
// con balance 0), porque el preprocesador usa la jerarquía completa.
//
// Semántica por periodo objetivo T (auditoría ratios-kpis-03):
//   - Clases 1-3 (y 8-9, cuentas de orden): SALDO ACUMULADO al cierre de T =
//     Σ movimientos de todos los periodos con (año, mes) ≤ T. El saldo inicial
//     se postea como asiento en su periodo, así que queda incluido.
//   - Clases 4-7: resultado ACUMULADO DEL AÑO de T = Σ movimientos de los
//     periodos del mismo año con mes ≤ T.
//   - Resultados de años anteriores que no se cerraron en libros (Σ clases 4-7
//     de años < año(T)): se trasladan al patrimonio (3705 utilidades / 3710
//     pérdidas acumuladas). Con asiento de cierre esa suma es 0. Sin este
//     traslado la ecuación patrimonial no cuadraría.
// ---------------------------------------------------------------------------

export interface LoadTrialBalanceInput {
  workspaceId: string;
  /** Periodo principal (T) — siempre presente. */
  periodId: string;
  /** Periodo comparativo — opcional (ver `findComparativePeriod`). */
  comparativePeriodId?: string | null;
}

const PRIOR_RESULT_NAME =
  'Resultados de ejercicios anteriores no trasladados (calculado del libro mayor)';

export async function loadTrialBalanceRows(
  input: LoadTrialBalanceInput,
): Promise<{ rows: RawAccountRow[]; primaryLabel: string; comparativeLabel: string | null }> {
  const db = getDb();

  const periodRows: AccountingPeriodRow[] = await db
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.workspaceId, input.workspaceId));
  const primaryRow = periodRows.find((p) => p.id === input.periodId);
  if (!primaryRow) {
    return { rows: [], primaryLabel: 'unknown', comparativeLabel: null };
  }
  const compRowRaw = input.comparativePeriodId
    ? periodRows.find((p) => p.id === input.comparativePeriodId) ?? null
    : null;
  // Un comparativo posterior al periodo principal no es un comparativo.
  const compRow = compRowRaw && comparePeriods(compRowRaw, primaryRow) < 0 ? compRowRaw : null;

  const primaryLabel = periodLabel(primaryRow);
  const comparativeLabel = compRow ? periodLabel(compRow) : null;
  const targets = compRow ? [primaryRow, compRow] : [primaryRow];

  // Todos los periodos hasta T: necesarios para el saldo acumulado.
  const relevant = periodRows.filter((p) => comparePeriods(p, primaryRow) <= 0);
  const periodById = new Map(relevant.map((p) => [p.id, p]));

  const accounts = await getCachedAccountsFlat(input.workspaceId);
  const totals = await getLedgerTotalsByPeriods(
    input.workspaceId,
    relevant.map((p) => p.id),
  );

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  // balances[label][accountId] y resultado de años anteriores por label.
  const balances = new Map<string, Map<string, number>>();
  const priorResult = new Map<string, number>();
  for (const t of targets) {
    balances.set(periodLabel(t), new Map());
    priorResult.set(periodLabel(t), 0);
  }

  for (const row of totals) {
    const p = periodById.get(row.periodId);
    const account = accountById.get(row.accountId);
    if (!p || !account) continue;
    const debit = parseFloat(row.debit ?? '0') || 0;
    const credit = parseFloat(row.credit ?? '0') || 0;
    const signed = naturalSide(account.type) === 'debit' ? debit - credit : credit - debit;
    const result = isResultClass(account.code);

    for (const t of targets) {
      const label = periodLabel(t);
      if (comparePeriods(p, t) > 0) continue; // posterior a T
      if (result) {
        if (p.year === t.year) {
          const m = balances.get(label)!;
          m.set(account.id, (m.get(account.id) ?? 0) + signed);
        } else {
          // Año anterior sin cerrar: utilidad (+) o pérdida (−) acumulada.
          priorResult.set(label, priorResult.get(label)! + (credit - debit));
        }
      } else {
        const m = balances.get(label)!;
        m.set(account.id, (m.get(account.id) ?? 0) + signed);
      }
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const rows: RawAccountRow[] = accounts
    .filter((a) => a.active !== false)
    .map((a) => {
      const balancesByPeriod: Record<string, number> = {};
      for (const t of targets) {
        const label = periodLabel(t);
        balancesByPeriod[label] = round2(balances.get(label)!.get(a.id) ?? 0);
      }
      // El nivel del PUC sembrado (`a.level`) debe coincidir con la inferencia
      // de longitud, pero confiamos en el código (la longitud es invariante).
      // `transactional` se proyecta de `isPostable`.
      return {
        code: a.code,
        name: a.name,
        level: inferLevel(a.code),
        transactional: Boolean(a.isPostable),
        balancesByPeriod,
      };
    });

  // Traslado de resultados de años anteriores no cerrados en libros.
  const hasPrior = targets.some((t) => Math.abs(priorResult.get(periodLabel(t))!) >= 0.005);
  if (hasPrior) {
    for (const [prefix, sign] of [['3705', 1], ['3710', -1]] as const) {
      const values: Record<string, number> = {};
      let any = false;
      for (const t of targets) {
        const label = periodLabel(t);
        const v = priorResult.get(label)!;
        const applies = sign === 1 ? v > 0 : v < 0;
        values[label] = applies ? round2(v) : 0;
        if (applies && Math.abs(v) >= 0.005) any = true;
      }
      if (!any) continue;
      const postable = rows.find(
        (r) => r.code.startsWith(prefix) && r.transactional && r.code.length >= 6,
      );
      if (postable) {
        for (const [label, v] of Object.entries(values)) {
          postable.balancesByPeriod[label] = round2((postable.balancesByPeriod[label] ?? 0) + v);
        }
      } else {
        rows.push({
          code: `${prefix}99`,
          name: PRIOR_RESULT_NAME,
          level: 'Subcuenta',
          transactional: true,
          balancesByPeriod: values,
        });
      }
    }
  }

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
// Comparativo = CIERRE DEL AÑO ANTERIOR (último periodo registrado del año
// T−1, normalmente diciembre o el 13 de cierre). Con resultados acumulados del
// año (ver loadTrialBalanceRows) es la única base consistente: el EFE
// indirecto parte de la utilidad acumulada del año y de las variaciones de
// balance desde el 31-dic anterior, y los KPIs comparan contra el cierre
// (NIIF para PYMES §3.14). El mes anterior dejaba al EFE con la utilidad de
// ocho meses contra variaciones de uno (auditoría ratios-kpis-03).
// Si no existe ningún periodo del año anterior, retorna null.
// ---------------------------------------------------------------------------

export async function findComparativePeriod(
  workspaceId: string,
  currentPeriod: AccountingPeriodRow,
): Promise<AccountingPeriodRow | null> {
  const db = getDb();
  const rows: AccountingPeriodRow[] = await db
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.workspaceId, workspaceId));
  const priorYear = rows
    .filter((p) => p.year === currentPeriod.year - 1)
    .sort((a, b) => b.month - a.month);
  return priorYear[0] ?? null;
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

// Regresiones del PDF de cierre mensual (pdf-elite.ts):
//   contab-nomina-02  — la consulta sumaba movimientos de TODOS los períodos,
//                       borradores y reversados (filtro en el ON del LEFT JOIN)
//                       y, tras el asiento de cierre, el P&G del mes era cero.
//   reportes-export-03 — filtros por signo, Math.abs y truncamiento: A ≠ P + C
//                        y líneas que no suman el total.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const executed: unknown[] = [];
let rows: Array<Record<string, string>> = [];
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    execute: vi.fn(async (q: unknown) => {
      executed.push(q);
      return { rows };
    }),
  }),
}));

import {
  buildMonthlyStatements,
  generateElitePdf,
  linesForPage,
  monthlyBalancesQuery,
  type MonthlyAccountRow,
} from '../pdf-elite';
import type { AccountingPeriodRow } from '@/lib/db/schema';

const P = (pesos: number) => BigInt(Math.round(pesos * 100));
const row = (code: string, type: string, bal: number, mov = 0): MonthlyAccountRow => ({
  code, name: code, type, balanceToDateCents: P(bal), periodMovementCents: P(mov),
});

const period = {
  id: 'p2', workspaceId: 'ws', year: 2026, month: 2,
  startsAt: new Date(Date.UTC(2026, 1, 1)), endsAt: new Date(Date.UTC(2026, 2, 0, 23, 59, 59)),
  status: 'closed', closedAt: null, closedBy: null, lockedAt: null,
} as unknown as AccountingPeriodRow;

beforeEach(() => { executed.length = 0; rows = []; });

describe('contab-nomina-02 — consulta de saldos', () => {
  const text = new PgDialect().sqlToQuery(monthlyBalancesQuery('ws-1', 'per-2')).sql;

  it('filtra estado y período en WHERE/FILTER con INNER JOIN (no en el ON de un LEFT JOIN)', () => {
    expect(text).not.toMatch(/LEFT JOIN/i);
    expect(text).toMatch(/JOIN journal_entries je\s+ON je\.id = jl\.entry_id\s+AND je\.workspace_id = \$\d+/);
    expect(text).toMatch(/je\.status IN \('posted', 'reversed'\)/);
  });

  it('balance a la fecha de corte y P&G del período sin el asiento de cierre', () => {
    expect(text).toMatch(/FILTER \(WHERE ap\.ends_at <= cut\.ends_at\)/);
    expect(text).toMatch(/FILTER \(WHERE je\.period_id = \$\d+ AND je\.source_type <> 'closing'\)/);
    expect(text).toMatch(/ap\.ends_at <= cut\.ends_at/);
    expect(text).not.toMatch(/parseFloat/);
  });
});

describe('reportes-export-03 — estados firmados por naturaleza', () => {
  const ledger = [
    row('110505', 'ACTIVO', 1_000_000),
    row('152405', 'ACTIVO', 3_000_000),
    row('159205', 'ACTIVO', -500_000), // correctora: saldo crédito
    row('220505', 'PASIVO', -1_200_000),
    row('240805', 'PASIVO', 200_000), // pasivo con saldo deudor (IVA a favor)
    row('310505', 'PATRIMONIO', -2_100_000),
    row('371005', 'PATRIMONIO', 300_000), // pérdidas acumuladas
    // resultado del período no trasladado (cierre no hecho aún)
    row('413505', 'INGRESO', -2_000_000, -2_000_000),
    row('417505', 'INGRESO', 100_000, 100_000), // devoluciones restan
    row('510506', 'GASTO', 1_200_000, 1_200_000),
  ];

  it('correctoras, pasivos deudores y pérdidas restan; el resultado no trasladado entra al patrimonio y cuadra', () => {
    const st = buildMonthlyStatements(ledger);
    expect(st.balance.activos.find((l) => l.code === '159205')?.amountCents).toBe(P(-500_000));
    expect(st.balance.totalActivosCents).toBe(P(3_500_000));
    expect(st.balance.totalPasivosCents).toBe(P(1_000_000));
    expect(st.balance.resultadoNoTrasladadoCents).toBe(P(700_000));
    expect(st.balance.totalPatrimonioCents).toBe(P(1_800_000 + 700_000));
    expect(st.balance.diferenciaCents).toBe(BigInt(0));
  });

  it('P&G: la devolución 4175 resta de los ingresos', () => {
    const st = buildMonthlyStatements(ledger);
    expect(st.pnl.totalIngresosCents).toBe(P(1_900_000));
    expect(st.pnl.totalCostosGastosCents).toBe(P(1_200_000));
    expect(st.pnl.utilidadCents).toBe(P(700_000));
  });

  it('el recorte agrega "Otras cuentas" para que las líneas impresas sumen el total', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ code: String(1100 + i), name: 'x', amountCents: P(i + 1) }));
    const shown = linesForPage(many, 12);
    expect(shown).toHaveLength(12);
    expect(shown[11].name).toBe('Otras cuentas (9)');
    expect(shown.reduce((a, l) => a + l.amountCents, BigInt(0))).toBe(many.reduce((a, l) => a + l.amountCents, BigInt(0)));
  });
});

describe('generateElitePdf — documento probatorio', () => {
  const asDbRows = (r: MonthlyAccountRow[]) =>
    r.map((x) => ({
      code: x.code, name: x.name, type: x.type,
      balance_to_date: (Number(x.balanceToDateCents) / 100).toFixed(2),
      period_movement: (Number(x.periodMovementCents) / 100).toFixed(2),
    }));

  it('genera el PDF cuando el balance cuadra', async () => {
    rows = asDbRows([row('110505', 'ACTIVO', 1_000), row('310505', 'PATRIMONIO', -1_000)]);
    const buf = await generateElitePdf({ workspaceId: 'ws', periodId: 'p2', periodHash: 'a'.repeat(64), period });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(executed).toHaveLength(1);
  });

  it('se bloquea (throw) si Activo ≠ Pasivo + Patrimonio', async () => {
    rows = asDbRows([row('110505', 'ACTIVO', 1_000), row('310505', 'PATRIMONIO', -900), row('810505', 'ORDEN_DEUDORA', -100)]);
    await expect(
      generateElitePdf({ workspaceId: 'ws', periodId: 'p2', periodHash: 'a'.repeat(64), period }),
    ).rejects.toThrow(/Activo ≠ Pasivo \+ Patrimonio/);
  });
});

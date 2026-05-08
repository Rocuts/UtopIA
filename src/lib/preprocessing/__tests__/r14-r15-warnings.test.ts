import { describe, expect, it } from 'vitest';

import { runR14 } from '../curator-rules/r14-ppe-depreciation-sync';
import { runR15 } from '../curator-rules/r15-cost-classification';
import type { PeriodSnapshot } from '../trial-balance';

interface Account {
  code: string;
  balance: number;
}

function buildSnapshot(opts: {
  class1?: Account[];
  class4?: Account[];
  class5?: Account[];
  class6?: Account[];
  class7?: Account[];
}): PeriodSnapshot {
  const cl = (code: number, accounts: Account[] = []) => ({
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: accounts.reduce((s, a) => s + a.balance, 0),
    reportedTotal: null,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: `Cuenta ${a.code}`,
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  });

  return {
    period: '2025',
    classes: [
      cl(1, opts.class1 ?? []),
      cl(4, opts.class4 ?? []),
      cl(5, opts.class5 ?? []),
      cl(6, opts.class6 ?? []),
      cl(7, opts.class7 ?? []),
    ],
    controlTotals: {
      activo: 0,
      activoCorriente: 0,
      activoNoCorriente: 0,
      pasivo: 0,
      pasivoCorriente: 0,
      pasivoNoCorriente: 0,
      patrimonio: 0,
      ingresos: 0,
      gastos: 0,
      utilidadNeta: 0,
      efectivoCuenta11: 0,
      deudoresCuenta13: 0,
      cuentasPorPagar23: 0,
      impuestosCuenta24: 0,
      obligacionesLaborales25: 0,
    },
    equityBreakdown: {},
    summary: {
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: 0,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
    findings: {},
  };
}

describe('R14 — PPE sin depreciación', () => {
  it('PPE $66.386.000 con 1592=0 y 5160=0 → ppeWithoutDepreciation=true', () => {
    const snap = buildSnapshot({
      class1: [{ code: '1520', balance: 66_386_000 }], // PPE bruto
      class5: [],
    });
    const r = runR14(snap);
    expect(r.audit.ppeWithoutDepreciation).toBe(true);
    expect(snap.findings?.ppeWithoutDepreciation).toBe(true);
    expect(r.findings.some((f) => f.code === 'CUR-R14')).toBe(true);
  });

  it('PPE con 5160 > 0 (gasto depreciación del periodo) → flag false', () => {
    const snap = buildSnapshot({
      class1: [{ code: '1520', balance: 66_386_000 }],
      class5: [{ code: '5160', balance: 5_000_000 }],
    });
    const r = runR14(snap);
    expect(r.audit.ppeWithoutDepreciation).toBe(false);
    expect(snap.findings?.ppeWithoutDepreciation).toBe(false);
  });

  it('PPE con 1592 > 0 (depreciación acumulada) → flag false', () => {
    const snap = buildSnapshot({
      class1: [
        { code: '1520', balance: 66_386_000 },
        { code: '1592', balance: -10_000_000 },
      ],
      class5: [],
    });
    const r = runR14(snap);
    expect(r.audit.ppeWithoutDepreciation).toBe(false);
  });

  it('PPE inmaterial (< $1M) → flag false aunque no haya depreciación', () => {
    const snap = buildSnapshot({
      class1: [{ code: '1520', balance: 500_000 }],
      class5: [],
    });
    const r = runR14(snap);
    expect(r.audit.ppeWithoutDepreciation).toBe(false);
  });
});

describe('R15 — Costeo incompleto', () => {
  it('ingresos 41 con 6135=0 y 7405>0 → costeoIncompleto=true', () => {
    const snap = buildSnapshot({
      class4: [{ code: '4135', balance: 100_000_000 }],
      class6: [], // sin 6135
      class7: [{ code: '7405', balance: 60_000_000 }],
    });
    const r = runR15(snap);
    expect(r.audit.costeoIncompleto).toBe(true);
    expect(snap.findings?.costeoIncompleto).toBe(true);
    expect(r.findings.some((f) => f.code === 'CUR-R15')).toBe(true);
  });

  it('ingresos 41 con 6135 > 0 → flag false (costeo correcto)', () => {
    const snap = buildSnapshot({
      class4: [{ code: '4135', balance: 100_000_000 }],
      class6: [{ code: '6135', balance: 60_000_000 }],
      class7: [],
    });
    const r = runR15(snap);
    expect(r.audit.costeoIncompleto).toBe(false);
  });

  it('sin clase 7 → flag false (no hay señal de mal costeo)', () => {
    const snap = buildSnapshot({
      class4: [{ code: '4135', balance: 100_000_000 }],
      class6: [],
      class7: [],
    });
    const r = runR15(snap);
    expect(r.audit.costeoIncompleto).toBe(false);
  });
});

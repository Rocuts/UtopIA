import { describe, expect, it } from 'vitest';

import { runR12 } from '../curator-rules/r12-closing-detector';
import type { PeriodSnapshot } from '../trial-balance';

function buildSnapshotForR12(opts: {
  ingresos: number; // clase 4
  gastos: number; // clase 5
  costos: number; // clase 6
  produccion: number; // clase 7
  grupo36: number;
  grupo37: number;
}): PeriodSnapshot {
  const cl = (code: number, total: number, accounts: { code: string; balance: number }[] = []) => ({
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: total,
    reportedTotal: total,
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
      cl(1, 0),
      cl(2, 0),
      cl(3, opts.grupo36 + opts.grupo37, [
        { code: '3605', balance: opts.grupo36 },
        { code: '3710', balance: opts.grupo37 },
      ]),
      cl(4, opts.ingresos),
      cl(5, opts.gastos),
      cl(6, opts.costos),
      cl(7, opts.produccion),
    ],
    controlTotals: {
      activo: 0,
      activoCorriente: 0,
      activoNoCorriente: 0,
      pasivo: 0,
      pasivoCorriente: 0,
      pasivoNoCorriente: 0,
      patrimonio: opts.grupo36 + opts.grupo37,
      ingresos: opts.ingresos,
      gastos: opts.gastos + opts.costos + opts.produccion,
      utilidadNeta: opts.ingresos - opts.gastos - opts.costos - opts.produccion,
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
      totalEquity: opts.grupo36 + opts.grupo37,
      totalRevenue: opts.ingresos,
      totalExpenses: opts.gastos,
      totalCosts: opts.costos,
      totalProduction: opts.produccion,
      netIncome: opts.ingresos - opts.gastos - opts.costos - opts.produccion,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
    findings: {},
  };
}

describe('R12 — Detector de cierre de libros', () => {
  it('libros NO cerrados: utilidad transitoria $2.228M, grupo 36+37 ≈ $42K (Grupo Empresarial 2 Tres SAS)', () => {
    const snap = buildSnapshotForR12({
      ingresos: 8_500_000_000,
      gastos: 4_271_503_211,
      costos: 2_000_000_000,
      produccion: 0,
      grupo36: 0,
      grupo37: 42_720, // sólo Convergencia, casi 0
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(true);
    expect(result.abortVirtualClose).toBe(true);
    expect(snap.findings?.librosNoCerrados).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].code).toBe('CUR-R12');
    expect(result.findings[0].severity).toBe('critico');
    expect(result.audit.suggestedClosingEntries.length).toBeGreaterThanOrEqual(3);
  });

  it('cierre normal: utilidad trasladada a 3605 → librosNoCerrados=false, R8 ejecuta', () => {
    const snap = buildSnapshotForR12({
      ingresos: 8_500_000_000,
      gastos: 4_271_503_211,
      costos: 2_000_000_000,
      produccion: 0,
      grupo36: 2_228_496_789, // utilidad ya trasladada
      grupo37: 0,
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
    expect(result.abortVirtualClose).toBe(false);
    expect(snap.findings?.librosNoCerrados).toBe(false);
    expect(result.findings.length).toBe(0);
  });

  it('utilidad transitoria inmaterial (< $1M) NO dispara R12 aunque grupos 36/37 estén en 0', () => {
    const snap = buildSnapshotForR12({
      ingresos: 500_000,
      gastos: 100_000,
      costos: 0,
      produccion: 0,
      grupo36: 0,
      grupo37: 0,
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
    expect(result.abortVirtualClose).toBe(false);
  });

  it('grupo 36 dentro de tolerancia 5% absorbe la utilidad (no dispara)', () => {
    const snap = buildSnapshotForR12({
      ingresos: 1_000_000_000,
      gastos: 500_000_000,
      costos: 0,
      produccion: 0,
      // utilidad transitoria = 500M; tolerancia = max(500M*5%, 1M) = 25M; 480M absorbe
      grupo36: 480_000_000,
      grupo37: 0,
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
  });
});

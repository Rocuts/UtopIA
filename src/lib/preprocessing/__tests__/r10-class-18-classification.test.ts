import { describe, expect, it } from 'vitest';

import { runR10 } from '../curator-rules/r10-class-18-classification';
import type { PeriodSnapshot } from '../trial-balance';

interface Account {
  code: string;
  balance: number;
  name?: string;
}

function buildSnapshotForR10(opts: {
  class1Accounts?: Account[];
  class2Accounts?: Account[];
  class5Accounts?: Account[];
}): PeriodSnapshot {
  const cl = (code: number, accounts: Account[] = []) => ({
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: accounts.reduce((s, a) => s + a.balance, 0),
    reportedTotal: null,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: a.name ?? `Cuenta ${a.code}`,
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  });

  return {
    period: '2025',
    classes: [
      cl(1, opts.class1Accounts ?? []),
      cl(2, opts.class2Accounts ?? []),
      cl(5, opts.class5Accounts ?? []),
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

describe('R10 — Clasificación cuenta 18 + causación impuesto', () => {
  it('cuenta 1815 saldo deudor $3.839.538 + 24xx con saldo positivo: NO dispara flags', () => {
    const snap = buildSnapshotForR10({
      class1Accounts: [{ code: '1815xx', balance: 3_839_538 }],
      class2Accounts: [{ code: '2404', balance: 5_000_000 }], // tiene 24xx
      class5Accounts: [{ code: '5405', balance: 3_839_538 }], // gasto impuesto
    });
    const r = runR10(snap);

    expect(r.audit.cuenta18UsadaComoGasto).toBe(false);
    expect(r.audit.missingTaxCausation).toBe(false);
    expect(snap.findings?.cuenta18UsadaComoGasto).toBe(false);
    expect(snap.findings?.missingTaxCausation).toBe(false);
  });

  it('cuenta 1815 saldo acreedor $-3.839.538 → cuenta18UsadaComoGasto=true', () => {
    const snap = buildSnapshotForR10({
      class1Accounts: [{ code: '1815xx', balance: -3_839_538 }],
      class2Accounts: [],
      class5Accounts: [],
    });
    const r = runR10(snap);

    expect(r.audit.cuenta18UsadaComoGasto).toBe(true);
    expect(snap.findings?.cuenta18UsadaComoGasto).toBe(true);
    expect(r.findings.some((f) => f.code === 'CUR-R10')).toBe(true);
  });

  it('gasto impuesto 5405=$5M sin pasivo 24xx → missingTaxCausation=true', () => {
    const snap = buildSnapshotForR10({
      class1Accounts: [{ code: '1815xx', balance: 100_000 }],
      class2Accounts: [], // sin 24xx
      class5Accounts: [{ code: '5405', balance: 5_000_000 }], // gasto impuesto
    });
    const r = runR10(snap);

    expect(r.audit.missingTaxCausation).toBe(true);
    expect(snap.findings?.missingTaxCausation).toBe(true);
    const critFinding = r.findings.find((f) => f.severity === 'critico');
    expect(critFinding).toBeDefined();
    expect(critFinding?.title).toMatch(/causaci[oó]n/i);
  });

  it('gasto impuesto sin causación + 1815 acreedor → ambos flags activos', () => {
    const snap = buildSnapshotForR10({
      class1Accounts: [{ code: '1815xx', balance: -2_000_000 }],
      class2Accounts: [],
      class5Accounts: [{ code: '5405', balance: 3_839_538 }],
    });
    const r = runR10(snap);

    expect(r.audit.cuenta18UsadaComoGasto).toBe(true);
    expect(r.audit.missingTaxCausation).toBe(true);
  });

  // -------------------------------------------------------------------------
  // niif-preproceso-18 — renta causada y compensada con anticipos/retenciones
  // -------------------------------------------------------------------------
  it('renta 5405 = $350M con 2404 = 0 y retención de renta 135515 = $200M: NO bloquea (compensación)', () => {
    const snap = buildSnapshotForR10({
      class1Accounts: [{ code: '13551505', balance: 200_000_000, name: 'Retencion en la fuente' }],
      class2Accounts: [],
      class5Accounts: [{ code: '540505', balance: 350_000_000 }],
    });
    const r = runR10(snap);

    expect(r.audit.missingTaxCausation).toBe(false);
    expect(snap.findings?.missingTaxCausation).toBe(false);
    expect(r.findings.some((f) => f.severity === 'critico')).toBe(false);
    const info = r.findings.find((f) => f.code === 'CUR-R10' && f.severity === 'informativo');
    expect(info?.recommendation).toMatch(/formulario 110/);
  });

  it('saldos 1355 que NO son de renta (IVA retenido 135517, sobrantes 135520) no explican la compensación', () => {
    const snap = buildSnapshotForR10({
      class1Accounts: [
        { code: '135517', balance: 150_000_000, name: 'Impuesto a las ventas retenido' },
        { code: '135520', balance: 150_000_000, name: 'Sobrantes en liquidacion privada' },
      ],
      class2Accounts: [],
      class5Accounts: [{ code: '540505', balance: 350_000_000 }],
    });
    const r = runR10(snap);
    expect(r.audit.missingTaxCausation).toBe(true);
    const crit = r.findings.find((f) => f.severity === 'critico');
    // El texto de impacto ya no afirma que se viola la ecuación patrimonial.
    expect(crit?.impact).not.toMatch(/ecuaci[oó]n patrimonial/i);
  });

  it('135595 sólo cuenta como crédito de renta si su nombre es de renta', () => {
    const conNombre = buildSnapshotForR10({
      class1Accounts: [{ code: '135595', balance: 200_000_000, name: 'Otros anticipos de renta' }],
      class5Accounts: [{ code: '540505', balance: 350_000_000 }],
    });
    const sinNombre = buildSnapshotForR10({
      class1Accounts: [{ code: '135595', balance: 200_000_000, name: 'Otros' }],
      class5Accounts: [{ code: '540505', balance: 350_000_000 }],
    });
    expect(runR10(conNombre).audit.missingTaxCausation).toBe(false);
    expect(runR10(sinNombre).audit.missingTaxCausation).toBe(true);
  });
});

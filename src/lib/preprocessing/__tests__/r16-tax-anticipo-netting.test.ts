// ---------------------------------------------------------------------------
// R16 — Anticipo Renta (PUC 135515) → Neto a Pagar contra PUC 2404
// ---------------------------------------------------------------------------
// Verifica que el detector R16 expone correctamente el "Neto a Pagar" en
// `controlTotals.impuestoRentaNeto` y emite el finding informativo para que
// el NIIF Analyst lo presente en el Balance.
//
// Sustento: NIC 12 §71 + NIIF for SMEs §29.29 + Art. 850 E.T. + Art. 855 E.T.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { runR16 } from '../curator-rules/r16-tax-anticipo-netting';
import type { PeriodSnapshot } from '../trial-balance';

interface Account {
  code: string;
  balance: number;
}

function buildSnapshotForR16(opts: {
  class1Accounts?: Account[];
  class2Accounts?: Account[];
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
      cl(1, opts.class1Accounts ?? []),
      cl(2, opts.class2Accounts ?? []),
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

describe('R16 — Anticipo de Renta (PUC 135515) → Neto a Pagar (NIC 12 §71)', () => {
  it('caso canónico ORDEN DE CIERRE: 2404=$10M bruto + 135515=$3.839.538 anticipo → neto=$6.160.462', () => {
    const snap = buildSnapshotForR16({
      class1Accounts: [{ code: '135515', balance: 3_839_538 }],
      class2Accounts: [{ code: '2404', balance: 10_000_000 }],
    });

    const r = runR16(snap);

    expect(r.audit.applicable).toBe(true);
    expect(r.audit.brutoPasivo2404).toBeCloseTo(10_000_000, 2);
    expect(r.audit.anticipoActivo135515).toBeCloseTo(3_839_538, 2);
    expect(r.audit.netoAPagar).toBeCloseTo(6_160_462, 2);

    // Expuesto al snapshot para el orquestador.
    expect(snap.controlTotals.impuestoRentaNeto).toBeDefined();
    expect(snap.controlTotals.impuestoRentaNeto?.netoAPagar).toBeCloseTo(6_160_462, 2);
    expect(snap.controlTotals.impuestoRentaNeto?.applicable).toBe(true);

    // Bandera para el gate.
    expect(snap.findings?.anticipoRentaMaterial).toBe(true);

    // Finding informativo con cita normativa.
    const finding = r.findings.find((f) => f.code === 'CUR-R16');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('informativo');
    expect(finding?.normReference).toMatch(/NIC\s*12\s*§71/);
    expect(finding?.normReference).toMatch(/Art\.?\s*850\s*E\.?T\.?/);
  });

  it('cent-exact: 2404=$5.000.000,17 + 135515=$1.234.567,89 → neto=$3.765.432,28 al centavo', () => {
    const snap = buildSnapshotForR16({
      class1Accounts: [{ code: '135515', balance: 1_234_567.89 }],
      class2Accounts: [{ code: '2404', balance: 5_000_000.17 }],
    });

    const r = runR16(snap);
    expect(r.audit.netoAPagar).toBeCloseTo(3_765_432.28, 2);

    // Verificación al centavo (ITEM 1 — cent-exact)
    const netoCents = Math.round(r.audit.netoAPagar * 100);
    const expectedCents = Math.round(5_000_000.17 * 100) - Math.round(1_234_567.89 * 100);
    expect(netoCents).toBe(expectedCents);
  });

  it('sin anticipo material (135515 ≈ 0): NO aplica netting, neto = bruto', () => {
    const snap = buildSnapshotForR16({
      class1Accounts: [{ code: '135515', balance: 50_000 }], // bajo el threshold de $100k
      class2Accounts: [{ code: '2404', balance: 10_000_000 }],
    });

    const r = runR16(snap);
    expect(r.audit.applicable).toBe(false);
    expect(r.audit.netoAPagar).toBeCloseTo(10_000_000, 2);
    expect(r.findings).toHaveLength(0);
    expect(snap.findings?.anticipoRentaMaterial).toBe(false);
  });

  it('sin pasivo 2404 (bruto ≈ 0): NO aplica netting (el anticipo es saldo a favor, no netting)', () => {
    const snap = buildSnapshotForR16({
      class1Accounts: [{ code: '135515', balance: 3_839_538 }],
      class2Accounts: [],
    });

    const r = runR16(snap);
    expect(r.audit.applicable).toBe(false);
    // Saldo a favor → manejado por el detector existente saldoAFavorImpuesto.
    expect(r.findings).toHaveLength(0);
  });

  it('anticipo > bruto: NO aplica netting (saldo a favor, no negativo)', () => {
    const snap = buildSnapshotForR16({
      class1Accounts: [{ code: '135515', balance: 8_000_000 }],
      class2Accounts: [{ code: '2404', balance: 5_000_000 }],
    });

    const r = runR16(snap);
    expect(r.audit.applicable).toBe(false);
    // El neto sería negativo → presentación correcta: saldo a favor en Activo
    // vía el detector saldoAFavorImpuesto, no via netting.
  });

  it('subcuenta 135515xx (auxiliar): el detector reconoce el prefijo', () => {
    const snap = buildSnapshotForR16({
      class1Accounts: [
        { code: '13551501', balance: 2_000_000 },
        { code: '13551502', balance: 1_839_538 },
      ],
      class2Accounts: [{ code: '240405', balance: 10_000_000 }], // subcuenta de 2404
    });

    const r = runR16(snap);
    expect(r.audit.applicable).toBe(true);
    expect(r.audit.anticipoActivo135515).toBeCloseTo(3_839_538, 2);
    expect(r.audit.netoAPagar).toBeCloseTo(6_160_462, 2);
  });
});

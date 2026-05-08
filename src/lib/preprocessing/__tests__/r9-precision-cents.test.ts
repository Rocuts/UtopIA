import { describe, expect, it } from 'vitest';

import { runR9 } from '../curator-rules/r9-precision-cents';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PeriodSnapshot,
} from '../trial-balance';

describe('R9 — Precision Cents (raw + cents BigInt)', () => {
  it('cifra colombiana "1.968.104.173,17" → raw="1968104173.17", cents=196810417317n', () => {
    const csv = `codigo,nombre,nivel,saldo
1,Activo,Clase,"1.968.104.173,17"
1105,Caja,Auxiliar,"1.968.104.173,17"`;

    const rows = parseTrialBalanceCSV(csv, { currentYear: '2025' });
    const result = preprocessTrialBalance(rows);
    const snap = result.primary;

    expect(snap.controlTotals.activo).toBeCloseTo(1_968_104_173.17, 2);
    expect(snap.controlTotals.raw?.activo).toBe('1968104173.17');
    expect(snap.controlTotals.cents?.activo).toBe(BigInt(196810417317));
  });

  it('snapshot con cents/raw consistentes → audit.preserved=true, sin findings', () => {
    const csv = `codigo,nombre,nivel,saldo
1,Activo,Clase,"1000000.00"
1105,Caja,Auxiliar,"1000000.00"`;
    const rows = parseTrialBalanceCSV(csv, { currentYear: '2025' });
    const result = preprocessTrialBalance(rows);
    const snap = result.primary;

    const r = runR9(snap);
    expect(r.precisionCentsAudit.preserved).toBe(true);
    expect(r.precisionCentsAudit.driftCount).toBe(0);
    expect(r.findings).toHaveLength(0);
  });

  it('snapshot con cents corrupto → audit.preserved=false + finding crítico', () => {
    const csv = `codigo,nombre,nivel,saldo
1,Activo,Clase,"1000000.00"
1105,Caja,Auxiliar,"1000000.00"`;
    const rows = parseTrialBalanceCSV(csv, { currentYear: '2025' });
    const result = preprocessTrialBalance(rows);
    const snap = result.primary;

    // Corromper manualmente el cents.activo para simular drift.
    if (snap.controlTotals.cents) {
      snap.controlTotals.cents.activo = BigInt(99999999); // ≠ 100M en cents
    }

    const r = runR9(snap);
    expect(r.precisionCentsAudit.preserved).toBe(false);
    expect(r.findings.some((f) => f.code === 'CUR-R9' && f.severity === 'critico')).toBe(true);
  });

  it('snapshot legacy sin cents/raw NO falla (preserved=true, fieldsChecked=0)', () => {
    const snap: PeriodSnapshot = {
      period: '2025',
      classes: [],
      controlTotals: {
        activo: 1_000_000,
        activoCorriente: 1_000_000,
        activoNoCorriente: 0,
        pasivo: 600_000,
        pasivoCorriente: 600_000,
        pasivoNoCorriente: 0,
        patrimonio: 400_000,
        ingresos: 0,
        gastos: 0,
        utilidadNeta: 0,
        efectivoCuenta11: 1_000_000,
        deudoresCuenta13: 0,
        cuentasPorPagar23: 0,
        impuestosCuenta24: 0,
        obligacionesLaborales25: 0,
        // sin cents ni raw — caso legacy
      },
      equityBreakdown: {},
      summary: {
        totalAssets: 1_000_000,
        totalLiabilities: 600_000,
        totalEquity: 400_000,
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
    };

    const r = runR9(snap);
    expect(r.precisionCentsAudit.preserved).toBe(true);
    expect(r.precisionCentsAudit.fieldsChecked).toBe(0);
  });
});

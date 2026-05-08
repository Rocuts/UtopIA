// ---------------------------------------------------------------------------
// Curator NIIF Middleware — tests unitarios para R1–R4 + orchestrator.
// ---------------------------------------------------------------------------
// Las pruebas se enfocan en lógica determinística: dado un PeriodSnapshot
// (y opcionalmente un comparativo), verificamos que cada regla emita el
// `CuratorResult` esperado en términos de `findings`, `reclassifications`,
// `cashFlowIndirecto`, `balanceGapAttribution` y `taxProvisionRisk`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { runCurator } from '../balance-curator';
import { runR1 } from '../curator-rules/r1-negative-assets';
import { runR2 } from '../curator-rules/r2-indirect-cashflow';
import { runR3 } from '../curator-rules/r3-balance-gap-attribution';
import { runR4 } from '../curator-rules/r4-tax-provision-sufficiency';
import type {
  ControlTotals,
  EquityBreakdown,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '../trial-balance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidation(): ValidationResult {
  return { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] };
}

function makeControlTotals(overrides: Partial<ControlTotals> = {}): ControlTotals {
  return {
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
    ...overrides,
  };
}

function makeClass(
  code: number,
  accounts: Array<{ code: string; name: string; balance: number; level?: string }>,
): PUCClass {
  return {
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: accounts.reduce((s, a) => s + a.balance, 0),
    reportedTotal: null,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: a.name,
      level: a.level ?? 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  };
}

function makeSnapshot(opts: {
  period: string;
  controlTotals: ControlTotals;
  classes: PUCClass[];
  equity?: EquityBreakdown;
}): PeriodSnapshot {
  return {
    period: opts.period,
    classes: opts.classes,
    controlTotals: opts.controlTotals,
    equityBreakdown: opts.equity ?? {},
    summary: {
      totalAssets: opts.controlTotals.activo,
      totalLiabilities: opts.controlTotals.pasivo,
      totalEquity: opts.controlTotals.patrimonio,
      totalRevenue: opts.controlTotals.ingresos,
      totalExpenses: 0,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: opts.controlTotals.utilidadNeta,
      equationBalance:
        opts.controlTotals.activo - (opts.controlTotals.pasivo + opts.controlTotals.patrimonio),
      equationBalanced:
        Math.abs(
          opts.controlTotals.activo - (opts.controlTotals.pasivo + opts.controlTotals.patrimonio),
        ) < 100,
    },
    validation: makeValidation(),
    discrepancies: [],
    missingExpectedAccounts: [],
  };
}

// ---------------------------------------------------------------------------
// R1 — Saldos negativos en activos
// ---------------------------------------------------------------------------

describe('R1 — Saldos Incoherentes en Activos', () => {
  it('reclasifica cuenta 1105 con saldo -$50M y emite finding alto', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ activo: -50_000_000 }),
      classes: [makeClass(1, [{ code: '110505', name: 'Caja', balance: -50_000_000 }])],
    });
    const out = runR1(snap);
    expect(out.reclassifications).toHaveLength(1);
    expect(out.reclassifications[0].accountCode).toBe('110505');
    expect(out.reclassifications[0].amountCop).toBe(50_000_000);
    expect(out.reclassifications[0].reclassifiedToCode).toBe('2810ZZ');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].code).toBe('CUR-R1');
    expect(out.findings[0].severity).toBe('alto');
  });

  it('no reclasifica cuentas con saldo positivo', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ activo: 100_000_000 }),
      classes: [makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }])],
    });
    const out = runR1(snap);
    expect(out.reclassifications).toHaveLength(0);
    expect(out.findings).toHaveLength(0);
  });

  it('reclasifica múltiples cuentas negativas en un solo finding', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ activo: -3_000_000 }),
      classes: [
        makeClass(1, [
          { code: '110505', name: 'Caja', balance: -1_000_000 },
          { code: '111005', name: 'Bancos', balance: -2_000_000 },
        ]),
      ],
    });
    const out = runR1(snap);
    expect(out.reclassifications).toHaveLength(2);
    expect(out.findings).toHaveLength(1);
  });

  it('ignora saldos negativos triviales (<= $100)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals(),
      classes: [makeClass(1, [{ code: '110505', name: 'Caja', balance: -50 }])],
    });
    const out = runR1(snap);
    expect(out.reclassifications).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R2 — Flujo de Efectivo Indirecto
// ---------------------------------------------------------------------------

describe('R2 — Flujo Efectivo Método Indirecto', () => {
  it('retorna findings vacío sin comparativo', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ utilidadNeta: 100_000_000 }),
      classes: [],
    });
    const out = runR2(snap, null);
    expect(out.cashFlowIndirecto).toBeUndefined();
    expect(out.findings).toHaveLength(0);
  });

  it('genera flujo indirecto con comparativo y reconcilia con Δ caja', () => {
    const prev = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        efectivoCuenta11: 100_000_000,
        utilidadNeta: 0,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
      ],
    });
    const curr = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_200_000_000,
        efectivoCuenta11: 150_000_000,
        utilidadNeta: 50_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 150_000_000 }]),
      ],
    });
    const out = runR2(curr, prev);
    expect(out.cashFlowIndirecto).toBeDefined();
    expect(out.cashFlowIndirecto!.inferred).toBe(true);
    expect(out.cashFlowIndirecto!.observedChangeInCash).toBe(50_000_000);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].code).toBe('CUR-R2');
  });

  it('marca reconciled=false si la brecha excede tolerancia', () => {
    const prev = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({ efectivoCuenta11: 100_000_000 }),
      classes: [],
    });
    const curr = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        efectivoCuenta11: 1_000_000_000, // salto enorme sin justificación
        utilidadNeta: 1_000_000,
      }),
      classes: [],
    });
    const out = runR2(curr, prev);
    expect(out.cashFlowIndirecto?.reconciled).toBe(false);
    expect(out.findings[0].severity).toBe('alto');
  });
});

// ---------------------------------------------------------------------------
// R3 — Brecha de cuadratura con cuenta atípica
// ---------------------------------------------------------------------------

describe('R3 — Brecha de Cuadratura con Atribución', () => {
  it('no dispara si la ecuación cuadra dentro de tolerancia', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
      }),
      classes: [],
    });
    const out = runR3(snap, null);
    expect(out.balanceGapAttribution).toBeUndefined();
    expect(out.findings).toHaveLength(0);
  });

  it('emite finding crítico sin atribución cuando no hay comparativo', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 500_000_000,
        patrimonio: 50_000_000, // descuadre material
      }),
      classes: [],
    });
    const out = runR3(snap, null);
    expect(out.balanceGapAttribution).toBeUndefined();
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe('critico');
  });

  it('atribuye descuadre a cuenta con mayor z-score y monto comparable', () => {
    const prev = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
      }),
      classes: [
        makeClass(1, [
          { code: '130505', name: 'Clientes', balance: 100_000_000 },
          { code: '130510', name: 'Otros deudores', balance: 80_000_000 },
          { code: '110505', name: 'Caja', balance: 200_000_000 },
        ]),
      ],
    });
    const curr = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_456_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000, // gap = 456M
      }),
      classes: [
        makeClass(1, [
          { code: '130505', name: 'Clientes', balance: 556_000_000 }, // Δ=456M, +456%
          { code: '130510', name: 'Otros deudores', balance: 84_000_000 }, // +5%
          { code: '110505', name: 'Caja', balance: 210_000_000 }, // +5%
        ]),
      ],
    });
    const out = runR3(curr, prev);
    expect(out.balanceGapAttribution).toBeDefined();
    expect(out.balanceGapAttribution!.accountCode).toBe('130505');
    expect(out.balanceGapAttribution!.amountCop).toBe(456_000_000);
    expect(Math.abs(out.balanceGapAttribution!.zScore)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// R4 — Validación de provisión de renta
// ---------------------------------------------------------------------------

describe('R4 — Riesgo de Pasivo Fiscal Oculto', () => {
  it('emite finding crítico cuando provisión < 30% de utilidad neta', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        utilidadNeta: 2_000_000_000,
        impuestosCuenta24: 3_800_000, // 0.19% — muy bajo
      }),
      classes: [],
    });
    const out = runR4(snap);
    expect(out.taxProvisionRisk).toBeDefined();
    expect(out.taxProvisionRisk!.severidad).toBe('critico');
    expect(out.taxProvisionRisk!.expectedProvisionCop).toBe(700_000_000);
    expect(out.taxProvisionRisk!.gapCop).toBeCloseTo(696_200_000, -3);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].code).toBe('CUR-R4');
  });

  it('no dispara cuando la provisión cubre 35% (ratio = 1)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        utilidadNeta: 2_000_000_000,
        impuestosCuenta24: 700_000_000, // 35%
      }),
      classes: [],
    });
    const out = runR4(snap);
    expect(out.taxProvisionRisk).toBeUndefined();
    expect(out.findings).toHaveLength(0);
  });

  it('no dispara cuando utilidadNeta = 0 (evita div/0)', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        utilidadNeta: 0,
        impuestosCuenta24: 0,
      }),
      classes: [],
    });
    const out = runR4(snap);
    expect(out.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

describe('runCurator (orchestrator)', () => {
  it('retorna CuratorResult con findings agregados de R1, R3 y R4', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 500_000_000,
        patrimonio: 100_000_000,
        utilidadNeta: 2_000_000_000,
        impuestosCuenta24: 3_800_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: -10_000_000 }]),
      ],
    });
    const out = runCurator(snap, null);
    expect(out.findings.length).toBeGreaterThanOrEqual(3);
    const codes = out.findings.map((f) => f.code);
    expect(codes).toContain('CUR-R1');
    expect(codes).toContain('CUR-R3');
    expect(codes).toContain('CUR-R4');
    expect(out.reclassifications).toHaveLength(1);
    expect(out.taxProvisionRisk).toBeDefined();
    expect(Object.keys(out.errors)).toHaveLength(0);
  });

  it('captura errores por regla individualmente sin romper a las otras', () => {
    // Forzamos un snapshot mal formado (classes undefined castea a never).
    const broken = {
      period: '2026',
      classes: undefined as unknown as PUCClass[],
      controlTotals: makeControlTotals({ utilidadNeta: 1_000_000_000, impuestosCuenta24: 0 }),
      equityBreakdown: {},
      summary: {
        totalAssets: 0, totalLiabilities: 0, totalEquity: 0,
        totalRevenue: 0, totalExpenses: 0, totalCosts: 0, totalProduction: 0,
        netIncome: 0, equationBalance: 0, equationBalanced: true,
      },
      validation: makeValidation(),
      discrepancies: [],
      missingExpectedAccounts: [],
    } as PeriodSnapshot;
    const out = runCurator(broken, null);
    // R1 falla porque accede a classes.find(...).
    expect(out.errors['CUR-R1']).toBeDefined();
    // R4 sí funciona aunque classes esté roto (no las usa).
    expect(out.taxProvisionRisk).toBeDefined();
    expect(out.findings.some((f) => f.code === 'CUR-R4')).toBe(true);
  });

  it('es inmutable: no muta el snapshot original', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        utilidadNeta: 1_000_000_000,
        impuestosCuenta24: 100_000_000,
      }),
      classes: [makeClass(1, [{ code: '110505', name: 'Caja', balance: -1_000_000 }])],
    });
    const before = JSON.stringify(snap);
    runCurator(snap, null);
    expect(JSON.stringify(snap)).toBe(before);
  });
});

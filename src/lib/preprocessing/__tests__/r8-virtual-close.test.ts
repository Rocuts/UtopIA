// ---------------------------------------------------------------------------
// R8 — Cierre Virtual (Autonomía de Cierre): tests unitarios
// ---------------------------------------------------------------------------
// Cubre los seis escenarios funcionales del contrato:
//   1. Balance ERP a mitad de año (descuadrado por utilidad transitoria).
//   2. Balance post-cierre con 3605 = utilidad dinámica (no reclasifica).
//   3. Conflicto 3605 histórico vs utilidad dinámica (reclasifica a 3710VC).
//   4. Pérdida del periodo (utilidad negativa).
//   5. Idempotencia: 2 corridas → mismo resultado.
//   6. Centavos: gap marginal absorbido en 3710VC.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { runR8 } from '../curator-rules/r8-virtual-close';
import type {
  ControlTotals,
  EquityBreakdown,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '../trial-balance';

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
  const ct = opts.controlTotals;
  return {
    period: opts.period,
    classes: opts.classes,
    controlTotals: ct,
    equityBreakdown: opts.equity ?? {},
    summary: {
      totalAssets: ct.activo,
      totalLiabilities: ct.pasivo,
      totalEquity: ct.patrimonio,
      totalRevenue: ct.ingresos,
      totalExpenses: 0,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: ct.utilidadNeta,
      equationBalance: ct.activo - (ct.pasivo + ct.patrimonio),
      equationBalanced: Math.abs(ct.activo - (ct.pasivo + ct.patrimonio)) < 100,
    },
    validation: makeValidation(),
    discrepancies: [],
    missingExpectedAccounts: [],
  };
}

describe('R8 — Cierre Virtual (Autonomía de Cierre)', () => {
  // -------------------------------------------------------------------------
  // Escenario 1: ERP a mitad de año — utilidad atrapada en clases 4-7
  // -------------------------------------------------------------------------
  it('ERP a mitad de año: traslada utilidad transitoria al patrimonio y cuadra la ecuación', () => {
    // Activo 1.000M | Pasivo 600M | Patrimonio (sólo capital) 200M | Utilidad 200M
    // Pre-R8: 1.000 ≠ 600 + 200 (descuadre = 200M = utilidad)
    const snap = makeSnapshot({
      period: '2026-05',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 200_000_000, // sólo capital
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [{ code: '3115', name: 'Capital', balance: 200_000_000 }]),
      ],
      equity: { capitalSuscritoPagado: 200_000_000 },
    });

    const out = runR8(snap);

    // Patrimonio post-R8 = 200M capital + 200M utilidad = 400M.
    expect(snap.controlTotals.patrimonio).toBe(400_000_000);
    expect(snap.summary.totalEquity).toBe(400_000_000);
    expect(snap.summary.equationBalanced).toBe(true);

    // Cuenta virtual 3605VC inyectada con 200M.
    const clase3 = snap.classes.find((c) => c.code === 3)!;
    const v3605 = clase3.accounts.find((a) => a.code === '3605VC');
    expect(v3605).toBeDefined();
    expect(v3605!.balance).toBe(200_000_000);
    expect(v3605!.name).toBe('Resultado del Ejercicio (Corte Actual)');

    // No hubo reclasificación (no había 3605 previo).
    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(false);
    expect(out.virtualCloseAdjustment.dynamicNetIncome).toBe(200_000_000);
    expect(out.virtualCloseAdjustment.reconciledEquity).toBe(400_000_000);

    // EquityBreakdown sincronizado.
    expect(snap.equityBreakdown.utilidadEjercicio).toBe(200_000_000);

    // Finding informativo (siempre aplica por diseño).
    expect(out.findings.some((f) => f.severity === 'informativo')).toBe(true);
    // No finding de severidad media (no hubo reclasificación).
    expect(out.findings.some((f) => f.severity === 'medio')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Escenario 2: Balance post-cierre (3605 ya = utilidad dinámica)
  // -------------------------------------------------------------------------
  it('post-cierre: 3605 ya cuadra con utilidad dinámica, no reclasifica', () => {
    const snap = makeSnapshot({
      period: '2026-12',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000, // capital + utilidad
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [
          { code: '3115', name: 'Capital', balance: 200_000_000 },
          { code: '360505', name: 'Utilidad ejercicio', balance: 200_000_000 },
        ]),
      ],
    });

    const out = runR8(snap);

    // El gap entre 3605 (200M) y dinámica (200M) es 0 → no reclasifica.
    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(false);
    expect(out.virtualCloseAdjustment.utilidadGap).toBe(0);

    // Patrimonio sigue cuadrando (400M).
    expect(snap.controlTotals.patrimonio).toBe(400_000_000);
    expect(snap.summary.equationBalanced).toBe(true);

    // R8 igual inyecta 3605VC con la dinámica (idempotencia + autoritativo).
    const clase3 = snap.classes.find((c) => c.code === 3)!;
    expect(clase3.accounts.find((a) => a.code === '3605VC')!.balance).toBe(200_000_000);

    // El 360505 original sigue ahí con su saldo: lo que SUMARÍA doble el
    // patrimonio. Pero R8 sólo reescribe equityBreakdown y deja la cuenta
    // contable original intacta cuando coincide. La validación por agentes
    // detecta la duplicación si aparece. Para evitar la duplicación, el
    // controlador se basa en utilidadEjercicio del breakdown (autoritativo).
    // Verificamos que el breakdown sea coherente:
    expect(snap.equityBreakdown.utilidadEjercicio).toBe(200_000_000);
  });

  // -------------------------------------------------------------------------
  // Escenario 3: Conflicto — 3605 histórico ≠ utilidad dinámica
  // -------------------------------------------------------------------------
  it('conflicto: 3605 histórico se reclasifica a 3710VC y se inyecta utilidad dinámica', () => {
    // Activo 1.000M | Pasivo 600M | Patrimonio (200M capital + 150M en 3605 viejo) = 350M
    // Pre-R8 cuadra crudo: 1.000 = 600 + 350 + 50 (50M en otras cuentas... pongamos 50M en 3705)
    // Para simplificar: 1.000 = 600 + 400 (200 capital + 150 en 3605 viejo + 50 en 3705)
    // Utilidad dinámica del periodo actual = 200M (≠ 150M en 3605 viejo)
    const snap = makeSnapshot({
      period: '2026-08',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [
          { code: '3115', name: 'Capital', balance: 200_000_000 },
          { code: '360505', name: 'Utilidad ejercicio (histórico)', balance: 150_000_000 },
          { code: '3705', name: 'Utilidades acumuladas', balance: 50_000_000 },
        ]),
      ],
    });

    const out = runR8(snap);

    // Reclasificación detectada.
    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(true);
    expect(out.virtualCloseAdjustment.csvUtilidadEjercicio).toBe(150_000_000);
    expect(out.virtualCloseAdjustment.dynamicNetIncome).toBe(200_000_000);

    const clase3 = snap.classes.find((c) => c.code === 3)!;

    // 3605 original anulado a 0.
    expect(clase3.accounts.find((a) => a.code === '360505')!.balance).toBe(0);

    // 3605VC con utilidad dinámica.
    expect(clase3.accounts.find((a) => a.code === '3605VC')!.balance).toBe(200_000_000);

    // 3710VC absorbe el residual: balance crudo cuadraba (1.000 = 600 + 400),
    // pero al reemplazar 3605 viejo (150M) por dinámica (200M) el patrimonio
    // sube 50M → 3710VC = -50M para mantener cuadre. La reclassifiedAmount
    // (audit trail) sí guarda los 150M originales.
    const v3710 = clase3.accounts.find((a) => a.code === '3710VC');
    expect(v3710).toBeDefined();
    expect(v3710!.balance).toBe(-50_000_000);

    // Audit trail conserva el monto histórico para el auditor.
    expect(out.virtualCloseAdjustment.reclassifiedAmount).toBe(150_000_000);

    // Patrimonio cuadra: 200 (capital) + 0 (3605 anulado) + 50 (3705) + 200 (3605VC) - 50 (3710VC) = 400M
    expect(snap.controlTotals.patrimonio).toBe(400_000_000);
    expect(snap.summary.equationBalanced).toBe(true);

    // Finding 'medio' por la reclasificación material (auditor revisa).
    expect(out.findings.some((f) => f.severity === 'medio')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Escenario 4: Pérdida del periodo
  // -------------------------------------------------------------------------
  it('pérdida del periodo: 3605VC con saldo negativo, patrimonio se reduce', () => {
    const snap = makeSnapshot({
      period: '2026-05',
      controlTotals: makeControlTotals({
        activo: 800_000_000,
        pasivo: 600_000_000,
        patrimonio: 300_000_000, // capital
        ingresos: 500_000_000,
        gastos: 600_000_000,
        utilidadNeta: -100_000_000, // pérdida
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 800_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [{ code: '3115', name: 'Capital', balance: 300_000_000 }]),
      ],
    });

    const out = runR8(snap);

    // 3605VC con saldo NEGATIVO (preserva signo, no se aplica abs).
    const v3605 = snap.classes.find((c) => c.code === 3)!.accounts.find((a) => a.code === '3605VC')!;
    expect(v3605.balance).toBe(-100_000_000);

    // Patrimonio post-R8 = 300M capital - 100M pérdida = 200M.
    expect(snap.controlTotals.patrimonio).toBe(200_000_000);
    expect(snap.summary.equationBalanced).toBe(true); // 800 = 600 + 200
    expect(out.virtualCloseAdjustment.dynamicNetIncome).toBe(-100_000_000);
  });

  // -------------------------------------------------------------------------
  // Escenario 5: Idempotencia
  // -------------------------------------------------------------------------
  it('idempotencia: dos corridas dejan el snapshot en el mismo estado', () => {
    const snap = makeSnapshot({
      period: '2026-05',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 200_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [{ code: '3115', name: 'Capital', balance: 200_000_000 }]),
      ],
    });

    runR8(snap);
    const patrimonioPrimera = snap.controlTotals.patrimonio;
    const accountsLenPrimera = snap.classes.find((c) => c.code === 3)!.accounts.length;

    runR8(snap);
    const patrimonioSegunda = snap.controlTotals.patrimonio;
    const accountsLenSegunda = snap.classes.find((c) => c.code === 3)!.accounts.length;

    expect(patrimonioPrimera).toBe(patrimonioSegunda);
    expect(accountsLenPrimera).toBe(accountsLenSegunda); // no duplica 3605VC
  });

  // -------------------------------------------------------------------------
  // Escenario 6: Centavos — gap marginal absorbido
  // -------------------------------------------------------------------------
  it('absorbe diferencia residual de centavos en 3710VC', () => {
    // Balance descuadrado por $237 COP (redondeo acumulado): pre-R8 patrimonio
    // 200M capital + 200M utilidad calculada por inyección = 400M. Si el activo
    // es 1.000.000.237 (con cola de centavos), el gap residual son $237.
    const snap = makeSnapshot({
      period: '2026-05',
      controlTotals: makeControlTotals({
        activo: 1_000_000_237,
        pasivo: 600_000_000,
        patrimonio: 200_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_237 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [{ code: '3115', name: 'Capital', balance: 200_000_000 }]),
      ],
    });

    const out = runR8(snap);

    // 3710VC absorbe los $237.
    const v3710 = snap.classes.find((c) => c.code === 3)!.accounts.find((a) => a.code === '3710VC');
    expect(v3710).toBeDefined();
    expect(v3710!.balance).toBe(237);

    // Ecuación cuadra al centavo.
    expect(snap.summary.equationBalanced).toBe(true);
    expect(out.virtualCloseAdjustment.centsAdjustment).toBe(237);
  });
});

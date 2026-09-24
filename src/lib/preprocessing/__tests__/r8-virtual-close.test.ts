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
  it('3605 histórico (año anterior sin trasladar) se reclasifica a 3710VC y la ecuación cuadra sin residual', () => {
    // Pasivo 600M | Capital 200M + 3605 (año ANTERIOR) 150M + 3705 50M = 400M
    // Utilidad dinámica del periodo = 200M, aún en clases 4-7.
    // Activo = 600 + 400 + 200 (utilidad sin trasladar) = 1.200M.
    const snap = makeSnapshot({
      period: '2026-08',
      controlTotals: makeControlTotals({
        activo: 1_200_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_200_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [
          { code: '3115', name: 'Capital', balance: 200_000_000 },
          { code: '360505', name: 'Utilidad ejercicio (histórico)', balance: 150_000_000 },
          { code: '3705', name: 'Utilidades acumuladas', balance: 50_000_000 },
        ]),
      ],
      equity: { capitalSuscritoPagado: 200_000_000, utilidadEjercicio: 150_000_000, utilidadesAcumuladas: 50_000_000 },
    });

    const out = runR8(snap);

    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(true);
    expect(out.virtualCloseAdjustment.csvUtilidadEjercicio).toBe(150_000_000);
    expect(out.virtualCloseAdjustment.dynamicNetIncome).toBe(200_000_000);

    const clase3 = snap.classes.find((c) => c.code === 3)!;
    expect(clase3.accounts.find((a) => a.code === '360505')!.balance).toBe(0);
    expect(clase3.accounts.find((a) => a.code === '3605VC')!.balance).toBe(200_000_000);
    // 3710VC recibe SÓLO la reclasificación del resultado anterior.
    expect(clase3.accounts.find((a) => a.code === '3710VC')!.balance).toBe(150_000_000);
    expect(out.virtualCloseAdjustment.reclassifiedAmount).toBe(150_000_000);
    expect(out.virtualCloseAdjustment.centsAdjustment).toBe(0);

    // 200 + 50 + 200 + 150 = 600M; 1.200 = 600 + 600.
    expect(snap.controlTotals.patrimonio).toBe(600_000_000);
    expect(snap.summary.equationBalanced).toBe(true);
    expect(snap.validation.blocking).toBe(false);
    // El resultado anterior reclasificado es "resultado de ejercicios anteriores".
    expect(snap.equityBreakdown.utilidadEjercicio).toBe(200_000_000);
    expect(snap.equityBreakdown.utilidadesAcumuladas).toBe(200_000_000);

    expect(out.findings.some((f) => f.severity === 'medio')).toBe(true);
    expect(out.findings.some((f) => f.severity === 'critico')).toBe(false);
  });

  it('conflicto: balance que ya cuadraba sin el P&G (3605 ≠ utilidad) → residual BLOQUEANTE, no se absorbe', () => {
    // 1.000 = 600 + 400 (200 capital + 150 en 3605 + 50 en 3705) y además hay
    // P&G de 200M en clases 4-7. El P&G no tiene contrapartida en el balance:
    // la versión anterior de R8 escondía la diferencia en 3710VC (−50M).
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
    const v = out.virtualCloseAdjustment;

    // Ninguna cifra no explicada entra al patrimonio como "resultados acumulados".
    expect(v.centsAdjustment).toBe(0);
    expect(v.blocking).toBe(true);
    // 1.000 − 600 − (200 + 50 + 200 + 150) = −200M: el P&G ya estaba "dentro".
    expect(v.unexplainedResidual).toBe(-200_000_000);
    expect(v.unexplainedResidualRaw).toBe('-200000000.00');
    expect(snap.summary.equationBalanced).toBe(false);
    expect(snap.validation.blocking).toBe(true);
    expect(snap.validation.curatorBlockingReasons?.some((r) => r.includes('-200.000.000,00'))).toBe(true);
    const critico = out.findings.find((f) => f.severity === 'critico');
    expect(critico?.description).toMatch(/ya cuadraba SIN el resultado/);
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
  it('residual distinto de cero (aun de $237,01) NO se absorbe en 3710VC: queda BLOQUEANTE con el monto', () => {
    // Auditoría 2026-09 (niif-preproceso-06): la versión anterior llevaba
    // cualquier residual a 3710VC. Una diferencia no explicada por el
    // resultado del ejercicio es un descuadre del archivo, no patrimonio.
    const snap = makeSnapshot({
      period: '2026-05',
      controlTotals: makeControlTotals({
        activo: 1_000_000_237.01,
        pasivo: 600_000_000,
        patrimonio: 200_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_237.01 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [{ code: '3115', name: 'Capital', balance: 200_000_000 }]),
      ],
    });

    const out = runR8(snap);

    const v3710 = snap.classes.find((c) => c.code === 3)!.accounts.find((a) => a.code === '3710VC');
    expect(v3710).toBeUndefined();
    expect(out.virtualCloseAdjustment.centsAdjustment).toBe(0);
    expect(out.virtualCloseAdjustment.unexplainedResidualRaw).toBe('237.01');
    expect(out.virtualCloseAdjustment.blocking).toBe(true);
    // La ecuación NO se declara cuadrada y el monto exacto viaja al usuario.
    expect(snap.summary.equationBalanced).toBe(false);
    expect(snap.summary.equationBalance).toBe(237.01);
    expect(snap.validation.blocking).toBe(true);
    expect(snap.validation.curatorBlockingReasons).toHaveLength(1);
    expect(snap.validation.curatorBlockingReasons![0]).toMatch(/^\[CUR-R8\] .*237,01/);
    expect(out.findings.some((f) => f.code === 'CUR-R8' && f.severity === 'critico')).toBe(true);

    // Idempotente: una segunda corrida no duplica la razón bloqueante.
    runR8(snap);
    expect(snap.validation.curatorBlockingReasons).toHaveLength(1);
    expect(snap.validation.reasons.filter((r) => r.startsWith('[CUR-R8]'))).toHaveLength(1);
  });

  it('3605 del año anterior que coincide por azar con la utilidad del año: se reclasifica (la brecha lo prueba)', () => {
    // Capital 400 + 3605 (año anterior) 200; utilidad del año 200 aún en
    // clases 4-7 → Activo = 500 (pasivo) + 600 + 200 = 1.300. Si R8 tomara el
    // 3605 como "el resultado del periodo" dejaría un residual de 200M.
    const snap = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        activo: 1_300_000_000,
        pasivo: 500_000_000,
        patrimonio: 600_000_000,
        ingresos: 900_000_000,
        gastos: 700_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_300_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 500_000_000 }]),
        makeClass(3, [
          { code: '310505', name: 'Capital', balance: 400_000_000 },
          { code: '360505', name: 'Utilidad 2024', balance: 200_000_000 },
        ]),
      ],
    });
    const out = runR8(snap);
    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(true);
    expect(out.virtualCloseAdjustment.blocking).toBe(false);
    expect(snap.controlTotals.patrimonio).toBe(800_000_000);
    expect(snap.summary.equationBalanced).toBe(true);
  });

  it('idempotencia con reclasificación del grupo 36: la segunda corrida no inventa residual', () => {
    const snap = makeSnapshot({
      period: '2026-08',
      controlTotals: makeControlTotals({
        activo: 1_200_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_200_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'Bancos CP', balance: 600_000_000 }]),
        makeClass(3, [
          { code: '3115', name: 'Capital', balance: 200_000_000 },
          { code: '360505', name: 'Utilidad 2025', balance: 150_000_000 },
          { code: '3705', name: 'Utilidades acumuladas', balance: 50_000_000 },
        ]),
      ],
      equity: { utilidadEjercicio: 150_000_000, utilidadesAcumuladas: 50_000_000 },
    });
    runR8(snap);
    const second = runR8(snap);
    expect(second.virtualCloseAdjustment.reclassifiedFrom3605).toBe(true);
    expect(second.virtualCloseAdjustment.reclassifiedAmount).toBe(150_000_000);
    expect(second.virtualCloseAdjustment.blocking).toBe(false);
    expect(snap.controlTotals.patrimonio).toBe(600_000_000);
    expect(snap.equityBreakdown.utilidadesAcumuladas).toBe(200_000_000);
    expect(snap.validation.blocking).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Grupo 36 completo: 3610 (Pérdida del ejercicio) — niif-preproceso-12
  // -------------------------------------------------------------------------
  it('pérdida del ejercicio en 3610 + P&G presente: no se duplica ni fabrica utilidad acumulada', () => {
    // Activo 800 | Pasivo 400 | Capital 500 | 3610 = −100 (pérdida del periodo)
    // P&G: 400 − 300 − 200 = −100. El balance ya trae el resultado en 3610.
    const snap = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        activo: 800_000_000,
        pasivo: 400_000_000,
        patrimonio: 400_000_000,
        ingresos: 400_000_000,
        gastos: 500_000_000,
        utilidadNeta: -100_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 800_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 400_000_000 }]),
        makeClass(3, [
          { code: '310505', name: 'Capital', balance: 500_000_000 },
          { code: '361005', name: 'Perdida del ejercicio', balance: -100_000_000 },
        ]),
      ],
      equity: { capitalSuscritoPagado: 500_000_000, utilidadEjercicio: -100_000_000 },
    });

    const out = runR8(snap);
    const acc3 = snap.classes.find((c) => c.code === 3)!.accounts;

    expect(out.virtualCloseAdjustment.csvUtilidadEjercicio).toBe(-100_000_000);
    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(false);
    expect(acc3.find((a) => a.code === '361005')!.balance).toBe(0);
    expect(acc3.find((a) => a.code === '3605VC')!.balance).toBe(-100_000_000);
    expect(acc3.find((a) => a.code === '3710VC')).toBeUndefined();
    expect(snap.controlTotals.patrimonio).toBe(400_000_000);
    expect(snap.summary.equationBalanced).toBe(true);
    expect(snap.equityBreakdown.utilidadEjercicio).toBe(-100_000_000);
    expect(snap.equityBreakdown.utilidadesAcumuladas).toBeUndefined();
    expect(out.findings.some((f) => f.severity === 'alto' || f.severity === 'critico')).toBe(false);
  });

  it('3610 con la pérdida del año ANTERIOR: se reclasifica a resultados acumulados (Art. 151 la ve)', () => {
    // Capital 500 | 3610 = −80 (pérdida 2024 sin trasladar) | P&G 2025 = +30 abierto.
    // Activo = 300 (pasivo) + 500 − 80 + 30 = 750.
    const snap = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({
        activo: 750_000_000,
        pasivo: 300_000_000,
        patrimonio: 420_000_000,
        ingresos: 130_000_000,
        gastos: 100_000_000,
        utilidadNeta: 30_000_000,
      }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 750_000_000 }]),
        makeClass(2, [{ code: '220505', name: 'Proveedores', balance: 300_000_000 }]),
        makeClass(3, [
          { code: '310505', name: 'Capital', balance: 500_000_000 },
          { code: '361005', name: 'Perdida del ejercicio 2024', balance: -80_000_000 },
        ]),
      ],
      equity: { capitalSuscritoPagado: 500_000_000, utilidadEjercicio: -80_000_000 },
    });

    const out = runR8(snap);
    expect(out.virtualCloseAdjustment.reclassifiedFrom3605).toBe(true);
    expect(out.virtualCloseAdjustment.reclassifiedAmount).toBe(-80_000_000);
    expect(out.virtualCloseAdjustment.blocking).toBe(false);
    expect(snap.summary.equationBalanced).toBe(true);
    expect(snap.equityBreakdown.utilidadEjercicio).toBe(30_000_000);
    expect(snap.equityBreakdown.utilidadesAcumuladas).toBe(-80_000_000);
  });
});

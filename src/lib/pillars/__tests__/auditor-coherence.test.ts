// ---------------------------------------------------------------------------
// Tests de coherencia para Revisor Fiscal / Auditor (cierre de la épica)
// ---------------------------------------------------------------------------
// Verifica los 2 escenarios canónicos del prompt CFO:
//
//   1. PARTIDA CONCILIATORIA RETEFUENTE: si la cuenta 2365 (Retención en la
//      fuente) tiene saldo anómalo (signo invertido o monto material), la
//      ventana VERDAD lo detecta como descalce — no permite emitir reportes
//      oficiales hasta resolverlo.
//
//   2. COHERENCIA CROSS-PILLAR: la utilidadNeta canonical del snapshot debe
//      ser idéntica en VALOR.audit, ESCUDO.audit (vía rentaTeorica/0.35),
//      FUTURO.audit (vía utilidadProyectadaAnual / (1+CAGR)) y la ecuación
//      de VERDAD. Si CAGR es 0 (sin comparativo), el delta debe ser 0.
//
// Estos tests son el "vendido seguro" para que un Revisor Fiscal firme.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { aggregatePillars } from '../service';
import { validateCrossPillarCoherence } from '../single-source-validator';
import { computeVerdadExecutiveCards } from '../verdad-cards';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';

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
  accounts: Array<{ code: string; name: string; balance: number }>,
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
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  };
}

function makeSnapshot(
  ct: ControlTotals,
  classes: PUCClass[],
): PeriodSnapshot {
  return {
    period: '2026',
    classes,
    controlTotals: ct,
    equityBreakdown: {},
    summary: {
      totalAssets: ct.activo,
      totalLiabilities: ct.pasivo,
      totalEquity: ct.patrimonio,
      totalRevenue: ct.ingresos,
      totalExpenses: ct.gastos,
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

// ---------------------------------------------------------------------------
// 1. PARTIDA CONCILIATORIA RETEFUENTE (cuenta 2365)
// ---------------------------------------------------------------------------

describe('Auditor — Partida conciliatoria Retefuente cuenta 2365', () => {
  it('cuenta 2365 con signo invertido (saldo débito en pasivo) → VERDAD detecta saldosPositivosPasivo > 0', () => {
    // Cuenta 2365 (Retefuente) es un PASIVO. Signo natural CRÉDITO (negativo
    // en accounting). Si trae saldo DÉBITO (positivo), es una incoherencia
    // contable que el auditor debe revisar antes de presentar a la DIAN.
    const snap = makeSnapshot(
      makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 200_000_000,
        patrimonio: 800_000_000,
        ingresos: 500_000_000,
        gastos: 300_000_000,
        utilidadNeta: 200_000_000,
      }),
      [
        makeClass(1, [
          { code: '110505', name: 'Caja', balance: 1_000_000_000 },
        ]),
        makeClass(2, [
          { code: '230505', name: 'CxP comerciales', balance: -200_000_000 }, // signo correcto
          // 2365 con signo INVERTIDO: pasivo con saldo débito → anomalía.
          { code: '2365', name: 'Retención en la fuente', balance: 5_000_000 },
        ]),
        makeClass(3, [
          { code: '3105', name: 'Capital', balance: -800_000_000 },
        ]),
      ],
    );

    const cards = computeVerdadExecutiveCards({ snapshot: snap });

    // VERDAD detecta el signo positivo (anómalo) en cuenta de pasivo.
    expect(cards.audit.saldosPositivosPasivo).toBeGreaterThanOrEqual(1);
    // El score de Consistencia debe estar por debajo de 100% (no perfecto).
    expect(cards.consistencia.value).not.toBeNull();
    expect(cards.consistencia.value!).toBeLessThan(100);
  });

  it('descalce material en 2365 vs total pasivo → Salud Contable acumula error', () => {
    // Snapshot con cuenta 2365 muy material que rompe la coherencia: el
    // pasivo crudo (200M) no incluye el saldo de 2365 → discrepancia
    // documentada en preprocessing.
    const snap = makeSnapshot(
      makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 200_000_000,
        patrimonio: 800_000_000,
        ingresos: 500_000_000,
        gastos: 300_000_000,
        utilidadNeta: 200_000_000,
      }),
      [
        makeClass(1, [
          { code: '110505', name: 'Caja', balance: 1_000_000_000 },
        ]),
        makeClass(2, [
          { code: '230505', name: 'CxP', balance: -200_000_000 },
          { code: '2365', name: 'Retefuente', balance: 50_000_000 }, // material
        ]),
      ],
    );

    // Inyectamos discrepancias del preprocessing para simular que el sistema
    // detectó el descalce de 2365 al cuadrar la ecuación.
    snap.discrepancies = [
      {
        location: 'Cuenta 2365 — Retención en la fuente',
        reported: -50_000_000, // signo natural esperado (crédito)
        calculated: 50_000_000,
        difference: 100_000_000,
        description: 'Cuenta 2365 tiene saldo débito; debería ser crédito.',
      },
    ];
    // Y reclasificaciones aplicadas por R1 (típicamente cuando saldo no cuadra).
    snap.reclassifications = [
      {
        accountCode: '2365',
        accountName: 'Retención en la fuente',
        originalBalanceCop: 50_000_000,
        reclassifiedToCode: '2810ZZ-2365',
        reclassifiedToName: 'Otros pasivos transitorios',
        amountCop: 50_000_000,
        justification: 'Saldo débito en pasivo (NIC 1 párr. 32)',
        applied: true,
        effectiveTransferCop: 50_000_000,
        balanceFootnoteText: 'Reclasificado por signo inverso',
      },
    ];

    const cards = computeVerdadExecutiveCards({ snapshot: snap });

    // Salud Contable acumula: 0 críticos×3 + 0 altos + 1 discrepancia + 1 reclasificación = 2
    expect(cards.salud_contable.value).toBe(2);
    expect(cards.audit.discrepanciasPreprocessing).toBe(1);
    expect(cards.audit.reclasificacionesR1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. COHERENCIA CROSS-PILLAR (Bus de Datos Financiero)
// ---------------------------------------------------------------------------

describe('Auditor — Coherencia cross-pillar (utilidadNeta única)', () => {
  it('los 4 pilares derivan la MISMA utilidadNeta del snapshot canonical', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
        efectivoCuenta11: 300_000_000,
        impuestosCuenta24: 70_000_000, // = 200M × 35%
      }),
      [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 300_000_000 }]),
        makeClass(2, [{ code: '210505', name: 'CxP', balance: -600_000_000 }]),
        makeClass(3, [{ code: '3105', name: 'Capital', balance: -400_000_000 }]),
        makeClass(4, [{ code: '413505', name: 'Ventas', balance: -800_000_000 }]),
        makeClass(5, [{ code: '519505', name: 'Gastos', balance: 600_000_000 }]),
      ],
    );

    const metrics = aggregatePillars({ snapshot: snap });
    const report = validateCrossPillarCoherence(metrics, snap);

    // Sin comparative, todas las cards derivables deben converger al mismo
    // utilidadNeta = 200M dentro de tolerancia $1.000.
    expect(report.consistent).toBe(true);
    expect(report.severity).toBe('ok');
    expect(report.findings).toHaveLength(0);
  });

  it('hash canonical determinístico: mismas cifras → mismo hash', () => {
    const snap1 = makeSnapshot(
      makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      [],
    );
    const snap2 = makeSnapshot(
      makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 800_000_000,
        gastos: 600_000_000,
        utilidadNeta: 200_000_000,
      }),
      [],
    );

    const m1 = aggregatePillars({ snapshot: snap1 });
    const m2 = aggregatePillars({ snapshot: snap2 });
    const r1 = validateCrossPillarCoherence(m1, snap1);
    const r2 = validateCrossPillarCoherence(m2, snap2);

    expect(r1.canonicalHash).toBe(r2.canonicalHash);
    expect(r1.canonicalHash.length).toBeGreaterThan(0);
  });

  it('FUTURO crecimiento coherente con ESCUDO caja: si caja proyectada cae, autonomía baja', () => {
    // Snapshot pequeño con caja al límite. Verifica que FUTURO y ESCUDO
    // no se contradigan: si FUTURO predice quiebre temprano, ESCUDO no
    // puede mostrar autonomía cómoda.
    const snap = makeSnapshot(
      makeControlTotals({
        activo: 100_000_000,
        pasivo: 50_000_000,
        patrimonio: 50_000_000,
        ingresos: 200_000_000, // 16.7M/mes
        gastos: 240_000_000,   // 20M/mes — más que ingresos
        utilidadNeta: -40_000_000,
        efectivoCuenta11: 50_000_000,
      }),
      [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 50_000_000 }]),
      ],
    );

    const metrics = aggregatePillars({ snapshot: snap });

    // ESCUDO: autonomía baja por egresos > caja (50M / 20M = ~2.5 meses ≈ 75 días).
    expect(metrics.escudo.escudoCards).toBeDefined();
    const autoDays = metrics.escudo.escudoCards!.autonomia.value;
    expect(autoDays).not.toBeNull();
    expect(autoDays!).toBeLessThan(120); // <4 meses

    // FUTURO: punto de quiebre < 12 meses bajo escenario conservador.
    expect(metrics.futuro.futuroCards).toBeDefined();
    const punto = metrics.futuro.futuroCards!.punto_quiebre.value;
    expect(punto).not.toBeNull();
    expect(punto!).toBeLessThan(12);

    // CONGRUENCIA: si ESCUDO dice ~75 días, FUTURO no puede decir "sin riesgo".
    // Y si FUTURO dice <12 meses, ESCUDO no puede ser healthy.
    expect(metrics.escudo.escudoCards!.autonomia.status).not.toBe('healthy');
    expect(metrics.futuro.futuroCards!.punto_quiebre.status).not.toBe('healthy');
  });

  it('CapEx event impacta coherentemente FUTURO y ESCUDO', () => {
    const snap = makeSnapshot(
      makeControlTotals({
        activo: 500_000_000,
        pasivo: 100_000_000,
        patrimonio: 400_000_000,
        ingresos: 600_000_000,
        gastos: 400_000_000,
        utilidadNeta: 200_000_000,
        efectivoCuenta11: 300_000_000,
      }),
      [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 300_000_000 }]),
      ],
    );

    // Sin CapEx
    const sinCapex = aggregatePillars({ snapshot: snap });

    // Con CapEx grande próximo (mes 3, $250M)
    const conCapex = aggregatePillars({
      snapshot: snap,
      capexEvents: [
        {
          id: 'cap-1',
          name: 'Compra Maquinaria',
          monthOffset: 3,
          amountCop: 250_000_000,
        },
      ],
    });

    // ESCUDO: brecha + autonomía deben empeorar con el CapEx.
    expect(conCapex.escudo.escudoCards!.brecha_escudo.value!).toBeLessThan(
      sinCapex.escudo.escudoCards!.brecha_escudo.value!,
    );
    expect(conCapex.escudo.escudoCards!.audit.proyectosFuturoCop).toBe(250_000_000);
    expect(conCapex.escudo.escudoCards!.audit.cantidadEventosProximos).toBe(1);
  });
});

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
    // Pulido Diamante 2026-05-08 — la cuenta virtual ahora lleva el sufijo
    // del código original para preservar trazabilidad (`2810ZZ-<originalCode>`).
    expect(out.reclassifications[0].reclassifiedToCode).toBe('2810ZZ-110505');
    expect(out.reclassifications[0].applied).toBe(true);
    expect(out.reclassifications[0].effectiveTransferCop).toBe(50_000_000);
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
  it('infiere EFE parcial single-period (sin comparativo) y no emite finding crítico', () => {
    // Bug 3 fix (2026-05-08, r2-indirect-cashflow.ts:33): sin comparativo R2
    // ya NO retorna undefined — emite un EFE PARCIAL asumiendo prev=0 para
    // todas las variaciones, marcándolo `inferred: true` y
    // `comparativePeriod: '(sin_comparativo)'`. El finding de limitación es
    // severity 'medio', nunca 'alto', porque es dato faltante (no error).
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ utilidadNeta: 100_000_000 }),
      classes: [],
    });
    const out = runR2(snap, null);
    expect(out.cashFlowIndirecto).toBeDefined();
    expect(out.cashFlowIndirecto?.inferred).toBe(true);
    expect(out.cashFlowIndirecto?.comparativePeriod).toBe('(sin_comparativo)');
    // Cero findings 'alto/crítico' — la inferencia es legítima por diseño.
    expect(out.findings.every((f) => f.severity !== 'alto' && f.severity !== 'critico')).toBe(true);
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

  // -------------------------------------------------------------------------
  // Dividendos fabricados — auditoría 2026-08, superficie 1 (EFE, 1/10)
  // -------------------------------------------------------------------------
  // El peor número que llegaba al cliente: -$1.570.997.737,30 de "dividendos
  // estimados" (2,09× la facturación del año, 64,9% del flujo operativo)
  // inferidos de las cuentas VIRTUALES que inyecta R8, sobre un balance donde
  // la cuenta 2360 no existe. Viajaba al modelo como VINCULANTE y salía impreso
  // verbatim en la Nota 6 del informe entregado, con cita normativa de respaldo
  // y la tabla de financiación VACÍA. NIC 7 ¶43.

  it('NO infiere dividendos cuando el balance no trae evidencia (2360 / grupo 35)', () => {
    const prev = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({ efectivoCuenta11: 100_000_000, utilidadNeta: 0 }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(3, [{ code: '360505', name: 'Utilidades acumuladas', balance: 0 }]),
      ],
    });
    const curr = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ efectivoCuenta11: 100_000_000, utilidadNeta: 500_000_000 }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        // Las utilidades acumuladas NO crecen lo que la utilidad neta: la
        // fórmula vieja leía eso como "hubo distribución" y fabricaba el plug.
        makeClass(3, [{ code: '360505', name: 'Utilidades acumuladas', balance: 0 }]),
      ],
    });
    const out = runR2(curr, prev);
    expect(out.cashFlowIndirecto!.financing.dividendosEstimados).toBe(0);
    // Y el subtotal sigue siendo la suma exacta de sus renglones.
    const f = out.cashFlowIndirecto!.financing;
    expect(f.varObligacionesFinancieras + f.varCapitalReservas + f.dividendosEstimados).toBe(f.total);
  });

  it('3605VC (resultado del año que inyecta R8) no se lee como distribución', () => {
    // Auditoría 2026-09 (niif-preproceso-15): la versión anterior excluía las
    // virtuales de R8 y calculaba min(0, Δ(36+37) − utilidad del AÑO): con la
    // utilidad del año en 3605VC eso fabricaba −$500M de "dividendos" aunque
    // ni la caja ni 2360 se movieron. Con las virtuales incluidas,
    // Δ(36+37) − utilidad = −dividendos decretados = 0.
    const prev = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({ efectivoCuenta11: 100_000_000, utilidadNeta: 0 }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '236005', name: 'Dividendos por pagar', balance: 0 }]),
        makeClass(3, [{ code: '360505', name: 'Utilidades acumuladas', balance: 0 }]),
      ],
    });
    // CON evidencia (2360 presente) se calculan dividendos, pero la cuenta
    // virtual 3605VC es el resultado del año: no hay distribución.
    const curr = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ efectivoCuenta11: 100_000_000, utilidadNeta: 500_000_000 }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '236005', name: 'Dividendos por pagar', balance: 0 }]),
        makeClass(3, [
          { code: '360505', name: 'Utilidades acumuladas', balance: 0 },
          { code: '3605VC', name: 'Cierre virtual R8', balance: 500_000_000 },
        ]),
      ],
    });
    const out = runR2(curr, prev);
    expect(out.cashFlowIndirecto!.financing.dividendosEstimados).toBe(0);
  });

  it('dividendos pagados = traslado de la utilidad ANTERIOR − aumento de resultados acumulados', () => {
    // T-1: utilidad 100M en 3605VC. T: 3705 recibe el traslado (100M) menos
    // dividendos pagados (60M) → 3705 = 40M; utilidad del año 150M en 3605VC.
    const prev = makeSnapshot({
      period: '2025',
      controlTotals: makeControlTotals({ efectivoCuenta11: 100_000_000, utilidadNeta: 100_000_000 }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 100_000_000 }]),
        makeClass(2, [{ code: '236005', name: 'Dividendos por pagar', balance: 0 }]),
        makeClass(3, [{ code: '3605VC', name: 'Cierre virtual R8', balance: 100_000_000 }]),
      ],
    });
    const curr = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({ efectivoCuenta11: 190_000_000, utilidadNeta: 150_000_000 }),
      classes: [
        makeClass(1, [{ code: '110505', name: 'Caja', balance: 190_000_000 }]),
        makeClass(2, [{ code: '236005', name: 'Dividendos por pagar', balance: 0 }]),
        makeClass(3, [
          { code: '370505', name: 'Utilidades acumuladas', balance: 40_000_000 },
          { code: '3605VC', name: 'Cierre virtual R8', balance: 150_000_000 },
        ]),
      ],
    });
    const efe = runR2(curr, prev).cashFlowIndirecto!;
    expect(efe.financing.dividendosEstimados).toBe(-60_000_000);
    expect(efe.operating.total).toBe(150_000_000);
    expect(efe.netChangeInCash).toBe(90_000_000);
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

describe('R4 — Causación del impuesto de renta (sólo cuentas de renta)', () => {
  // Auditoría 2026-09 (niif-preproceso-17): la versión anterior comparaba TODO
  // el grupo 24 contra el 35 % de la utilidad NETA y emitía un crítico con un
  // monto "a provisionar". La utilidad contable no es base fiscal: R4 sólo
  // informa, sin monto, cuando no hay gasto de renta causado.

  it('UAI positiva sin gasto de renta (54): hallazgo INFORMATIVO sin cifra de impuesto', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        utilidadNeta: 2_000_000_000,
        impuestosCuenta24: 3_800_000, // IVA/ICA: no es renta
      }),
      classes: [],
    });
    const out = runR4(snap);
    expect(out.taxProvisionRisk).toBeUndefined();
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].code).toBe('CUR-R4');
    expect(out.findings[0].severity).toBe('informativo');
    // No afirma "pasivo oculto" ni cuantifica 35 %.
    expect(out.findings[0].title).not.toMatch(/oculto/i);
    expect(out.findings[0].description).not.toMatch(/35\s*%/);
    expect(out.findings[0].recommendation).not.toMatch(/Provisionar \$/);
  });

  it('renta causada (5405) y compensada (2404 = 0): sin hallazgo de R4', () => {
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        utilidadNeta: 650_000_000,
        impuestosCuenta24: 0,
      }),
      classes: [
        makeClass(5, [{ code: '540505', name: 'Impuesto de renta', balance: 350_000_000 }]),
      ],
    });
    const out = runR4(snap);
    expect(out.taxProvisionRisk).toBeUndefined();
    expect(out.findings).toHaveLength(0);
  });

  it('no dispara cuando la UAI no es positiva', () => {
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
    // R4 ya no cuantifica una "renta teórica" (auditoría 2026-09).
    expect(out.taxProvisionRisk).toBeUndefined();
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
    // R4 sí funciona aunque classes esté roto (lo trata como vacío).
    expect(out.errors['CUR-R4']).toBeUndefined();
    expect(out.findings.some((f) => f.code === 'CUR-R4')).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Pulido Diamante 2026-05-08 — el contrato CFO exige que R1 + R5 + R6 SÍ
  // muten el snapshot cuando hay descuadres. La inmutabilidad solo se
  // preserva cuando NO hay nada que reparar (input ya cuadrado).
  //
  // Nota post-R8 (2026-05-08): R8 SIEMPRE muta el snapshot cuando hay
  // actividad P&L (ingresos + gastos > 0), trasladando la utilidad dinámica
  // a la cuenta virtual 3605VC en Patrimonio. Para que el Curator no mute
  // absolutamente nada, el snapshot debe:
  //   a) No tener actividad P&L (ingresos = gastos = 0) → R8 no actúa (guard).
  //   b) Ecuación A = P + Pat cuadrada → R5 no actúa.
  //   c) Sin saldos negativos en activos → R1 no actúa.
  //   d) Sin EFE (prev = null) → R6 no actúa.
  //   e) Sin margen > 85% → R7 no actúa.
  // ---------------------------------------------------------------------
  it('NO muta el snapshot cuando la entrada ya está cuadrada y sin actividad P&L (sin descuadres)', () => {
    // Snapshot perfectamente cuadrado SIN actividad P&L: balance-sheet puro.
    // Sin ingresos ni gastos → R8 no actúa (guard: hasPnLActivity = false).
    // ECP coincide con patrimonio → R5 no actúa.
    // Sin negativos en activos → R1 no actúa.
    // Sin prev → R6 no actúa. Sin margen → R7 no actúa.
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 400_000_000,
        ingresos: 0,     // sin actividad P&L → R8 preserva el snapshot
        gastos: 0,
        utilidadNeta: 0,
        impuestosCuenta24: 0,
      }),
      classes: [makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_000 }])],
      equity: {
        // 3105 = capital suscrito y pagado (PUC); `capitalAutorizado` es
        // informativo y no suma al patrimonio.
        capitalSuscritoPagado: 200_000_000,
        reservaLegal: 50_000_000,
        utilidadEjercicio: 100_000_000,
        utilidadesAcumuladas: 50_000_000,
        // Suma = 400M (igual a controlTotals.patrimonio) → R5 no muta
      },
    });
    // Pulido NIIF PYME Grupo 2: las reglas R9/R10/R12/R14/R15 escriben
    // SIEMPRE banderas en `snapshot.findings` y `snapshot.<rule>Audit` aunque
    // no detecten patología. La aserción byte-wise legacy ya no aplica;
    // verificamos en su lugar que los CAMPOS FINANCIEROS materiales
    // (controlTotals, summary, classes, equityBreakdown) no muten.
    const ctBefore = JSON.parse(JSON.stringify(snap.controlTotals));
    const summaryBefore = JSON.parse(JSON.stringify(snap.summary));
    const classesBefore = JSON.parse(JSON.stringify(snap.classes));
    const equityBefore = JSON.parse(JSON.stringify(snap.equityBreakdown));
    runCurator(snap, null);
    // `toMatchObject` en lugar de `toEqual`: las reglas de cierre virtual (R8)
    // y EFE indirecto (R2) añaden campos computados como `cashOpen`/`cashClose`
    // a `controlTotals` aunque el snapshot esté cuadrado. El contrato es que
    // los CAMPOS FINANCIEROS preexistentes no muten (esos siguen verificados
    // por toMatchObject), pero las claves nuevas computadas son aceptables.
    expect(snap.controlTotals).toMatchObject(ctBefore);
    expect(snap.summary).toMatchObject(summaryBefore);
    expect(snap.classes).toEqual(classesBefore);
    expect(snap.equityBreakdown).toEqual(equityBefore);
    // Las banderas de findings deben quedar todas en false (snapshot saludable).
    expect(snap.findings?.librosNoCerrados ?? false).toBe(false);
    expect(snap.findings?.cuenta18UsadaComoGasto ?? false).toBe(false);
    expect(snap.findings?.missingTaxCausation ?? false).toBe(false);
    expect(snap.findings?.ppeWithoutDepreciation ?? false).toBe(false);
    expect(snap.findings?.costeoIncompleto ?? false).toBe(false);
    // Y ninguna regla bloquea un balance sano.
    expect(snap.validation.blocking).toBe(false);
  });

  it('SÍ muta el snapshot cuando R1 detecta saldos negativos materiales (contrato Pulido Diamante)', () => {
    // R1 contract: cuentas materiales con saldo crédito mutan a `2810ZZ-*`.
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 0,
        patrimonio: 1_000_000_000,
      }),
      classes: [
        makeClass(1, [
          { code: '110505', name: 'Caja', balance: 1_010_000_000 },
          // Saldo crédito material (>$50K, > 0.0001 × 1B = $100K)
          { code: '120505', name: 'Inversiones', balance: -10_000_000 },
        ]),
      ],
    });
    const before = JSON.stringify(snap);
    runCurator(snap, null);
    const after = JSON.stringify(snap);
    expect(after).not.toBe(before);
    // Verificar mutación específica: la cuenta original quedó en 0 y aparece
    // la cuenta virtual en Clase 2.
    const class1 = snap.classes.find((c) => c.code === 1);
    const class2 = snap.classes.find((c) => c.code === 2);
    const negCuenta = class1?.accounts.find((a) => a.code === '120505');
    // Pulido NIIF PYME Grupo 2: cuentas de Inversiones (clase 12) se reclasifican
    // al pasivo virtual `2895VC-*` (Otros pasivos diversos) en lugar del
    // genérico `2810ZZ-*`, porque la naturaleza de los reajustes fiscales es
    // distinta a sobregiros / anticipos transitorios.
    const virtual = class2?.accounts.find((a) => a.code === '2895VC-120505');
    expect(negCuenta?.balance).toBe(0);
    expect(virtual?.balance).toBe(10_000_000);
  });

  it('R5 NO reescribe el patrimonio cuando el desglose (ECP) no concilia: revela la brecha y bloquea', () => {
    // Auditoría 2026-09 (recalculo-08): la versión anterior anclaba
    // controlTotals.patrimonio al desglose, borrando del balance las cuentas
    // de patrimonio que el desglose no mapeaba. El patrimonio publicado es
    // Σ clase 3; una brecha con el ECP se revela y bloquea la emisión.
    const snap = makeSnapshot({
      period: '2026',
      controlTotals: makeControlTotals({
        activo: 1_000_000_000,
        pasivo: 600_000_000,
        patrimonio: 100_000_000, // brecha de 300M vs ECP_sum = 400M
      }),
      classes: [makeClass(1, [{ code: '110505', name: 'Caja', balance: 1_000_000_000 }])],
      equity: {
        capitalSuscritoPagado: 200_000_000,
        reservaLegal: 50_000_000,
        utilidadEjercicio: 100_000_000,
        utilidadesAcumuladas: 50_000_000,
        // Suma = 400M
      },
    });
    const result = runCurator(snap, null);
    expect(snap.controlTotals.patrimonio).toBe(100_000_000);
    expect(snap.equityBreakdown.convergenceAdjustment).toBeUndefined();
    expect(snap.equityAnchorAdjustment).toBeUndefined();
    expect(result.convergenceAdjustment).toBeUndefined();
    expect(snap.validation.blocking).toBe(true);
    expect(snap.validation.curatorBlockingReasons?.some((r) => r.startsWith('[CUR-R5]'))).toBe(true);
    expect(snap.validation.curatorBlockingReasons?.join(' ')).toContain('300.000.000,00');
    expect(result.findings.some((f) => f.code === 'CUR-R5' && f.severity === 'critico')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Single Source of Truth Validator (coherencia inter-pilar)
// ---------------------------------------------------------------------------
// Verifica que validateCrossPillarCoherence detecte correctamente:
//   1. Snapshot consistente → consistent: true, severity: 'ok', findings vacío.
//   2. utilidadOperacional de Valor manipulada → severity: 'critical',
//      code: 'UTILIDAD_NETA_INCOHERENT'.
//   3. Hash determinístico: mismas cifras → mismo hash.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  validateCrossPillarCoherence,
} from '../single-source-validator';
import type { CoherenceReport } from '../single-source-validator';
import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidationResult,
} from '@/lib/preprocessing/trial-balance';
import type {
  ExecutiveCard,
  ExecutiveCardKey,
  PillarMetrics,
  PillarsResult,
  ValorExecutiveCards,
  EscudoExecutiveCards,
  VerdadExecutiveCards,
  FuturoExecutiveCards,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidation(): ValidationResult {
  return { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] };
}

function makeControlTotals(overrides: Partial<ControlTotals> = {}): ControlTotals {
  return {
    activo: 500_000_000,
    activoCorriente: 300_000_000,
    activoNoCorriente: 200_000_000,
    pasivo: 200_000_000,
    pasivoCorriente: 100_000_000,
    pasivoNoCorriente: 100_000_000,
    patrimonio: 100_000_000,
    ingresos: 1_200_000_000,
    gastos: 950_000_000,
    utilidadNeta: 200_000_000,
    efectivoCuenta11: 150_000_000,
    deudoresCuenta13: 80_000_000,
    cuentasPorPagar23: 60_000_000,
    impuestosCuenta24: 50_000_000,
    obligacionesLaborales25: 20_000_000,
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

function makeSnapshot(ct: ControlTotals): PeriodSnapshot {
  return {
    period: '2026',
    classes: [
      makeClass(1, [{ code: '110505', name: 'Caja', balance: ct.efectivoCuenta11 }]),
      makeClass(2, [{ code: '220505', name: 'Proveedores', balance: ct.pasivo }]),
      makeClass(4, [{ code: '410505', name: 'Ingresos', balance: ct.ingresos }]),
      makeClass(5, [{ code: '510505', name: 'Gastos', balance: ct.gastos }]),
      makeClass(6, [{ code: '610505', name: 'Costos', balance: 0 }]),
    ],
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

/**
 * Construye un PillarsResult coherente — todos los audits derivados
 * matemáticamente del mismo snapshot canónico.
 */
function makeConsistentMetrics(ct: ControlTotals): PillarsResult {
  // FIX (audit B1): utilidadOperacional ahora es utilidadNeta + impuesto5410
  // + intereses5305. Sin clases 4-5 en el fixture, ambos son 0 → utilidadOperacional
  // = utilidadNeta. El audit expone utilidadNeta directamente para el validator.
  const utilidadOperacional = ct.utilidadNeta;
  // rentaTeorica = utilidadNeta × 0.35
  const rentaTeorica = Math.max(0, ct.utilidadNeta * 0.35);
  // CAGR null (sin comparativo)
  const cagr = null;
  const cagrParaProyeccion = 0.05; // default
  const utilidadProyectadaAnual = Math.max(0, ct.utilidadNeta) * (1 + cagrParaProyeccion);

  const valorCards: ValorExecutiveCards = {
    ebitda: buildCard('ebitda', utilidadOperacional),
    waoo: buildCard('waoo', ct.ingresos > 0 ? utilidadOperacional / ct.ingresos : null),
    ratio: buildCard('ratio', 0.8),
    fcf: buildCard('fcf', null),
    audit: {
      utilidadNeta: ct.utilidadNeta,
      utilidadOperacional,
      depreciaciones: 0,
      amortizaciones: 0,
      totalGastos: ct.gastos,
      totalCostos: 0,
      totalIngresos: ct.ingresos,
      capex: null,
      operatingCashFlow: null,
    },
    generatedAt: new Date().toISOString(),
  };

  const escudoCards: EscudoExecutiveCards = {
    autonomia: buildCard('autonomia', 90),
    cobertura_pasivos: buildCard('cobertura_pasivos', 3),
    reserva_fiscal: buildCard('reserva_fiscal', ct.impuestosCuenta24 - rentaTeorica),
    brecha_escudo: buildCard('brecha_escudo', ct.efectivoCuenta11 - ct.pasivo),
    audit: {
      efectivoCuenta11: ct.efectivoCuenta11,
      inversionesTemporales12: 0,
      totalEgresosPeriodo: ct.gastos,
      promedioEgresosMensuales: ct.gastos / 12,
      activoCorriente: ct.activoCorriente,
      pasivoCorriente: ct.pasivoCorriente,
      provisionCuenta24: ct.impuestosCuenta24,
      rentaTeorica,
      proveedoresCuenta2205: ct.pasivo,
      tasaRenta: 0.35,
      periodosUsados: 1,
    },
    generatedAt: new Date().toISOString(),
  };

  const verdadCards: VerdadExecutiveCards = {
    ecuacion_maestra: buildCard('ecuacion_maestra', ct.activo - ct.pasivo - ct.patrimonio),
    consistencia: buildCard('consistencia', 95),
    anomalias: buildCard('anomalias', 0),
    salud_contable: buildCard('salud_contable', 0),
    audit: {
      equationGap: ct.activo - ct.pasivo - ct.patrimonio,
      saldosNegativosActivo: 0,
      saldosPositivosPasivo: 0,
      totalCuentasAnalizadas: 2,
      reclasificacionesR1: 0,
      discrepanciasPreprocessing: 0,
      findingsCriticos: 0,
      findingsAltos: 0,
      anomaliasVariacion: 0,
      margenBruto: 1,
      posibleOmisionCostos: false,
      forensicScore: null,
      integridadTerceros: null,
    },
    generatedAt: new Date().toISOString(),
  };

  const futuroCards: FuturoExecutiveCards = {
    cagr: buildCard('cagr', cagr),
    punto_quiebre: buildCard('punto_quiebre', null),
    provision_tributaria: buildCard('provision_tributaria', utilidadProyectadaAnual * 0.35),
    capacidad_inversion: buildCard('capacidad_inversion', ct.efectivoCuenta11 - Math.max(0, ct.utilidadNeta) * 0.35 - (ct.gastos / 365) * 60),
    audit: {
      cagrIngresos: cagr,
      periodosCagr: null,
      ingresosActuales: ct.ingresos,
      ingresosAnteriores: null,
      mesesAlQuiebreConservador: null,
      mesesAlQuiebreBase: null,
      utilidadProyectadaAnual,
      provisionTributariaFutura: utilidadProyectadaAnual * 0.35,
      capacidadInversion: ct.efectivoCuenta11 - Math.max(0, ct.utilidadNeta) * 0.35 - (ct.gastos / 365) * 60,
      reserva60Dias: (ct.gastos / 365) * 60,
      cajaProyectada36mBase: ct.efectivoCuenta11,
      tasaRenta: 0.35,
    },
    generatedAt: new Date().toISOString(),
  };

  const basePillar = (
    id: 'valor' | 'escudo' | 'verdad' | 'futuro',
  ): PillarMetrics => ({
    pillarId: id,
    healthScore: 80,
    status: 'healthy',
    kpis: [],
    alerts: [],
    generatedAt: new Date().toISOString(),
    ...(id === 'valor' ? { executiveCards: valorCards } : {}),
    ...(id === 'escudo' ? { escudoCards } : {}),
    ...(id === 'verdad' ? { verdadCards } : {}),
    ...(id === 'futuro' ? { futuroCards } : {}),
  });

  return {
    valor: basePillar('valor'),
    escudo: basePillar('escudo'),
    verdad: basePillar('verdad'),
    futuro: basePillar('futuro'),
    overallScore: 80,
    overallStatus: 'healthy',
    generatedAt: new Date().toISOString(),
  };
}

/** Tarjeta ejecutiva mínima (sólo value importa para el validador). */
function buildCard(key: ExecutiveCardKey, value: number | null): ExecutiveCard {
  return {
    key,
    labelEs: key,
    labelEn: key,
    value,
    unit: 'cop' as const,
    color: 'blue' as const,
    status: 'healthy' as const,
    deltaVsComparative: null,
    descriptionEs: '',
    descriptionEn: '',
    formulaEs: '',
    formulaEn: '',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateCrossPillarCoherence', () => {
  it('snapshot consistente → consistent: true, severity: ok, findings vacío', () => {
    const ct = makeControlTotals();
    const snapshot = makeSnapshot(ct);
    const metrics = makeConsistentMetrics(ct);

    const report: CoherenceReport = validateCrossPillarCoherence(metrics, snapshot);

    expect(report.consistent).toBe(true);
    expect(report.severity).toBe('ok');
    expect(report.findings).toHaveLength(0);
    expect(report.canonicalHash).toMatch(/^[0-9a-f]{32}$/); // md5 hex
  });

  it('utilidadNeta de Valor manipulada → severity: critical, code: UTILIDAD_NETA_INCOHERENT', () => {
    const ct = makeControlTotals();
    const snapshot = makeSnapshot(ct);
    const metrics = makeConsistentMetrics(ct);

    // Manipular el audit de Valor: inyectamos utilidadNeta 50M más alta que
    // el canónico del snapshot. El validator detecta drift directo (FIX B1).
    const valorCards = metrics.valor.executiveCards!;
    const tampered: ValorExecutiveCards = {
      ...valorCards,
      audit: {
        ...valorCards.audit,
        utilidadNeta: valorCards.audit.utilidadNeta + 50_000_000,
      },
    };
    const tamperedMetrics: PillarsResult = {
      ...metrics,
      valor: { ...metrics.valor, executiveCards: tampered },
    };

    const report = validateCrossPillarCoherence(tamperedMetrics, snapshot);

    expect(report.consistent).toBe(false);
    expect(report.severity).toBe('critical');
    const finding = report.findings.find((f) => f.code === 'UTILIDAD_NETA_INCOHERENT');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('critical');
    expect(finding?.spread).toBeGreaterThan(1_000);
  });

  it('hash determinístico: mismas cifras → mismo hash en llamadas distintas', () => {
    const ct = makeControlTotals();
    const snapshot = makeSnapshot(ct);
    const metrics = makeConsistentMetrics(ct);

    const r1 = validateCrossPillarCoherence(metrics, snapshot);
    const r2 = validateCrossPillarCoherence(metrics, snapshot);

    expect(r1.canonicalHash).toBe(r2.canonicalHash);
  });

  it('cifras distintas → hash diferente', () => {
    const ct1 = makeControlTotals({ utilidadNeta: 200_000_000 });
    const ct2 = makeControlTotals({ utilidadNeta: 201_000_000 });

    const r1 = validateCrossPillarCoherence(
      makeConsistentMetrics(ct1),
      makeSnapshot(ct1),
    );
    const r2 = validateCrossPillarCoherence(
      makeConsistentMetrics(ct2),
      makeSnapshot(ct2),
    );

    expect(r1.canonicalHash).not.toBe(r2.canonicalHash);
  });

  it('ingresos de Futuro manipulados → finding INGRESOS_INCOHERENT (warning)', () => {
    const ct = makeControlTotals();
    const snapshot = makeSnapshot(ct);
    const metrics = makeConsistentMetrics(ct);

    const futuroCards = metrics.futuro.futuroCards!;
    const tampered: FuturoExecutiveCards = {
      ...futuroCards,
      audit: {
        ...futuroCards.audit,
        ingresosActuales: futuroCards.audit.ingresosActuales + 5_000_000,
      },
    };
    const tamperedMetrics: PillarsResult = {
      ...metrics,
      futuro: { ...metrics.futuro, futuroCards: tampered },
    };

    const report = validateCrossPillarCoherence(tamperedMetrics, snapshot);

    expect(report.consistent).toBe(false);
    const f = report.findings.find((f) => f.code === 'INGRESOS_INCOHERENT');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('warning');
  });
});

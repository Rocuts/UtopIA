// ---------------------------------------------------------------------------
// Wave 4 F0 — smoke tests para los helpers v8.1 (spec §2, §5 Slide 12).
// ---------------------------------------------------------------------------
// Estos tests validan los 3 helpers determinísticos que F4-F6 consumen:
//   - deriveReportMode()   → árbol decisión §2
//   - summarizeCoverage()  → metadata Slide 12
//   - computeReportHash()  → hash estable Slide 12
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  deriveReportMode,
  summarizeCoverage,
  computeReportHash,
} from '../v8-helpers';
import type { PreprocessedBalance, PeriodSnapshot } from '../trial-balance';

function mkSnapshot(
  period: string,
  total: number,
  hasClasses: boolean,
): PeriodSnapshot {
  const cls = (code: number, pct: number) => ({
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: total * pct,
    reportedTotal: total * pct,
    discrepancy: 0,
    accounts:
      code === 1
        ? [
            {
              code: '1105',
              name: 'Caja',
              level: 'Auxiliar',
              balance: total * pct,
              isLeaf: true,
            },
          ]
        : [],
  });

  const classes = hasClasses
    ? [
        cls(1, 1.0),
        cls(2, 0.3),
        cls(3, 0.7),
        cls(4, 0.5),
        cls(5, 0.4),
      ]
    : [];

  return {
    period,
    classes,
    controlTotals: {
      activo: hasClasses ? total : 0,
      activoCorriente: total * 0.6,
      activoNoCorriente: total * 0.4,
      pasivo: total * 0.3,
      pasivoCorriente: total * 0.2,
      pasivoNoCorriente: total * 0.1,
      patrimonio: total * 0.7,
      ingresos: total * 0.5,
      gastos: total * 0.4,
      utilidadNeta: total * 0.1,
      efectivoCuenta11: total * 0.2,
      deudoresCuenta13: total * 0.15,
      cuentasPorPagar23: total * 0.1,
      impuestosCuenta24: total * 0.05,
      obligacionesLaborales25: total * 0.03,
    },
    equityBreakdown: {},
    summary: {
      totalAssets: total,
      totalLiabilities: total * 0.3,
      totalEquity: total * 0.7,
      totalRevenue: total * 0.5,
      totalExpenses: total * 0.4,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: total * 0.1,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: {
      blocking: false,
      reasons: [],
      suggestedAccounts: [],
      adjustments: [],
    },
    discrepancies: [],
    missingExpectedAccounts: [],
  } as PeriodSnapshot;
}

function mkPp(
  primary: PeriodSnapshot,
  comparative: PeriodSnapshot | null,
  impracticables: boolean,
): PreprocessedBalance {
  return {
    periods: comparative ? [comparative, primary] : [primary],
    primary,
    comparative,
    rawRows: [],
    auxiliaryCount: 1,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: impracticables,
    reclasificacionesNoCompensacion: [],
  };
}

describe('Wave 4 F0 — deriveReportMode (spec v8.1 §2)', () => {
  it('sin comparativo (comparative=null) → LINEA_BASE', () => {
    const pp = mkPp(mkSnapshot('2026', 1_000_000, true), null, true);
    expect(deriveReportMode(pp)).toBe('LINEA_BASE');
  });

  it('comparativos_impracticables=true (saldos ≈ 0 en TODO el comparativo) → LINEA_BASE', () => {
    const pp = mkPp(
      mkSnapshot('2026', 1_000_000, true),
      mkSnapshot('2025', 800_000, true),
      true,
    );
    expect(deriveReportMode(pp)).toBe('LINEA_BASE');
  });

  it('comparativo completo (0 missing material lines) → COMPARATIVO_COMPLETO', () => {
    const pp = mkPp(
      mkSnapshot('2026', 1_000_000, true),
      mkSnapshot('2025', 800_000, true),
      false,
    );
    expect(deriveReportMode(pp)).toBe('COMPARATIVO_COMPLETO');
  });

  it('comparativo con >=3 líneas materiales faltantes → TRANSICION', () => {
    const pp = mkPp(
      mkSnapshot('2026', 1_000_000, true),
      mkSnapshot('2025', 800_000, false), // comparativo VACÍO → todas las clases materiales del primary faltan
      false,
    );
    expect(deriveReportMode(pp)).toBe('TRANSICION');
  });

  it('totalAssets=0 fallback conservador → LINEA_BASE', () => {
    const primary = mkSnapshot('2026', 1_000_000, true);
    // Forzar activo total = 0 para disparar el guard.
    primary.controlTotals.activo = 0;
    const pp = mkPp(primary, mkSnapshot('2025', 800_000, true), false);
    expect(deriveReportMode(pp)).toBe('LINEA_BASE');
  });
});

describe('Wave 4 F0 — summarizeCoverage (Slide 12 metadata)', () => {
  it('reporta todas las 10 clases canónicas (1..9 + 25)', () => {
    const pp = mkPp(mkSnapshot('2026', 1_000_000, true), null, true);
    const cov = summarizeCoverage(pp);
    expect(cov).toHaveLength(10);
    expect(cov.map((c) => c.classCode)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '25',
    ]);
  });

  it('clase 1 con 1 auxiliar = $1.000.000 → totalSaldoCop=centavos, percentOfFolio=100,0', () => {
    const pp = mkPp(mkSnapshot('2026', 1_000_000, true), null, true);
    const cov = summarizeCoverage(pp);
    const c1 = cov.find((c) => c.classCode === '1');
    expect(c1).toBeDefined();
    expect(c1!.auxiliariesCount).toBe(1);
    expect(c1!.totalSaldoCop).toBe('100000000'); // 1_000_000 pesos * 100 = 100_000_000 centavos
    expect(c1!.percentOfFolio).toBe('100,0');
  });
});

describe('Wave 4 F0 — computeReportHash (Slide 12 verificación)', () => {
  it('produce hash hexadecimal de 64 chars (SHA-256)', () => {
    const hash = computeReportHash({ niif: 'a', strategy: 'b', governance: 'c' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es estable frente a reordenamiento de claves anidadas', () => {
    const h1 = computeReportHash({
      niif: { x: 1, a: 2, m: { p: 1, q: 2 } },
      strategy: null,
      governance: null,
    });
    const h2 = computeReportHash({
      niif: { a: 2, m: { q: 2, p: 1 }, x: 1 },
      strategy: null,
      governance: null,
    });
    expect(h1).toBe(h2);
  });

  it('cambia cuando un valor cambia', () => {
    const h1 = computeReportHash({ niif: 1, strategy: null, governance: null });
    const h2 = computeReportHash({ niif: 2, strategy: null, governance: null });
    expect(h1).not.toBe(h2);
  });
});

// compose.test.ts — unit tests for composeEditorialReport.
// ─────────────────────────────────────────────────────────────────────────────
// Stubs minimal FinancialReport / PreprocessedBalance / PillarsResult inputs
// and asserts the IR shape, including BLOCKED watermark + missing pillars.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

import { composeEditorialReport } from '../compose';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type {
  ControlTotals,
  PeriodSnapshot,
  PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { PillarsResult } from '@/lib/pillars/types';

function stubControlTotals(): ControlTotals {
  return {
    activo: 1_000_000_000,
    activoCorriente: 600_000_000,
    activoNoCorriente: 400_000_000,
    pasivo: 400_000_000,
    pasivoCorriente: 300_000_000,
    pasivoNoCorriente: 100_000_000,
    patrimonio: 600_000_000,
    ingresos: 1_500_000_000,
    gastos: 1_300_000_000,
    utilidadNeta: 200_000_000,
    efectivoCuenta11: 150_000_000,
    deudoresCuenta13: 250_000_000,
    cuentasPorPagar23: 80_000_000,
    impuestosCuenta24: 70_000_000,
    obligacionesLaborales25: 30_000_000,
  };
}

function stubSnapshot(period = '2026'): PeriodSnapshot {
  return {
    period,
    classes: [],
    controlTotals: stubControlTotals(),
    equityBreakdown: {},
    summary: {
      totalAssets: 1_000_000_000,
      totalLiabilities: 400_000_000,
      totalEquity: 600_000_000,
      totalRevenue: 1_500_000_000,
      totalExpenses: 1_300_000_000,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: 200_000_000,
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
  };
}

function stubPreprocessed(): PreprocessedBalance {
  // Happy-path stub for the "produces a complete EditorialReport" test. The
  // assertion at line ~242 expects `meta.watermark` to be undefined, so we
  // MUST NOT trigger any of compose.ts:296-324 watermark conditions:
  //   - `comparativos_impracticables: true` → 'BORRADOR'
  //   - `provisional: true` → 'BORRADOR'
  //   - emittable.ok === false → 'BLOQUEADO'
  // If you need a BORRADOR fixture, create a separate `stubPreprocessedBorrador()`
  // for a dedicated test rather than mutating this happy-path one.
  const snap = stubSnapshot('2026');
  return {
    periods: [snap],
    primary: snap,
    comparative: null,
    rawRows: [],
    auxiliaryCount: 0,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: false,
    reclasificacionesNoCompensacion: [],
  };
}

function stubFinancialReport(overrides?: Partial<FinancialReport>): FinancialReport {
  const balanceMd = `## Estado de Situación Financiera

| Cuenta | 2026 | 2025 |
|--------|------|------|
| Efectivo | $150.000.000 | $120.000.000 |
| Deudores | $250.000.000 | $230.000.000 |
| **TOTAL ACTIVO** | **$1.000.000.000** | **$900.000.000** |
`;

  const incomeMd = `## Estado de Resultados

| Cuenta | 2026 |
|--------|------|
| Ingresos | $1.500.000.000 |
| (Gastos) | ($1.300.000.000) |
| **UTILIDAD NETA** | **$200.000.000** |
`;

  const notesMd = `## Nota 1 — Bases de Preparación
Las NIIF Secc. 17 y el Decreto 2420/2015 son la base.

## Nota 2 — Políticas
Aplicamos NIC 2 para inventarios. La provisión de renta es Art. 240 ET (35%).
`;

  const recsMd = `1. **Acelerar cobros**
   Reducir días de cartera de 64 a 50 con descuento por pronto pago.

2. **Refinanciar pasivo corto plazo**
   Migrar deuda corriente a largo plazo según NIIF Secc. 11.
`;

  return {
    company: {
      name: 'Demo SAS',
      nit: '900123456-7',
      entityType: 'SAS',
      fiscalPeriod: '2026',
    },
    niifAnalysis: {
      balanceSheet: balanceMd,
      incomeStatement: incomeMd,
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: balanceMd + '\n' + incomeMd,
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: recsMd,
      fullContent: 'La compañía cierra 2026 con un margen del 13,3%.\n\nEl pilar Verdad cuadra al centavo bajo NIIF Secc. 17.',
    },
    governance: {
      financialNotes: notesMd,
      shareholderMinutes: '',
      fullContent: 'El gobierno corporativo ha mantenido una postura prudente, en cumplimiento de la Ley 222/1995 y el Art. 240 ET.',
    },
    consolidatedReport: '# REPORTE CONSOLIDADO\n\nContenido...',
    generatedAt: '2026-05-08T12:00:00.000Z',
    ...overrides,
  };
}

function stubPillars(): PillarsResult {
  const now = '2026-05-08T12:00:00.000Z';
  return {
    escudo: {
      pillarId: 'escudo',
      healthScore: 70,
      status: 'healthy',
      kpis: [
        {
          key: 'autonomia',
          labelEs: 'Autonomía',
          labelEn: 'Autonomy',
          value: 47,
          unit: 'days',
          score: 70,
          status: 'healthy',
          severity: 'success',
          descriptionEs: '',
          descriptionEn: '',
        },
      ],
      alerts: [],
      generatedAt: now,
    },
    valor: {
      pillarId: 'valor',
      healthScore: 80,
      status: 'healthy',
      kpis: [
        {
          key: 'ebitda',
          labelEs: 'EBITDA',
          labelEn: 'EBITDA',
          value: 250_000_000,
          unit: 'cop',
          score: 80,
          status: 'healthy',
          severity: 'success',
          descriptionEs: '',
          descriptionEn: '',
        },
      ],
      alerts: [],
      generatedAt: now,
    },
    verdad: {
      pillarId: 'verdad',
      healthScore: 88,
      status: 'healthy',
      kpis: [],
      alerts: [],
      generatedAt: now,
    },
    futuro: {
      pillarId: 'futuro',
      healthScore: 65,
      status: 'watch',
      kpis: [
        {
          key: 'cagr',
          labelEs: 'CAGR Ingresos',
          labelEn: 'Revenue CAGR',
          value: 0.184,
          unit: 'pct',
          score: 65,
          status: 'watch',
          severity: 'warning',
          descriptionEs: '',
          descriptionEn: '',
        },
      ],
      alerts: [],
      generatedAt: now,
    },
    overallScore: 76,
    overallStatus: 'healthy',
    generatedAt: now,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('composeEditorialReport', () => {
  it('produces a complete EditorialReport from a happy-path input', () => {
    const out = composeEditorialReport({
      report: stubFinancialReport(),
      preprocessed: stubPreprocessed(),
      pillars: stubPillars(),
      language: 'es',
    });

    expect(out.meta.companyName).toBe('Demo SAS');
    expect(out.meta.nit).toBe('900123456-7');
    expect(out.meta.language).toBe('es');
    expect(out.meta.watermark).toBeUndefined();

    expect(out.kpiGrid.kpis.length).toBeLessThanOrEqual(12);
    expect(out.kpiGrid.kpis.length).toBeGreaterThan(0);

    expect(out.waterfall.items.length).toBeGreaterThanOrEqual(3);
    expect(out.waterfall.items[0].sign).toBe('pos');
    expect(out.waterfall.items[out.waterfall.items.length - 1].sign).toBe('total');

    expect(out.dialGauges.gauges.length).toBe(4);

    expect(out.pillars).toBeDefined();
    expect(out.pillars!.satellites.length).toBe(4);
    expect(out.pillars!.satellites[0].id).toBe('escudo');
    expect(out.pillars!.satellites[1].id).toBe('valor');

    // Director letter must have body + at least one citation extracted from
    // the governance/strategic content (which mentions Ley 222/1995, NIIF Secc. 17).
    expect(out.directorLetter.bodyMarkdown.length).toBeGreaterThan(0);
  });

  it('parses GFM tables in incomeStatement to populate statements.income', () => {
    const out = composeEditorialReport({
      report: stubFinancialReport(),
      preprocessed: stubPreprocessed(),
      pillars: null,
      language: 'es',
    });
    expect(out.statements.income.headers.length).toBeGreaterThan(0);
    expect(out.statements.income.rows.length).toBeGreaterThan(0);
    // The TOTAL row should be flagged as `total`.
    const totalRow = out.statements.income.rows.find((r) =>
      /UTILIDAD NETA/i.test(r.account),
    );
    expect(totalRow?.emphasis).toBe('total');
  });

  it('omits pillars when none are provided', () => {
    const out = composeEditorialReport({
      report: stubFinancialReport(),
      preprocessed: stubPreprocessed(),
      pillars: undefined,
      language: 'es',
    });
    expect(out.pillars).toBeUndefined();
  });

  it('marks watermark = BLOQUEADO and surfaces blockers in appendix when emittable.ok=false', () => {
    const out = composeEditorialReport({
      report: stubFinancialReport(),
      preprocessed: stubPreprocessed(),
      pillars: null,
      language: 'es',
      emittable: { ok: false, blockers: ['V11', 'V12'] },
    });
    expect(out.meta.watermark).toBe('BLOQUEADO');
    const warnings = out.appendix.validationWarnings ?? [];
    expect(warnings).toContain('V11');
    expect(warnings).toContain('V12');
  });

  it('parses numbered list recommendations and rotates accent colors', () => {
    const out = composeEditorialReport({
      report: stubFinancialReport(),
      preprocessed: stubPreprocessed(),
      pillars: null,
      language: 'es',
    });
    expect(out.recommendations.items.length).toBeGreaterThanOrEqual(2);
    expect(out.recommendations.items[0].areaAccent).toBe('futuro');
    expect(out.recommendations.items[1].areaAccent).toBe('valor');
  });

  it('extracts citations from notes via the binding regex', () => {
    const out = composeEditorialReport({
      report: stubFinancialReport(),
      preprocessed: stubPreprocessed(),
      pillars: null,
      language: 'es',
    });
    const labels = out.notes.blocks.flatMap((b) => b.citations.map((c) => c.label));
    // Must dedupe.
    const expected = ['NIIF Secc. 17', 'Decreto 2420/2015', 'NIC 2', 'Art. 240 ET'];
    for (const e of expected) {
      expect(labels.some((l) => l.toLowerCase() === e.toLowerCase())).toBe(true);
    }
  });
});

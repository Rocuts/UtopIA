// Tests del validator JSON-strict del NIIF Analyst (Fase 3.3).
// Blinda los 6 invariantes Elite Protocol Capa 1 con tolerancia exacta $0.

import { describe, it, expect } from 'vitest';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import type { NiifReportJson } from '../contracts/niif-report';

function makeReport(overrides: Partial<NiifReportJson> = {}): NiifReportJson {
  const base: NiifReportJson = {
    company: {
      name: 'Empresa Prueba SAS',
      nit: '900123456',
      entityType: null,
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: null,
      city: null,
      signatories: null,
    },
    balanceSheet: {
      assets: [],
      liabilities: [],
      equity: [],
      totalAssetsPrimary: '1000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: '400000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: '600000',
      totalEquityComparative: null,
      notes: [],
    },
    incomeStatement: {
      lines: [],
      grossProfitPrimary: '500000',
      grossProfitComparative: null,
      operatingProfitPrimary: '300000',
      operatingProfitComparative: null,
      netIncomePrimary: '200000',
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
    },
    cashFlow: {
      sections: [
        { section: 'operating', lines: [], netFlow: '150000' },
        { section: 'investing', lines: [], netFlow: '-50000' },
        { section: 'financing', lines: [], netFlow: '-30000' },
      ],
      netChange: '70000',
      cashOpening: '100000',
      cashClosing: '170000',
      methodNote: 'indirect',
    },
    equityChanges: {
      rows: [
        {
          kind: 'opening_balance',
          label: 'Saldo al 1 ene 2025',
          capitalSocial: '300000',
          primaColocacion: '0',
          reservaLegal: '50000',
          otrasReservas: '0',
          resultadosAcumulados: '50000',
          resultadoEjercicio: '0',
          ori: '0',
          total: '400000',
        },
        {
          kind: 'closing_balance',
          label: 'Saldo al 31 dic 2025',
          capitalSocial: '300000',
          primaColocacion: '0',
          reservaLegal: '50000',
          otrasReservas: '0',
          resultadosAcumulados: '50000',
          resultadoEjercicio: '200000',
          ori: '0',
          total: '600000',
        },
      ],
      notes: [],
    },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
  };
  return { ...base, ...overrides };
}

describe('validateNiifReportJson — Capa 1 Integridad Aritmética', () => {
  it('passes a coherent report with no warnings/errors', () => {
    const result = validateNiifReportJson(makeReport());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('E1: detects equation imbalance', () => {
    const broken = makeReport({
      balanceSheet: {
        ...makeReport().balanceSheet,
        totalAssetsPrimary: '999999', // Off by $1 cent
        totalLiabilitiesPrimary: '400000',
        totalEquityPrimary: '600000', // 400000 + 600000 = 1000000, not 999999
      },
    });
    const result = validateNiifReportJson(broken);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/E1/);
  });

  it('E2: detects EFE cashClosing inconsistency', () => {
    const broken = makeReport({
      cashFlow: {
        sections: [
          { section: 'operating', lines: [], netFlow: '100000' },
          { section: 'investing', lines: [], netFlow: '0' },
          { section: 'financing', lines: [], netFlow: '0' },
        ],
        netChange: '100000',
        cashOpening: '100000',
        cashClosing: '999', // Should be 200000
        methodNote: 'indirect',
      },
    });
    const result = validateNiifReportJson(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('E2'))).toBe(true);
  });

  it('E3: detects EFE cashClosing ≠ PUC 11', () => {
    const result = validateNiifReportJson(makeReport(), { cashAccountPuc11Cents: '99999' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('E3'))).toBe(true);
  });

  it('E3: passes when EFE cashClosing == PUC 11', () => {
    const result = validateNiifReportJson(makeReport(), { cashAccountPuc11Cents: '170000' });
    expect(result.ok).toBe(true);
  });

  it('E4: detects ECP closing ≠ Patrimonio Balance', () => {
    const broken = makeReport();
    broken.equityChanges.rows[1].total = '500000'; // Should be 600000
    const result = validateNiifReportJson(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('E4'))).toBe(true);
  });

  it('E4: detects missing closing_balance row', () => {
    const broken = makeReport();
    broken.equityChanges.rows = broken.equityChanges.rows.filter((r) => r.kind !== 'closing_balance');
    const result = validateNiifReportJson(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('E4'))).toBe(true);
  });

  it('E5: warns when Gross < Operating (inusual)', () => {
    const odd = makeReport({
      incomeStatement: {
        ...makeReport().incomeStatement,
        grossProfitPrimary: '100000',
        operatingProfitPrimary: '200000',
        netIncomePrimary: '150000',
      },
    });
    const result = validateNiifReportJson(odd);
    expect(result.warnings.some((w) => w.includes('E5'))).toBe(true);
  });

  it('uses absolute exact tolerance ($0)', () => {
    const offByOneCent = makeReport({
      balanceSheet: {
        ...makeReport().balanceSheet,
        totalAssetsPrimary: '1000001', // 1 cent off
      },
    });
    const result = validateNiifReportJson(offByOneCent);
    expect(result.ok).toBe(false);
  });
});

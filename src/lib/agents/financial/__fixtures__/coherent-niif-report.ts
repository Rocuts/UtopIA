import type { NiifReportJson } from '../contracts/niif-report';
import type { FinancialReport } from '../types';

const line = (account: string | null, amountPrimary: string) => ({
  account, label: account ?? 'Ajuste no monetario', amountPrimary, amountComparative: null,
  level: 2 as const, isAbsolute: false, confidence: null, anomalyFlag: null,
});

export function makeCoherentNiifReport(overrides: Partial<NiifReportJson> = {}): NiifReportJson {
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
      assets: [line('11', '170000'), line('13', '830000')],
      liabilities: [line('22', '400000')],
      equity: [line('31', '600000')],
      totalAssetsPrimary: '1000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: '400000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: '600000',
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [line('4', '700000'), line('6', '200000'), line('51', '200000'), line('53', '100000')],
      grossProfitPrimary: '500000',
      grossProfitComparative: null,
      operatingProfitPrimary: '300000',
      operatingProfitComparative: null,
      netIncomePrimary: '200000',
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: [
        { section: 'operating', lines: [line(null, '200000'), line(null, '-50000')], netFlow: '150000' },
        { section: 'investing', lines: [line(null, '-50000')], netFlow: '-50000' },
        { section: 'financing', lines: [line(null, '-30000')], netFlow: '-30000' },
      ],
      netChange: '70000',
      cashOpening: '100000',
      cashClosing: '170000',
      methodNote: 'indirect',
      degeneracyFlag: null,
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
    reportMode: null,
  };
  return { ...base, ...overrides };
}

export function makeExportableReport(): FinancialReport {
  const json = makeCoherentNiifReport();
  return {
    company: { name: json.company.name, nit: json.company.nit, fiscalPeriod: json.company.fiscalPeriod },
    niifAnalysis: { json, balanceSheet: '', incomeStatement: '', cashFlowStatement: '',
      equityChangesStatement: '', technicalNotes: '', fullContent: 'NIIF',
      reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false } },
    strategicAnalysis: { kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '',
      strategicRecommendations: '', fullContent: 'Strategy' },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: 'Governance' },
    consolidatedReport: 'Financial report', generatedAt: '2026-09-05T00:00:00Z',
  };
}

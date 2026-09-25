// Fixtures compartidas por las pruebas de Parte IV (no es un archivo de prueba).
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { FiscalReviewReportJson } from '../../contracts/audit-report';

export const COMPANY = { name: 'Perdidas SAS', nit: '900123456', fiscalPeriod: '2025', entityType: 'SAS' };

export function fiscalJson(over: Partial<FiscalReviewReportJson> = {}): FiscalReviewReportJson {
  return {
    complianceScore: 95,
    executiveSummary: 'Los EEFF presentan razonablemente.',
    materiality: { benchmarkLabel: '5% UAI', materialityAmountCop: '100000', performanceMateriality: '75000', comment: 'ok' },
    goingConcern: { hasMaterialUncertainty: false, indicatorsFound: [], conclusion: 'ok' },
    findings: [],
    opinionType: 'favorable',
    dictamen: 'Opinión favorable.',
    formalObligations: null,
    criticalSaldos: null,
    dianRiskIndicators: null,
    riesgoFiscalizacionGlobal: null,
    obligations2026: null,
    fiscalAuditOpinion: null,
    fiscalRequiredActions: null,
    ...over,
  };
}

export function simpleJson(score: number) {
  return {
    complianceScore: score,
    executiveSummary: 's',
    findings: [],
    conclusion: 'c',
    totalFiscalExposureCop: null,
    niifSectionChecks: null, summaryStats: null, auditOpinion: null, requiredActions: null,
    rentaAnalysis: null, retencionesAnalysis: null, ivaIcaAnalysis: null, tmtAnalysis: null,
    riesgosTributarios: null, calendario2026: null,
    societaryObligations: null, patrimonyDistribution: null, capitalizacionAnalysis: null, riesgosLegales: null,
  };
}

export function critical(code: string, over: Partial<{ pervasive: boolean | null; scopeLimitation: boolean | null }> = {}) {
  return {
    code, severity: 'critico' as const, title: 'Inventario sin conteo', description: 'd', normReference: 'NIA 705 par. 7',
    recommendation: 'r', impact: 'i', period: null, impactCop: null,
    pervasive: over.pervasive ?? null, scopeLimitation: over.scopeLimitation ?? null,
  };
}

/** Snapshot mínimo del preprocesador (sólo los campos que leen los auditores). */
export function snapshot(over: { equationBalanced?: boolean; period?: string } = {}) {
  return {
    period: over.period ?? '2025',
    classes: [
      {
        code: 1, name: 'Activo', auxiliaryTotal: 0, reportedTotal: null, discrepancy: 0,
        accounts: [
          { code: '110505', name: 'Caja general', level: 'aux', balance: 6_000_000, isLeaf: true },
          { code: '135505', name: 'Anticipo de impuestos de renta', level: 'aux', balance: 100_000, isLeaf: true },
          { code: '135515', name: 'Retención en la fuente', level: 'aux', balance: 50_000, isLeaf: true },
          { code: '135517', name: 'Impuesto a las ventas retenido', level: 'aux', balance: 30_000, isLeaf: true },
          { code: '135518', name: 'Impuesto de industria y comercio retenido', level: 'aux', balance: 20_000, isLeaf: true },
          { code: '180505', name: 'Bienes de arte y cultura', level: 'aux', balance: 999_000, isLeaf: true },
        ],
      },
      {
        code: 2, name: 'Pasivo', auxiliaryTotal: 0, reportedTotal: null, discrepancy: 0,
        accounts: [
          { code: '220505', name: 'Proveedores nacionales', level: 'aux', balance: 950_000, isLeaf: true },
          { code: '240405', name: 'Renta y complementarios vigencia corriente', level: 'aux', balance: 400_000, isLeaf: true },
          { code: '240805', name: 'IVA por pagar', level: 'aux', balance: 300_000, isLeaf: true },
        ],
      },
    ],
    controlTotals: {
      activo: 10_000_000, activoCorriente: 0, activoNoCorriente: 0,
      pasivo: 1_000_000, pasivoCorriente: 0, pasivoNoCorriente: 0,
      patrimonio: 9_000_000, ingresos: 50_000_000, gastos: 40_000_000, utilidadNeta: 10_000_000,
      efectivoCuenta11: 6_000_000, deudoresCuenta13: 0, cuentasPorPagar23: 0, impuestosCuenta24: 700_000,
      obligacionesLaborales25: 0,
      cents: {
        activo: BigInt(1_000_000_000), pasivo: BigInt(100_000_000), patrimonio: BigInt(900_000_000),
        ingresos: BigInt(5_000_000_000), gastos: BigInt(4_000_000_000), utilidadNeta: BigInt(1_000_000_000),
        utilidadAntesImpuestos: BigInt(1_500_000_000), impuestoCausado: BigInt(500_000_000),
        efectivoCuenta11: BigInt(600_000_000), totalDevoluciones: BigInt(0), ingresosNetos: BigInt(5_000_000_000),
        saldoAFavorImpuesto: BigInt(0),
      },
    },
    equityBreakdown: { capitalSuscritoPagado: 1_000_000, reservaLegal: 0, otrasReservas: 0, utilidadesAcumuladas: 0 },
    summary: {
      totalAssets: 10_000_000, totalLiabilities: 1_000_000, totalEquity: 9_000_000, totalRevenue: 50_000_000,
      totalExpenses: 40_000_000, totalCosts: 100_000, totalProduction: 0, netIncome: 10_000_000,
      equationBalance: over.equationBalanced === false ? 1 : 0, equationBalanced: over.equationBalanced ?? true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
  };
}

export function preprocessed(over: { equationBalanced?: boolean } = {}): PreprocessedBalance {
  const primary = snapshot(over);
  return {
    periods: [primary], primary, comparative: null, rawRows: [], auxiliaryCount: 11, cleanData: '',
    validationReport: '', comparativos_impracticables: true,
  } as unknown as PreprocessedBalance;
}

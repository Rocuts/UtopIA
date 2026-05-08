import { describe, expect, it } from 'vitest';

import {
  auditReportEmittable,
  reportConstituyeReservaLegal,
  reportIncluyeTMTCalculada,
  reportMencionaIFRS18,
  type AuditCompanyContext,
} from '../audit-report-emittable';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildSnapshot(opts: {
  activo?: number;
  pasivo?: number;
  patrimonio?: number;
  ingresos?: number;
  gastos?: number;
  utilidadNeta?: number;
  uai?: number;
  impuestoCausado?: number;
  efectivoCuenta11?: number;
  findings?: PeriodSnapshot['findings'];
} = {}): PeriodSnapshot {
  const activo = opts.activo ?? 1_000_000;
  const pasivo = opts.pasivo ?? 600_000;
  const patrimonio = opts.patrimonio ?? activo - pasivo; // ecuación cuadra por default
  const ingresos = opts.ingresos ?? 0;
  const gastos = opts.gastos ?? 0;
  const utilidadNeta = opts.utilidadNeta ?? ingresos - gastos;
  const uai = opts.uai ?? utilidadNeta;
  const impuestoCausado = opts.impuestoCausado ?? 0;
  const efectivoCuenta11 = opts.efectivoCuenta11 ?? 0;

  const toCents = (v: number) => BigInt(Math.round(v * 100));
  const toRaw = (v: number) => {
    const cents = Math.round(v * 100);
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
  };

  return {
    period: '2025',
    classes: [],
    controlTotals: {
      activo,
      activoCorriente: activo,
      activoNoCorriente: 0,
      pasivo,
      pasivoCorriente: pasivo,
      pasivoNoCorriente: 0,
      patrimonio,
      ingresos,
      gastos,
      utilidadNeta,
      efectivoCuenta11,
      deudoresCuenta13: 0,
      cuentasPorPagar23: 0,
      impuestosCuenta24: 0,
      obligacionesLaborales25: 0,
      cents: {
        activo: toCents(activo),
        pasivo: toCents(pasivo),
        patrimonio: toCents(patrimonio),
        ingresos: toCents(ingresos),
        gastos: toCents(gastos),
        utilidadNeta: toCents(utilidadNeta),
        utilidadAntesImpuestos: toCents(uai),
        impuestoCausado: toCents(impuestoCausado),
        efectivoCuenta11: toCents(efectivoCuenta11),
      },
      raw: {
        activo: toRaw(activo),
        pasivo: toRaw(pasivo),
        patrimonio: toRaw(patrimonio),
        ingresos: toRaw(ingresos),
        gastos: toRaw(gastos),
        utilidadNeta: toRaw(utilidadNeta),
        utilidadAntesImpuestos: toRaw(uai),
        impuestoCausado: toRaw(impuestoCausado),
        efectivoCuenta11: toRaw(efectivoCuenta11),
      },
    },
    equityBreakdown: {},
    summary: {
      totalAssets: activo,
      totalLiabilities: pasivo,
      totalEquity: patrimonio,
      totalRevenue: ingresos,
      totalExpenses: gastos,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: utilidadNeta,
      equationBalance: activo - pasivo - patrimonio,
      equationBalanced: Math.abs(activo - pasivo - patrimonio) < 1,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
    findings: opts.findings ?? {},
  };
}

function buildReport(consolidatedReport: string): FinancialReport {
  return {
    company: { name: 'Grupo Empresarial 2 Tres SAS', nit: '901714014-6', fiscalPeriod: '2025' },
    niifAnalysis: {
      balanceSheet: '',
      incomeStatement: '',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: '',
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '',
      fullContent: '',
    },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport,
    generatedAt: '2026-05-08T00:00:00Z',
  };
}

const validCompany: AuditCompanyContext = {
  razonSocialFromFile: 'Grupo Empresarial 2 Tres SAS',
  nitFromFile: '901714014-6',
  nit: '901714014-6',
  niifGroup: 2,
  tipoSocietario: 'SAS',
  estatutosRequierenReservaLegal: undefined,
};

// Reporte mínimo que pasa V8 / V9 / V10:
const HEALTHY_REPORT = `
# Informe Grupo 2 PYME

Estados financieros NIIF para PYMES (Decreto 2420/2015).
Tarifa general 35% aplicada. TMT 15% calculada (parágrafo 6 Art. 240 ET).
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auditReportEmittable — gate V1..V12', () => {
  it('snapshot saludable + reporte saludable → emittable=true, blockers=[]', () => {
    const snap = buildSnapshot({ activo: 100, pasivo: 60, patrimonio: 40 });
    const report = buildReport(HEALTHY_REPORT);
    const r = auditReportEmittable(report, snap, validCompany);
    expect(r.emittable).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it('V1: ecuación rota (activo ≠ pasivo + patrimonio) → blocker V1', () => {
    const snap = buildSnapshot({ activo: 100, pasivo: 60, patrimonio: 50 });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.emittable).toBe(false);
    expect(r.blockers.some((b) => b.code === 'V1')).toBe(true);
  });

  it('V2: U Neta ≠ UAI − Impuesto Causado → blocker V2', () => {
    // ingresos 1000, gastos 800 → utilidadNeta 200
    // UAI declarada = 300, impuesto = 50 → expected uNeta = 250 ≠ 200
    const snap = buildSnapshot({
      ingresos: 1000,
      gastos: 800,
      utilidadNeta: 200,
      uai: 300,
      impuestoCausado: 50,
    });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V2')).toBe(true);
  });

  it('V5: identidad sin extraer del archivo → blocker V5', () => {
    const snap = buildSnapshot();
    const company: AuditCompanyContext = {
      ...validCompany,
      razonSocialFromFile: null,
      nitFromFile: null,
    };
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, company);
    expect(r.blockers.some((b) => b.code === 'V5')).toBe(true);
  });

  it('V5: placeholder "Triple SSS" en reporte → blocker V5', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(
      buildReport(HEALTHY_REPORT + '\n\nEmpresa: Triple SSS'),
      snap,
      validCompany,
    );
    expect(r.blockers.some((b) => b.code === 'V5')).toBe(true);
  });

  it('V6: NIT con DV inválido (213.092.082-1) → blocker V6', () => {
    const snap = buildSnapshot();
    const company: AuditCompanyContext = {
      ...validCompany,
      nitFromFile: '213.092.082-1',
      nit: '213.092.082-1',
    };
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, company);
    expect(r.blockers.some((b) => b.code === 'V6')).toBe(true);
  });

  it('V7: cuenta18UsadaComoGasto=true → blocker V7', () => {
    const snap = buildSnapshot({
      findings: { cuenta18UsadaComoGasto: true },
    });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V7')).toBe(true);
  });

  it('V8: IFRS 18 mencionada en informe Grupo 2 → blocker V8', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(
      buildReport(HEALTHY_REPORT + '\n\nNota IFRS 18: preparación obligatoria.'),
      snap,
      validCompany,
    );
    expect(r.blockers.some((b) => b.code === 'V8')).toBe(true);
  });

  it('V8: IFRS 18 mencionada en Grupo 1 → permitido (no blocker)', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(
      buildReport(HEALTHY_REPORT + '\n\nNota IFRS 18: preparación obligatoria.'),
      snap,
      { ...validCompany, niifGroup: 1 },
    );
    expect(r.blockers.some((b) => b.code === 'V8')).toBe(false);
  });

  it('V9: SAS con "constitución reserva legal" sin estatutos → blocker V9', () => {
    const snap = buildSnapshot();
    const reporte = HEALTHY_REPORT + '\n\nSe constituye la reserva legal del 10% conforme al Art. 40 Ley 1258.';
    const r = auditReportEmittable(buildReport(reporte), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V9')).toBe(true);
  });

  it('V9: SAS con habilitación estatutaria explícita → NO blocker V9', () => {
    const snap = buildSnapshot();
    const reporte = HEALTHY_REPORT + '\n\nSe constituye la reserva legal del 10%.';
    const r = auditReportEmittable(buildReport(reporte), snap, {
      ...validCompany,
      estatutosRequierenReservaLegal: true,
    });
    expect(r.blockers.some((b) => b.code === 'V9')).toBe(false);
  });

  it('V10: informe sin TMT → blocker V10', () => {
    const snap = buildSnapshot();
    // Reporter sin mencionar TMT, "tasa minima", "parágrafo 6", ni "tributación mínima".
    const reporte = '# Informe stub';
    const r = auditReportEmittable(buildReport(reporte), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V10')).toBe(true);
  });

  it('V11: missingTaxCausation=true → blocker V11', () => {
    const snap = buildSnapshot({ findings: { missingTaxCausation: true } });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V11')).toBe(true);
  });

  it('V12: librosNoCerrados=true → blocker V12 + suggestedAdjustments', () => {
    const snap = buildSnapshot({ findings: { librosNoCerrados: true } });
    snap.closingDetectorAudit = {
      utilidadTransitoriaCop: 1_000_000,
      grupo36SaldoCop: 0,
      grupo37SaldoCop: 0,
      librosNoCerrados: true,
      suggestedClosingEntries: [
        'Cierre clase 4 → Cr. 5905 por $1.000.000.',
        'Cierre clase 5 → Dr. 5905 por $0.',
        'Traslado utilidad → Cr. 3605 por $1.000.000.',
      ],
    };
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.emittable).toBe(false);
    expect(r.blockers.some((b) => b.code === 'V12')).toBe(true);
    expect(r.suggestedAdjustments.length).toBeGreaterThanOrEqual(3);
  });
});

describe('helpers de inspección de reporte', () => {
  it('reportMencionaIFRS18 detecta variantes "IFRS 18" y "IFRS18"', () => {
    expect(reportMencionaIFRS18('preparación IFRS 18')).toBe(true);
    expect(reportMencionaIFRS18('IFRS18 lookahead')).toBe(true);
    expect(reportMencionaIFRS18('NIIF para PYMES')).toBe(false);
  });

  it('reportConstituyeReservaLegal detecta constitución activa', () => {
    expect(reportConstituyeReservaLegal('Se constituye la reserva legal del 10%')).toBe(true);
    expect(reportConstituyeReservaLegal('aplicación de reserva legal')).toBe(true);
    expect(reportConstituyeReservaLegal('Reserva legal: NO obligatoria')).toBe(false);
  });

  it('reportConstituyeReservaLegal: cita Art. 40 Ley 1258 → flag rojo', () => {
    expect(reportConstituyeReservaLegal('conforme al Art. 40 Ley 1258 de 2008')).toBe(true);
  });

  it('reportIncluyeTMTCalculada detecta TMT, "tasa mínima", "parágrafo 6"', () => {
    expect(reportIncluyeTMTCalculada('TMT 15% calculada')).toBe(true);
    expect(reportIncluyeTMTCalculada('tasa mínima de tributación')).toBe(true);
    expect(reportIncluyeTMTCalculada('parágrafo 6 del Art. 240 ET')).toBe(true);
    expect(reportIncluyeTMTCalculada('renta ordinaria 35% sin TMT')).toBe(true);
    expect(reportIncluyeTMTCalculada('renta ordinaria 35% sin nada más')).toBe(false);
  });
});

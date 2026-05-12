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
  saldoAFavorImpuesto?: number;
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
        saldoAFavorImpuesto: toCents(opts.saldoAFavorImpuesto ?? 0),
        // Wave 2.F4 — Devoluciones 4175 + ingresos netos (defaults 0/ingresos).
        totalDevoluciones: toCents(0),
        ingresosNetos: toCents(Math.abs(ingresos)),
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
        saldoAFavorImpuesto: toRaw(opts.saldoAFavorImpuesto ?? 0),
        totalDevoluciones: toRaw(0),
        ingresosNetos: toRaw(Math.abs(ingresos)),
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

// ---------------------------------------------------------------------------
// V13/V14/V15 — Pulido NIIF PYME Grupo 2 (signo impuesto, margen CIIU G,
// comparativos impracticables). Estos tres bloqueadores consumen el
// `EmittableEliteContext` opcional (4º parámetro del gate).
// ---------------------------------------------------------------------------

describe('auditReportEmittable — V13 (signo del impuesto de renta)', () => {
  it('impuestoCausado >= 0 → V13 NO dispara', () => {
    const snap = buildSnapshot({ impuestoCausado: 50 });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V13')).toBe(false);
  });

  it('impuestoCausado < 0 (presentado como ingreso) → blocker V13', () => {
    // ingresos 1000, gastos 700, UAI = 300, impuesto = -50 (crédito) → uNeta = 350.
    const snap = buildSnapshot({
      ingresos: 1000,
      gastos: 700,
      uai: 300,
      impuestoCausado: -50,
      utilidadNeta: 350,
    });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V13')).toBe(true);
  });

  it('impuestoCausado === 0 con saldoAFavor > 0 → V13 NO dispara (caso correcto)', () => {
    const snap = buildSnapshot({ impuestoCausado: 0, saldoAFavorImpuesto: 3_840_000 });
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V13')).toBe(false);
  });
});

describe('auditReportEmittable — V14 (margen bruto CIIU G + costos no descargados)', () => {
  it('sin actividadInferida → V14 NO dispara', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany);
    expect(r.blockers.some((b) => b.code === 'V14')).toBe(false);
  });

  it('actividadInferida sectorCIIU=G + evidencia "clase 6 ausente" → blocker V14', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany, {
      actividadInferida: {
        sectorCIIU: 'G',
        descripcion: 'Comercio al por mayor y al por menor',
        evidencia: [
          'Cuenta 1435 (Mercancías no fabricadas) = $1.668M (67% del activo corriente).',
          'Clase 6 (Costo de Ventas) ausente del balance.',
        ],
      },
    });
    expect(r.blockers.some((b) => b.code === 'V14')).toBe(true);
  });

  it('actividadInferida sectorCIIU=G + evidencia "clase 6 inmaterial" → blocker V14', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany, {
      actividadInferida: {
        sectorCIIU: 'G',
        descripcion: 'Comercio',
        evidencia: ['Clase 6 (Costo de Ventas) inmaterial: $5.000 < 1% de los ingresos.'],
      },
    });
    expect(r.blockers.some((b) => b.code === 'V14')).toBe(true);
  });

  it('actividadInferida sectorCIIU=G pero sin evidencia de costeo incompleto → V14 NO dispara', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany, {
      actividadInferida: {
        sectorCIIU: 'G',
        descripcion: 'Comercio',
        // Inferencia (b): inventarios > 30% activo, pero clase 6 sí presente y material.
        evidencia: ['Inventarios totales (Clase 14) = $500M (35% del activo total).'],
      },
    });
    expect(r.blockers.some((b) => b.code === 'V14')).toBe(false);
  });

  it('actividadInferida sectorCIIU=F (construcción) → V14 NO dispara aunque haya costeo incompleto', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany, {
      actividadInferida: {
        sectorCIIU: 'F',
        descripcion: 'Construcción',
        evidencia: ['Clase 6 (Costo de Ventas) ausente del balance.'],
      },
    });
    // V14 sólo es para CIIU G — otros sectores (servicios, construcción) tienen
    // estructuras de costo distintas que no se diagnostican igual.
    expect(r.blockers.some((b) => b.code === 'V14')).toBe(false);
  });
});

describe('auditReportEmittable — V15 (comparativos impracticables sin declaración)', () => {
  it('comparativos_impracticables=false → V15 NO dispara', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany, {
      comparativos_impracticables: false,
    });
    expect(r.blockers.some((b) => b.code === 'V15')).toBe(false);
  });

  it('comparativos_impracticables=true + reporte SIN declaración → blocker V15', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(buildReport(HEALTHY_REPORT), snap, validCompany, {
      comparativos_impracticables: true,
    });
    expect(r.blockers.some((b) => b.code === 'V15')).toBe(true);
  });

  it('comparativos_impracticables=true + reporte CON declaración explícita ("impracticable") → V15 NO dispara', () => {
    const snap = buildSnapshot();
    const reportWithDeclaration = `${HEALTHY_REPORT}
Los estados financieros se presentan sin comparativos del periodo 2024 dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF for SMEs §3.14, §10.21).`;
    const r = auditReportEmittable(buildReport(reportWithDeclaration), snap, validCompany, {
      comparativos_impracticables: true,
    });
    expect(r.blockers.some((b) => b.code === 'V15')).toBe(false);
  });

  it('comparativos_impracticables=true + reporte cita §3.14 → V15 NO dispara', () => {
    const snap = buildSnapshot();
    const r = auditReportEmittable(
      buildReport(`${HEALTHY_REPORT}\nNota X: comparativos no disponibles (NIIF for SMEs §3.14).`),
      snap,
      validCompany,
      { comparativos_impracticables: true },
    );
    expect(r.blockers.some((b) => b.code === 'V15')).toBe(false);
  });
});

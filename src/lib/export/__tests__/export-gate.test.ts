// Regresiones del gate de exportación (financial-export-validation.ts):
//   pipeline-flujo-13  — no cruzaba el JSON contra las anclas del rawData.
//   reportes-export-07 — comparativos inventados, subtotales arbitrarios sin
//                        código, renglones del ERI fuera de 4–7 y E6 pasaban.
//   reportes-export-10 — report.company distinto de json.company pasaba.
import { describe, expect, it } from 'vitest';
import { financialExportBlockers } from '../financial-export-validation';
import {
  makeCoherentNiifReport,
  makeExportableReport,
} from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

type Line = NiifReportJson['balanceSheet']['assets'][number];
const L = (account: string | null, amountPrimary: string, amountComparative: string | null = null, extra: Partial<Line> = {}): Line => ({
  account, label: account ?? 'Subtotal', amountPrimary, amountComparative,
  level: 2, isAbsolute: false, confidence: null, anomalyFlag: null, ...extra,
});

function reportFrom(json: NiifReportJson): FinancialReport {
  const r = makeExportableReport();
  return {
    ...r,
    company: { name: json.company.name, nit: json.company.nit, fiscalPeriod: json.company.fiscalPeriod },
    niifAnalysis: { ...r.niifAnalysis, json },
  };
}

/** Informe 2025 vs 2024 coherente en ambas columnas. */
function comparative(): NiifReportJson {
  const json = makeCoherentNiifReport();
  json.company.comparativePeriod = '2024';
  const bs = json.balanceSheet;
  bs.assets = [L('11', '170000', '100000'), L('13', '830000', '700000')];
  // Patrimonio 2024 = saldo inicial del ECP del fixture base (E19, NIIF PYMES 6.3).
  bs.liabilities = [L('22', '400000', '400000')];
  bs.equity = [L('31', '600000', '400000')];
  Object.assign(bs, { totalAssetsComparative: '800000', totalLiabilitiesComparative: '400000', totalEquityComparative: '400000' });
  const is = json.incomeStatement;
  is.lines = [L('4', '700000', '600000'), L('6', '200000', '200000'), L('51', '200000', '150000'), L('53', '100000', '50000')];
  Object.assign(is, { grossProfitComparative: '400000', operatingProfitComparative: '250000', netIncomeComparative: '200000', oriComparative: '0' });
  return json;
}

describe('gate — punto de partida', () => {
  it('los fixtures coherentes (periodo único y comparativo) se exportan', () => {
    expect(financialExportBlockers(makeExportableReport())).toEqual([]);
    expect(financialExportBlockers(reportFrom(comparative()))).toEqual([]);
  });
});

describe('reportes-export-07 — columna comparativa, subtotales, códigos del ERI y E6', () => {
  it('una línea comparativa del Balance inventada (la columna 2024 no suma) bloquea', () => {
    const json = comparative();
    json.balanceSheet.assets[0].amountComparative = '1000000';
    const b = financialExportBlockers(reportFrom(json));
    expect(b.some((m) => m.startsWith('Comparativo 2024: E15.'))).toBe(true);
  });

  it('un renglón comparativo del ERI inventado (la cascada 2024 no cierra) bloquea', () => {
    const json = comparative();
    json.incomeStatement.lines[0].amountComparative = '1500000';
    const b = financialExportBlockers(reportFrom(json));
    expect(b.some((m) => m.startsWith('Comparativo 2024: E16.'))).toBe(true);
  });

  it('subtotal del Balance sin código con cifra arbitraria bloquea; uno honesto pasa', () => {
    const bad = makeCoherentNiifReport();
    bad.balanceSheet.assets.splice(2, 0, L(null, '999999999', null, { level: 3, label: 'TOTAL ACTIVO CORRIENTE' }));
    expect(financialExportBlockers(reportFrom(bad)).some((m) => m.includes('TOTAL ACTIVO CORRIENTE'))).toBe(true);

    const ok = makeCoherentNiifReport();
    ok.balanceSheet.assets.splice(2, 0, L(null, '1000000', null, { level: 3, label: 'TOTAL ACTIVO CORRIENTE' }));
    ok.balanceSheet.assets.splice(1, 0, L(null, '170000', null, { level: 3, label: 'Subtotal efectivo' }));
    expect(financialExportBlockers(reportFrom(ok))).toEqual([]);
  });

  it('un subtotal comparativo arbitrario también bloquea', () => {
    const json = comparative();
    json.balanceSheet.assets.push(L(null, '1000000', '123', { level: 4, label: 'TOTAL ACTIVOS' }));
    expect(financialExportBlockers(reportFrom(json)).some((m) => m.startsWith('Balance 2024'))).toBe(true);
  });

  it('renglón del ERI con código de clase 8/9 bloquea', () => {
    const json = makeCoherentNiifReport();
    json.incomeStatement.lines.push(L('8105', '500000000', null, { label: 'Ingreso extraordinario' }));
    expect(financialExportBlockers(reportFrom(json)).some((m) => m.includes('8105'))).toBe(true);
  });

  it('ORI del ERI distinto de la variación del ORI en el ECP (E6) bloquea', () => {
    const json = makeCoherentNiifReport();
    json.incomeStatement.oriPrimary = '50000';
    expect(financialExportBlockers(reportFrom(json)).some((m) => m.startsWith('E6.'))).toBe(true);
  });

  it('ECP vacío bloquea', () => {
    const json = makeCoherentNiifReport();
    json.equityChanges.rows = [];
    const b = financialExportBlockers(reportFrom(json));
    expect(b.some((m) => m.startsWith('E4.'))).toBe(true);
  });
});

describe('reportes-export-10 — identidad del informe', () => {
  it('empresa, NIT o periodo del encabezado distintos de los del JSON bloquean', () => {
    const report = makeExportableReport();
    report.company = { ...report.company, name: 'Otra Empresa SAS', nit: '800999888', fiscalPeriod: '2024' };
    const b = financialExportBlockers(report);
    expect(b.filter((m) => m.startsWith('Identidad:'))).toHaveLength(3);
  });

  it('el NIT con dígito de verificación no es una discrepancia', () => {
    const report = makeExportableReport();
    report.company = { ...report.company, nit: '900.123.456-7', name: 'empresa prueba s.a.s.'.replace('s.a.s.', 'SAS') };
    expect(financialExportBlockers(report)).toEqual([]);
  });
});

describe('pipeline-flujo-13 — procedencia contra el rawData de la petición', () => {
  // Balanza de OTRA empresa: activo $50.000.000, pasivo $20.000.000…
  const OTHER_CSV = [
    'Codigo,Nombre,Nivel,Transaccional,Saldo 2025',
    '110505,Caja,Auxiliar,Si,50000000',
    '220505,Proveedores,Auxiliar,Si,20000000',
    '310505,Capital,Auxiliar,Si,20000000',
    '413505,Ventas,Auxiliar,Si,90000000',
    '510506,Sueldos,Auxiliar,Si,80000000',
  ].join('\n');

  it('un informe coherente pero ajeno a la balanza enviada no se exporta', () => {
    const pre = preprocessTrialBalance(parseTrialBalanceCSV(OTHER_CSV));
    const b = financialExportBlockers(makeExportableReport(), pre);
    expect(b.some((m) => m.startsWith('E14.'))).toBe(true);
  });

  it('sin rawData el gate sólo prueba coherencia interna (límite documentado)', () => {
    expect(financialExportBlockers(makeExportableReport(), undefined)).toEqual([]);
  });
});

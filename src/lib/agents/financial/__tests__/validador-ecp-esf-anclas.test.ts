// ---------------------------------------------------------------------------
// ECP, subtotales del ESF, columna comparativa, efectivo y ORI
// ---------------------------------------------------------------------------
// Hallazgos de la auditoría 2026-09 cubiertos (niif-json-validator):
//   niif-contrato-06  subtotales impresos del ESF sin validar
//   niif-contrato-08  columna comparativa de los renglones sin identidad
//   niif-contrato-09  renglón de efectivo del ESF ≠ efectivo del EFE
//   niif-contrato-10  tolerancias no exactas del ECP (0,5% / $1.000)
//   niif-contrato-11  saldo inicial ECP vs patrimonio comparativo, columnas
//                     del cierre vs ESF, modo legacy sin cuadre, traslado
//                     3605 con total negativo
//   niif-contrato-12  ORI libre (E6 sólo warning)
// Fixture: estados coherentes con comparativo (cifras en centavos).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { NiifReportJson } from '../contracts/niif-report';
import { validateNiifReportJson, type NiifJsonValidatorOptions } from '../validators/niif-json-validator';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import type { PresentationV3Data } from '../prompts/presentation-v3';

type Line = NiifReportJson['balanceSheet']['assets'][number];
const L = (
  account: string | null,
  label: string,
  amountPrimary: string,
  amountComparative: string | null,
  level: 0 | 1 | 2 | 3 | 4 = 2,
  isAbsolute = true,
): Line => ({ account, label, amountPrimary, amountComparative, level, isAbsolute, confidence: null, anomalyFlag: null });

function rich(): { json: NiifReportJson; opts: NiifJsonValidatorOptions } {
  const json: NiifReportJson = {
    company: {
      name: 'Empresa Auditoria SA', nit: '900000001', entityType: 'SA', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null,
    },
    balanceSheet: {
      assets: [
        L(null, 'ACTIVO CORRIENTE', '0', null, 1),
        L('11', 'Efectivo y equivalentes', '1700000000', '1000000000'),
        L('13', 'Deudores comerciales', '5300000000', '4000000000'),
        L(null, 'Total activo corriente', '7000000000', '5000000000', 3),
        L(null, 'ACTIVO NO CORRIENTE', '0', null, 1),
        L('15', 'Propiedades, planta y equipo (bruto)', '4000000000', '3500000000'),
        L('1592', '(-) Depreciación acumulada', '1000000000', '500000000'),
        L(null, 'Total activo no corriente', '3000000000', '3000000000', 3),
      ],
      liabilities: [
        L('21', 'Obligaciones financieras', '1500000000', '1500000000'),
        L('22', 'Proveedores', '2500000000', '2000000000'),
        L(null, 'Total pasivo corriente', '4000000000', '3500000000', 3),
      ],
      equity: [
        L('31', 'Capital social', '3000000000', '3000000000'),
        L('33', 'Reservas', '500000000', '500000000'),
        L('37', 'Resultados acumulados', '500000000', '0'),
        L('36', 'Resultado del ejercicio', '2000000000', '1000000000'),
      ],
      totalAssetsPrimary: '10000000000', totalAssetsComparative: '8000000000',
      totalLiabilitiesPrimary: '4000000000', totalLiabilitiesComparative: '3500000000',
      totalEquityPrimary: '6000000000', totalEquityComparative: '4500000000',
      notes: [], modeBanner: null,
    },
    incomeStatement: {
      lines: [
        L('41', 'Ingresos de actividades ordinarias', '9000000000', '6000000000'),
        L('4175', '(-) Devoluciones en ventas', '500000000', '300000000'),
        L(null, 'Ingresos netos', '8500000000', '5700000000', 3),
        L('61', '(-) Costo de ventas', '3500000000', '2700000000'),
        L(null, 'Utilidad bruta', '5000000000', '3000000000', 3),
        L('51', '(-) Gastos de administración', '1500000000', '1000000000'),
        L('52', '(-) Gastos de ventas', '500000000', '200000000'),
        L(null, 'Utilidad operacional', '3000000000', '1800000000', 3),
        L('53', '(-) Gastos financieros', '200000000', '300000000'),
        L(null, 'Utilidad antes de impuestos', '2800000000', '1500000000', 3),
        L('54', '(-) Impuesto de renta', '800000000', '500000000'),
        L(null, 'Utilidad neta', '2000000000', '1000000000', 4),
      ],
      grossProfitPrimary: '5000000000', grossProfitComparative: '3000000000',
      operatingProfitPrimary: '3000000000', operatingProfitComparative: '1800000000',
      netIncomePrimary: '2000000000', netIncomeComparative: '1000000000',
      oriPrimary: '0', oriComparative: '0', notes: [], modeBanner: null,
    },
    cashFlow: {
      sections: [
        {
          section: 'operating',
          lines: [
            L(null, 'Utilidad neta del ejercicio', '2000000000', null, 2, false),
            L(null, 'Depreciación', '500000000', null, 2, false),
            L(null, 'Aumento de deudores', '-1300000000', null, 2, false),
            L(null, 'Aumento de proveedores', '500000000', null, 2, false),
          ],
          netFlow: '1700000000',
        },
        { section: 'investing', lines: [L(null, 'Adquisición de PPE', '-500000000', null, 2, false)], netFlow: '-500000000' },
        { section: 'financing', lines: [L(null, 'Dividendos pagados', '-500000000', null, 2, false)], netFlow: '-500000000' },
      ],
      netChange: '700000000', cashOpening: '1000000000', cashClosing: '1700000000',
      methodNote: 'indirect', degeneracyFlag: 'none',
    },
    equityChanges: {
      rows: [
        {
          kind: 'opening_balance', label: 'Saldo al 1 de enero de 2025',
          capitalSocial: '3000000000', primaColocacion: '0', reservaLegal: '500000000',
          otrasReservas: '0', resultadosAcumulados: '0', resultadoEjercicio: '1000000000', ori: '0', total: '4500000000',
        },
        {
          kind: 'prior_period_result_cancellation', label: 'Traslado resultado 2024 a acumulados',
          capitalSocial: '0', primaColocacion: '0', reservaLegal: '0',
          otrasReservas: '0', resultadosAcumulados: '1000000000', resultadoEjercicio: '-1000000000', ori: '0', total: '0',
        },
        {
          kind: 'dividend_distribution', label: 'Dividendos decretados y pagados',
          capitalSocial: '0', primaColocacion: '0', reservaLegal: '0',
          otrasReservas: '0', resultadosAcumulados: '-500000000', resultadoEjercicio: '0', ori: '0', total: '-500000000',
        },
        {
          kind: 'profit_for_period', label: 'Resultado del ejercicio 2025',
          capitalSocial: '0', primaColocacion: '0', reservaLegal: '0',
          otrasReservas: '0', resultadosAcumulados: '0', resultadoEjercicio: '2000000000', ori: '0', total: '2000000000',
        },
        {
          kind: 'closing_balance', label: 'Saldo al 31 de diciembre de 2025',
          capitalSocial: '3000000000', primaColocacion: '0', reservaLegal: '500000000',
          otrasReservas: '0', resultadosAcumulados: '500000000', resultadoEjercicio: '2000000000', ori: '0', total: '6000000000',
        },
      ],
      notes: [],
    },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false, cashFlowClosureForced: false, negativeAssetReclassified: false,
      presumedCostWarning: false, reclassifiedAmountCop: '0',
    },
    reportMode: 'COMPARATIVO_COMPLETO',
  };
  const opts: NiifJsonValidatorOptions = {
    bindingPrimaryTotalsCents: {
      totalAssets: '10000000000', totalLiabilities: '4000000000', totalEquity: '6000000000',
      netIncome: '2000000000', grossProfit: '5000000000', operatingProfit: '3000000000',
      utilidadAntesImpuestos: '2800000000', impuestoCausado: '800000000',
    },
    bindingComparativeTotalsCents: {
      totalAssets: '8000000000', totalLiabilities: '3500000000', totalEquity: '4500000000',
      grossProfit: '3000000000', operatingProfit: '1800000000', netIncome: '1000000000',
    },
    cashAccountPuc11Cents: '1700000000',
    totalExpensesClass5Cents: '3000000000',
  };
  return { json, opts };
}

const add = (s: string, d: string) => (BigInt(s) + BigInt(d)).toString();
const has = (list: string[], prefix: string) => list.some((e) => e.startsWith(prefix));
const exportBlocking = (r: { errors: string[]; warnings: string[] }) => [
  ...r.errors,
  ...r.warnings.filter((w) => w.startsWith('E15.')),
];

describe('fixture coherente', () => {
  it('no produce errores ni avisos bloqueantes de exportación', () => {
    const { json, opts } = rich();
    const r = validateNiifReportJson(json, opts);
    expect(exportBlocking(r)).toEqual([]);
  });
});

describe('ESF — subtotales y columna comparativa (niif-contrato-06, -08)', () => {
  it('un subtotal "Total activo corriente" alterado bloquea la exportación', () => {
    const { json, opts } = rich();
    json.balanceSheet.assets[3].amountPrimary = add(json.balanceSheet.assets[3].amountPrimary, '100000000');
    expect(exportBlocking(validateNiifReportJson(json, opts)).some((e) => e.includes('Total activo corriente'))).toBe(true);
  });

  it('un encabezado con monto que no sostiene ningún bloque bloquea la exportación', () => {
    const { json, opts } = rich();
    json.balanceSheet.assets[0].amountPrimary = '123400';
    expect(exportBlocking(validateNiifReportJson(json, opts)).some((e) => e.includes('ACTIVO CORRIENTE'))).toBe(true);
  });

  it('un renglón comparativo que no suma su total comparativo bloquea la exportación', () => {
    const { json, opts } = rich();
    json.balanceSheet.assets[2].amountComparative = add(json.balanceSheet.assets[2].amountComparative!, '1000000000');
    const r = validateNiifReportJson(json, opts);
    expect(r.warnings.some((w) => w.startsWith('E15.') && w.includes('comparativo'))).toBe(true);
  });

  it('la cascada comparativa del P&G que no cierra es error E16', () => {
    const { json, opts } = rich();
    json.incomeStatement.lines[0].amountComparative = add(json.incomeStatement.lines[0].amountComparative!, '100000000');
    const r = validateNiifReportJson(json, opts);
    expect(r.errors.some((e) => e.startsWith('E16.') && e.includes('comparativo'))).toBe(true);
  });
});

describe('ESF — renglón de efectivo (niif-contrato-09)', () => {
  it('mover $5.000.000 de Deudores (13) a Efectivo (11) conservando el total es error E3b', () => {
    const { json, opts } = rich();
    const a = json.balanceSheet.assets;
    a[1].amountPrimary = add(a[1].amountPrimary, '500000000');
    a[2].amountPrimary = add(a[2].amountPrimary, '-500000000');
    expect(has(validateNiifReportJson(json, opts).errors, 'E3b.')).toBe(true);
  });
});

describe('ECP — tolerancia $0 y anclas (niif-contrato-10, -11)', () => {
  it('profit_for_period $100.000 distinto de la utilidad neta, compensado con dividendos, es error E7a', () => {
    const { json, opts } = rich();
    const r = json.equityChanges.rows;
    const X = '10000000';
    const profit = r.find((x) => x.kind === 'profit_for_period')!;
    profit.resultadoEjercicio = add(profit.resultadoEjercicio, X);
    profit.total = add(profit.total, X);
    const div = r.find((x) => x.kind === 'dividend_distribution')!;
    div.resultadosAcumulados = add(div.resultadosAcumulados, '-' + X);
    div.total = add(div.total, '-' + X);
    const closing = r.find((x) => x.kind === 'closing_balance')!;
    closing.resultadoEjercicio = add(closing.resultadoEjercicio, X);
    closing.resultadosAcumulados = add(closing.resultadosAcumulados, '-' + X);
    expect(has(validateNiifReportJson(json, opts).errors, 'E7a.')).toBe(true);
  });

  it('filas que no suman el saldo final por $999,99 son error E7c', () => {
    const { json, opts } = rich();
    const div = json.equityChanges.rows.find((x) => x.kind === 'dividend_distribution')!;
    div.resultadosAcumulados = add(div.resultadosAcumulados, '99999');
    div.total = add(div.total, '99999');
    expect(has(validateNiifReportJson(json, opts).errors, 'E7c.')).toBe(true);
  });

  it('saldo inicial ≠ patrimonio comparativo compensado con "convergencia" es error E19', () => {
    const { json, opts } = rich();
    const r = json.equityChanges.rows;
    const X = '100000000';
    const opening = r.find((x) => x.kind === 'opening_balance')!;
    opening.capitalSocial = add(opening.capitalSocial, X);
    opening.total = add(opening.total, X);
    r.splice(1, 0, {
      kind: 'convergence_adjustment', label: 'Ajuste de convergencia',
      capitalSocial: '-' + X, primaColocacion: '0', reservaLegal: '0', otrasReservas: '0',
      resultadosAcumulados: '0', resultadoEjercicio: '0', ori: '0', total: '-' + X,
    });
    expect(has(validateNiifReportJson(json, opts).errors, 'E19.')).toBe(true);
  });

  it('capital del cierre del ECP ≠ renglón 31 del ESF es error E20', () => {
    const { json, opts } = rich();
    const r = json.equityChanges.rows;
    const X = '100000000';
    const closing = r.find((x) => x.kind === 'closing_balance')!;
    closing.capitalSocial = add(closing.capitalSocial, X);
    closing.resultadosAcumulados = add(closing.resultadosAcumulados, '-' + X);
    r.splice(r.length - 1, 0, {
      kind: 'capital_contribution', label: 'Capitalización',
      capitalSocial: X, primaColocacion: '0', reservaLegal: '0', otrasReservas: '0',
      resultadosAcumulados: '-' + X, resultadoEjercicio: '0', ori: '0', total: '0',
    });
    expect(has(validateNiifReportJson(json, opts).errors, 'E20.')).toBe(true);
  });

  it('el traslado del resultado anterior con total negativo (disminución sin contrapartida) es error E7b', () => {
    const { json, opts } = rich();
    const r = json.equityChanges.rows;
    const canc = r.find((x) => x.kind === 'prior_period_result_cancellation')!;
    canc.resultadosAcumulados = '0';
    canc.total = '-1000000000';
    const div = r.find((x) => x.kind === 'dividend_distribution')!;
    div.resultadosAcumulados = '500000000';
    div.total = '500000000';
    expect(has(validateNiifReportJson(json, opts).errors, 'E7b.')).toBe(true);
  });

  it('modo legacy (sin profit_for_period): el capital salta de 300.000 a 400.000 sin fila de aporte y es error E7c', () => {
    const json = makeCoherentNiifReport();
    const closing = json.equityChanges.rows[1];
    closing.capitalSocial = '400000';
    closing.resultadosAcumulados = '-50000';
    expect(has(validateNiifReportJson(json).errors, 'E7c.')).toBe(true);
  });

  it('modo legacy coherente (resultado implícito) no produce E7c', () => {
    expect(has(validateNiifReportJson(makeCoherentNiifReport()).errors, 'E7c.')).toBe(false);
  });
});

describe('ORI (niif-contrato-12)', () => {
  it('un oriPrimary inventado es error E6 (antes sólo warning)', () => {
    const { json, opts } = rich();
    json.incomeStatement.oriPrimary = '5000000000';
    expect(has(validateNiifReportJson(json, opts).errors, 'E6.')).toBe(true);
  });

  it('sin componentes ORI mapeados, un ORI distinto de cero es error E6b aunque el ECP lo acompañe', () => {
    const { json, opts } = rich();
    json.incomeStatement.oriPrimary = '5000000000';
    const closing = json.equityChanges.rows.find((x) => x.kind === 'closing_balance')!;
    closing.ori = '5000000000';
    const presentationV3 = { oriComponents: [] } as unknown as PresentationV3Data;
    expect(has(validateNiifReportJson(json, { ...opts, presentationV3 }).errors, 'E6b.')).toBe(true);
  });
});

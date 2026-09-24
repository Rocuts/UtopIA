// ---------------------------------------------------------------------------
// Grupo PUC 42 (ingresos no operacionales) DEBAJO de la utilidad operacional
// ---------------------------------------------------------------------------
// Hallazgos niif-contrato-01, niif-preproceso-24, niif-contrato-13 y
// prompts-normativa-22 (auditoría 2026-09). Decisión del coordinador: la
// Utilidad Bruta es ingresos operacionales netos (41 − 4175) menos costo de
// ventas (6/7); el EBIT es UB − 51 − 52; los otros ingresos (42) y gastos
// (53) no operacionales van entre el EBIT y la UAI. PUC Decreto 2650/1993:
// 42 = NO OPERACIONALES (4210 financieros, 4245 utilidad en venta de PPE).
// NIC 1.82(a)/NIIF PYMES 5.5(a): una ganancia por baja de PPE no es ingreso
// de actividades ordinarias.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildPeriodAnchors } from '../contracts/anchors';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import type { NiifReportJson } from '../contracts/niif-report';
import { buildNiifAnalystPass1Prompt } from '../prompts/niif-analyst.prompt';

// Pesos. Operacional: ventas 10M, costo 6M, admin 1M. No operacional:
// intereses 4210 1M, utilidad en venta de PPE 4245 0,5M, extraordinarios 5315 0,5M.
const CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  '110505,Caja general,Auxiliar,1,8000000',
  '310505,Capital suscrito y pagado,Auxiliar,1,4000000',
  '413505,Comercio al por mayor,Auxiliar,1,10000000',
  '421005,Intereses financieros,Auxiliar,1,1000000',
  '424504,Utilidad en venta de flota y equipo,Auxiliar,1,500000',
  '613505,Costo de mercancia vendida,Auxiliar,1,6000000',
  '510506,Sueldos,Auxiliar,1,1000000',
  '531520,Gastos extraordinarios,Auxiliar,1,500000',
].join('\n');

const M = (pesos: number) => BigInt(Math.round(pesos * 100));

describe('Grupo 42 debajo del EBIT — anclas y preprocesador', () => {
  const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
  const anchors = buildPeriodAnchors(pre.primary)!;

  it('la Utilidad Bruta anclada excluye los ingresos no operacionales (4210, 4245)', () => {
    expect(anchors.cents.ingresosNetos).toBe(M(11_500_000));
    expect(anchors.cents.ingresosOperacionales).toBe(M(10_000_000));
    expect(anchors.cents.otrosIngresos).toBe(M(1_500_000));
    expect(anchors.cents.utilidadBruta).toBe(M(4_000_000));
  });

  it('el EBIT anclado = UB − 51 − 52, sin el grupo 42', () => {
    expect(anchors.cents.ebit).toBe(M(3_000_000));
    // UAI = EBIT + otros ingresos (42) − gastos no operacionales (53).
    expect(anchors.cents.utilidadAntesImpuestos).toBe(M(4_000_000));
  });

  it('controlTotals.ebit del preprocesador tampoco incluye el grupo 42', () => {
    expect(pre.primary.controlTotals.ebit).toBe(3_000_000);
  });

  it('sin 5305 el gasto financiero no cae al grupo 53 completo (5315 extraordinarios)', () => {
    expect(pre.primary.controlTotals.gastoFinanciero5305).toBe(0);
    expect(pre.primary.controlTotals.coberturaIntereses).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Validador E14/E16 con el P&G presentado conforme al PUC
// ---------------------------------------------------------------------------

type Line = NiifReportJson['incomeStatement']['lines'][number];
const L = (account: string | null, amount: string, level: Line['level'] = 2, isAbsolute = true): Line => ({
  account,
  label: account ?? 'Subtotal',
  amountPrimary: amount,
  amountComparative: null,
  level,
  isAbsolute,
  confidence: null,
  anomalyFlag: null,
});

function pygConformeAlPuc(): NiifReportJson {
  const base = makeCoherentNiifReport();
  return {
    ...base,
    balanceSheet: {
      ...base.balanceSheet,
      assets: [L('11', '800000000')],
      liabilities: [],
      equity: [L('31', '400000000'), L('36', '400000000')],
      totalAssetsPrimary: '800000000',
      totalLiabilitiesPrimary: '0',
      totalEquityPrimary: '800000000',
    },
    incomeStatement: {
      ...base.incomeStatement,
      lines: [
        L('41', '1000000000'),
        L('61', '600000000'),
        L(null, '400000000', 3), // Utilidad bruta
        L('51', '100000000'),
        L(null, '300000000', 3), // Resultado operacional
        L('4210', '100000000'),
        L('4245', '50000000'),
        L('5315', '50000000'),
        L(null, '400000000', 3), // UAI
      ],
      grossProfitPrimary: '400000000',
      operatingProfitPrimary: '300000000',
      netIncomePrimary: '400000000',
    },
  };
}

const bindingPrimary = {
  totalAssets: '800000000',
  totalLiabilities: '0',
  totalEquity: '800000000',
  netIncome: '400000000',
  grossProfit: '400000000',
  operatingProfit: '300000000',
  utilidadAntesImpuestos: '400000000',
  impuestoCausado: '0',
};

const cascadeErrors = (errors: string[]) =>
  errors.filter((e) => e.startsWith('E14') || e.startsWith('E16'));

describe('Grupo 42 debajo del EBIT — validador E14/E16', () => {
  it('acepta el P&G con 4210 y 4245 entre el EBIT y la UAI', () => {
    const r = validateNiifReportJson(pygConformeAlPuc(), { bindingPrimaryTotalsCents: bindingPrimary });
    expect(cascadeErrors(r.errors)).toEqual([]);
  });

  it('rechaza el P&G que mete el grupo 42 dentro de la Utilidad Bruta', () => {
    const json = pygConformeAlPuc();
    json.incomeStatement.grossProfitPrimary = '550000000';
    json.incomeStatement.operatingProfitPrimary = '450000000';
    json.incomeStatement.lines = [
      L('41', '1000000000'),
      L('4210', '100000000'),
      L('4245', '50000000'),
      L('61', '600000000'),
      L('51', '100000000'),
      L('5315', '50000000'),
    ];
    const r = validateNiifReportJson(json, { bindingPrimaryTotalsCents: bindingPrimary });
    expect(r.errors.some((e) => e.startsWith('E14. GrossProfit'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('E16. Utilidad Bruta'))).toBe(true);
  });

  it('un renglón contranatura firmado (isAbsolute=false) no produce un falso E16 (niif-contrato-13)', () => {
    const json = pygConformeAlPuc();
    // 4250 recuperaciones con saldo débito −$1.000.000 presentado con signo.
    json.incomeStatement.lines = [
      L('41', '1000000000'),
      L('61', '600000000'),
      L('51', '100000000'),
      L('4250', '-100000000', 2, false),
      L('4210', '100000000'),
      L('4245', '50000000'),
      L('5315', '50000000'),
    ];
    json.incomeStatement.netIncomePrimary = '300000000';
    const r = validateNiifReportJson(json, {
      bindingPrimaryTotalsCents: { ...bindingPrimary, netIncome: '300000000', utilidadAntesImpuestos: '300000000' },
    });
    expect(cascadeErrors(r.errors)).toEqual([]);
  });

  it('un gasto contranatura firmado en convención natural (crédito negativo) cuadra', () => {
    const json = pygConformeAlPuc();
    // 5395 con saldo crédito −$0,2M en convención natural: RESTA −0,2M (suma).
    json.incomeStatement.lines = [
      L('41', '1000000000'),
      L('61', '600000000'),
      L('51', '100000000'),
      L('4210', '100000000'),
      L('4245', '50000000'),
      L('5315', '50000000'),
      L('5395', '-20000000', 2, false),
    ];
    json.incomeStatement.netIncomePrimary = '420000000';
    const r = validateNiifReportJson(json, {
      bindingPrimaryTotalsCents: { ...bindingPrimary, netIncome: '420000000', utilidadAntesImpuestos: '420000000' },
    });
    expect(cascadeErrors(r.errors)).toEqual([]);
  });
});

describe('Grupo 42 debajo del EBIT — prompt Pass-1', () => {
  const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
  const prompt = buildNiifAnalystPass1Prompt(
    { name: 'X SAS', nit: '900', niifGroup: 2, fiscalPeriod: '2025' } as never,
    'es',
    'LINEA_BASE',
    pre,
  );

  it('no define los ingresos operacionales como toda la clase 4 (41 + 42)', () => {
    expect(prompt).not.toMatch(/Ingresos operacionales del P&L = SUMA COMPLETA de Clase 4/);
    expect(prompt).not.toContain('Clase 4 (total) − Clase 6 (total) − Clase 5 (total) − Impuesto Renta');
  });

  it('publica la cascada vinculante del P&G con los tokens de UB, EBIT y otros ingresos', () => {
    expect(prompt).toContain('[MoneyCop: 400000000]'); // Utilidad Bruta
    expect(prompt).toContain('[MoneyCop: 300000000]'); // EBIT
    expect(prompt).toContain('[MoneyCop: 150000000]'); // Otros ingresos (42)
  });
});

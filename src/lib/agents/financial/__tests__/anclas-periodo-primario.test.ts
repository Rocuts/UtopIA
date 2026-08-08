// ---------------------------------------------------------------------------
// Regresión — anclaje del periodo PRIMARIO y token MoneyCop copiable
// ---------------------------------------------------------------------------
// Auditoría 2026-08, dos defectos del mismo eje.
//
// (1) P0 `totales-primarios-nunca-cruzados-contra-preprocesador`
//     El validador sólo cruzaba contra el preprocesador los totales del
//     periodo COMPARATIVO. Del periodo primario —el año que el cliente firma—
//     el único control era E1: `totalAssets = totalLiabilities + totalEquity`,
//     que es coherencia INTERNA. Un balance completamente inventado cuadra
//     consigo mismo sin esfuerzo, así que pasaba. En modo LINEA_BASE (sin
//     comparativo) NINGUNA cifra del informe se contrastaba contra la fuente.
//
// (2) P0 `anclas-en-pesos-schema-en-centavos`
//     El bloque TOTALES VINCULANTES emitía las anclas sólo en pesos
//     formateados (`$4.196.558.242,90`) mientras el schema exige centavos
//     enteros (`419655824290`). Cada cifra "vinculante" obligaba al modelo a
//     des-formatear y multiplicar por cien: un anclaje que exige aritmética
//     del modelo no ancla nada.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { buildPeriodAnchors, moneyCopToken } from '../contracts/anchors';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import type { NiifReportJson } from '../contracts/niif-report';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Reporte mínimo internamente coherente: 10.000.000 = 4.000.000 + 6.000.000.
// Es exactamente el caso que E1 aprueba y que E14 debe poder rechazar.
// ---------------------------------------------------------------------------
function makeReport(over: {
  totalAssets?: string;
  totalLiabilities?: string;
  totalEquity?: string;
  netIncome?: string;
} = {}): NiifReportJson {
  return {
    company: {
      name: 'Coherente Consigo Misma SAS',
      nit: '900123456',
      entityType: 'SAS',
      sector: 'Comercio',
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: null,
      city: 'Bogotá',
      signatories: null,
    },
    balanceSheet: {
      assets: [],
      liabilities: [],
      equity: [],
      totalAssetsPrimary: over.totalAssets ?? '1000000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: over.totalLiabilities ?? '400000000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: over.totalEquity ?? '600000000',
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [],
      grossProfitPrimary: '50000000',
      grossProfitComparative: null,
      operatingProfitPrimary: '30000000',
      operatingProfitComparative: null,
      netIncomePrimary: over.netIncome ?? '20000000',
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: [
        { section: 'operating', lines: [], netFlow: '0' },
        { section: 'investing', lines: [], netFlow: '0' },
        { section: 'financing', lines: [], netFlow: '0' },
      ],
      netChange: '0',
      cashOpening: '0',
      cashClosing: '0',
      methodNote: 'indirect',
      degeneracyFlag: null,
    },
    equityChanges: { rows: [], notes: [] },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
    reportMode: null,
  } as unknown as NiifReportJson;
}

/** Anclas del preprocesador: la verdad contra la que se contrasta. */
const ANCLAS_REALES = {
  totalAssets: '419655824290',
  totalLiabilities: '137600000000',
  totalEquity: '282055824290',
  netIncome: '15000000000',
};

const e14 = (r: { errors: string[] }) => r.errors.filter((e) => e.startsWith('E14'));

describe('E14 — anclaje del periodo primario al preprocesador', () => {
  it('un balance INVENTADO pero internamente coherente pasa E1 y es rechazado por E14', () => {
    const json = makeReport();

    // Sin anclas: sólo coherencia interna. Esto es lo que pasaba antes.
    const sinAnclas = validateNiifReportJson(json, {});
    expect(
      sinAnclas.errors.filter((e) => e.startsWith('E1.')),
      'E1 aprueba el balance inventado porque cuadra consigo mismo',
    ).toHaveLength(0);

    // Con anclas: el reporte no corresponde al archivo del cliente.
    const conAnclas = validateNiifReportJson(json, {
      bindingPrimaryTotalsCents: ANCLAS_REALES,
    });
    const fallos = e14(conAnclas);
    expect(
      fallos.length,
      'E14 debería rechazar los cuatro totales primarios inventados.\n' +
        conAnclas.errors.join('\n'),
    ).toBe(4);
    expect(conAnclas.ok).toBe(false);
    expect(fallos.join(' ')).toContain('TotalAssets');
    expect(fallos.join(' ')).toContain('TotalEquity');
    expect(fallos.join(' ')).toContain('NetIncome');
  });

  it('un reporte que copia las anclas al centavo pasa E14', () => {
    const json = makeReport({
      totalAssets: ANCLAS_REALES.totalAssets,
      totalLiabilities: ANCLAS_REALES.totalLiabilities,
      totalEquity: ANCLAS_REALES.totalEquity,
      netIncome: ANCLAS_REALES.netIncome,
    });
    const res = validateNiifReportJson(json, { bindingPrimaryTotalsCents: ANCLAS_REALES });
    expect(e14(res), res.errors.join('\n')).toHaveLength(0);
  });

  it('un centavo de diferencia también falla — la tolerancia es $0', () => {
    const json = makeReport({
      totalAssets: '419655824291', // +1 centavo
      totalLiabilities: ANCLAS_REALES.totalLiabilities,
      totalEquity: ANCLAS_REALES.totalEquity,
      netIncome: ANCLAS_REALES.netIncome,
    });
    const res = validateNiifReportJson(json, { bindingPrimaryTotalsCents: ANCLAS_REALES });
    const fallos = e14(res);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain('TotalAssets');
  });

  it('sin anclas suministradas E14 no se pronuncia (retrocompatibilidad)', () => {
    const res = validateNiifReportJson(makeReport(), {});
    expect(e14(res)).toHaveLength(0);
  });

  it('el mensaje de E14 le dice al analista de dónde copiar la cifra', () => {
    const res = validateNiifReportJson(makeReport(), {
      bindingPrimaryTotalsCents: ANCLAS_REALES,
    });
    expect(e14(res)[0]).toContain('[MoneyCop: N]');
  });
});

// ---------------------------------------------------------------------------
// Token copiable
// ---------------------------------------------------------------------------

describe('anclas — token MoneyCop', () => {
  it('el token es exactamente el string que exige el contrato', () => {
    // MoneyCop = /^-?\d+$/ : entero, sin separadores, sin decimales, sin $.
    expect(moneyCopToken(BigInt('419655824290'))).toBe('[MoneyCop: 419655824290]');
    expect(moneyCopToken(BigInt('-25000000'))).toBe('[MoneyCop: -25000000]');
    expect(moneyCopToken(BigInt(0))).toBe('[MoneyCop: 0]');

    const contenido = (t: string) => t.slice('[MoneyCop: '.length, -1);
    for (const v of ['419655824290', '-25000000', '0']) {
      expect(contenido(moneyCopToken(BigInt(v)))).toMatch(/^-?\d+$/);
    }
  });

  it('soporta magnitudes por encima del entero seguro de JS', () => {
    // $9.007.199.254.740.993,01 en centavos. Por encima de 2^53 el `number`
    // de JS ya no puede representar cada entero: pasar por él PIERDE dígitos.
    // Es la razón por la que el contrato viaja en BigInt.
    const exacto = '900719925474099301';
    const cents = BigInt(exacto);

    expect(Number.isSafeInteger(Number(cents))).toBe(false);
    expect(
      String(Number(cents)),
      'convertir a number pierde el último centavo — el token no debe hacerlo',
    ).not.toBe(exacto);

    expect(moneyCopToken(cents)).toBe(`[MoneyCop: ${exacto}]`);
  });
});

describe('buildPeriodAnchors', () => {
  const snapCents = {
    period: '2025',
    controlTotals: {
      activo: 4196558242.9,
      pasivo: 1376000000,
      patrimonio: 2820558242.9,
      ingresos: 0,
      gastos: 0,
      utilidadNeta: 150000000,
      cents: {
        activo: BigInt('419655824290'),
        pasivo: BigInt('137600000000'),
        patrimonio: BigInt('282055824290'),
        utilidadNeta: BigInt('15000000000'),
      },
    },
  } as unknown as PeriodSnapshot;

  it('prefiere los centavos exactos sobre la conversión desde float', () => {
    const a = buildPeriodAnchors(snapCents)!;
    expect(a.period).toBe('2025');
    expect(a.cents.activo).toBe(BigInt('419655824290'));
    expect(a.cents.patrimonio).toBe(BigInt('282055824290'));
  });

  it('cae a convertir desde pesos cuando el snapshot no trae cents', () => {
    const snapSinCents = {
      period: '2024',
      controlTotals: { activo: 1234567.89, pasivo: 0, patrimonio: 0 },
    } as unknown as PeriodSnapshot;
    const a = buildPeriodAnchors(snapSinCents)!;
    expect(a.cents.activo).toBe(BigInt(123456789));
  });

  it('devuelve null cuando no hay snapshot', () => {
    expect(buildPeriodAnchors(undefined)).toBeNull();
  });
});

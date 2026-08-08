// ---------------------------------------------------------------------------
// Regresión E15 — los renglones impresos suman el total impreso
// ---------------------------------------------------------------------------
// Auditoría 2026-08 (`sin-invariante-lineas-vs-total`). Ningún invariante
// exigía que la suma de las líneas de un estado fuera igual al total que ese
// mismo estado declara. Y todos los fixtures del validador usaban arrays de
// líneas VACÍOS, así que la brecha nunca se manifestó en la suite.
//
// Es el síntoma más visible para quien lee el informe: suma la columna con la
// calculadora y no le da el total impreso.
//
// La sutileza que hacía no trivial el chequeo: por regla del NIIF Analyst las
// líneas del Balance viajan con `isAbsolute = true`, así que la depreciación
// acumulada aparece como un POSITIVO aunque reste. Un chequeo ingenuo daría un
// exceso sistemático de 2× la correctora en toda empresa con PPE depreciado —
// es decir, ruido en casi todos los informes. Por eso E15 identifica las
// correctoras por su código PUC (Decreto 2650/1993).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { validateNiifReportJson } from '../validators/niif-json-validator';
import type { NiifReportJson } from '../contracts/niif-report';

interface LineaSpec {
  account: string | null;
  label: string;
  amount: string;
  level: 0 | 1 | 2 | 3 | 4;
  isAbsolute?: boolean;
}

function linea(l: LineaSpec) {
  return {
    account: l.account,
    label: l.label,
    amountPrimary: l.amount,
    amountComparative: null,
    level: l.level,
    isAbsolute: l.isAbsolute ?? true,
  };
}

function makeReport(over: {
  assets?: ReturnType<typeof linea>[];
  totalAssets?: string;
  totalLiabilities?: string;
  totalEquity?: string;
}): NiifReportJson {
  return {
    company: {
      name: 'Prueba SAS',
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
      assets: over.assets ?? [],
      liabilities: [],
      equity: [],
      totalAssetsPrimary: over.totalAssets ?? '100000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: over.totalLiabilities ?? '40000000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: over.totalEquity ?? '60000000',
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [],
      grossProfitPrimary: '0',
      grossProfitComparative: null,
      operatingProfitPrimary: '0',
      operatingProfitComparative: null,
      netIncomePrimary: '0',
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

const e15 = (r: { warnings: string[] }) => r.warnings.filter((w) => w.startsWith('E15'));

describe('E15 — suma de renglones vs total declarado', () => {
  it('detecta una tabla cuyos renglones no suman el total impreso', () => {
    // 40.000.000 + 30.000.000 = 70.000.000, pero el total dice 100.000.000.
    const json = makeReport({
      assets: [
        linea({ account: '1105', label: 'Caja', amount: '4000000000', level: 2 }),
        linea({ account: '1305', label: 'Clientes', amount: '3000000000', level: 2 }),
      ],
      totalAssets: '10000000000',
    });
    const res = validateNiifReportJson(json, {});
    const w = e15(res);
    expect(w, 'E15 no detectó la brecha:\n' + res.warnings.join('\n')).toHaveLength(1);
    expect(w[0]).toContain('Activo');
    expect(w[0]).toContain('MENOR');
  });

  it('acepta una tabla que sí cuadra', () => {
    const json = makeReport({
      assets: [
        linea({ account: '1105', label: 'Caja', amount: '4000000000', level: 2 }),
        linea({ account: '1305', label: 'Clientes', amount: '6000000000', level: 2 }),
      ],
      totalAssets: '10000000000',
    });
    expect(e15(validateNiifReportJson(json, {}))).toHaveLength(0);
  });

  it('la depreciación acumulada en valor absoluto RESTA, no suma', () => {
    // Es el caso que rompe el chequeo ingenuo: PPE bruto 800M, depreciación
    // acumulada 130M presentada como positivo (isAbsolute), neto 670M.
    // Sumar a ciegas daría 930M y marcaría un falso descuadre en toda empresa
    // con PPE depreciado.
    const json = makeReport({
      assets: [
        linea({ account: '152405', label: 'Muebles y enseres', amount: '80000000000', level: 2 }),
        linea({
          account: '159205',
          label: '(-) Depreciación acumulada',
          amount: '13000000000',
          level: 2,
          isAbsolute: true,
        }),
      ],
      totalAssets: '67000000000',
    });
    expect(
      e15(validateNiifReportJson(json, {})),
      'la correctora se sumó en vez de restarse',
    ).toHaveLength(0);
  });

  it('una correctora con signo propio también cuadra', () => {
    const json = makeReport({
      assets: [
        linea({ account: '152405', label: 'Muebles', amount: '80000000000', level: 2 }),
        linea({
          account: '159205',
          label: 'Depreciación acumulada',
          amount: '-13000000000',
          level: 2,
          isAbsolute: false,
        }),
      ],
      totalAssets: '67000000000',
    });
    expect(e15(validateNiifReportJson(json, {}))).toHaveLength(0);
  });

  it('ignora subtotales y totales: sólo suma el detalle (level 2)', () => {
    // Incluir el subtotal en la suma duplicaría el activo corriente.
    const json = makeReport({
      assets: [
        linea({ account: null, label: 'ACTIVO CORRIENTE', amount: '0', level: 1 }),
        linea({ account: '1105', label: 'Caja', amount: '4000000000', level: 2 }),
        linea({ account: '1305', label: 'Clientes', amount: '6000000000', level: 2 }),
        linea({ account: null, label: 'Total corriente', amount: '10000000000', level: 3 }),
      ],
      totalAssets: '10000000000',
    });
    expect(e15(validateNiifReportJson(json, {}))).toHaveLength(0);
  });

  it('no se pronuncia cuando el estado viene sin desglose', () => {
    // Es el caso de todos los fixtures viejos: arrays vacíos. Sin renglones no
    // hay nada que cuadrar, y por eso el defecto pasó inadvertido tanto tiempo.
    expect(e15(validateNiifReportJson(makeReport({}), {}))).toHaveLength(0);
  });

  it('un exceso se reporta como tal, con la pista de doble conteo', () => {
    const json = makeReport({
      assets: [
        linea({ account: '1105', label: 'Caja', amount: '8000000000', level: 2 }),
        linea({ account: '1305', label: 'Clientes', amount: '6000000000', level: 2 }),
      ],
      totalAssets: '10000000000',
    });
    const w = e15(validateNiifReportJson(json, {}));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('MAYOR');
    expect(w[0]).toContain('doble conteo');
  });

  it('es una advertencia, no un error: no bloquea un informe por sí sola', () => {
    // La clasificación de una línea puede ser legítimamente discutible; el
    // anclaje duro contra el preprocesador es E14.
    const json = makeReport({
      assets: [linea({ account: '1105', label: 'Caja', amount: '1', level: 2 })],
      totalAssets: '10000000000',
    });
    const res = validateNiifReportJson(json, {});
    expect(e15(res)).toHaveLength(1);
    expect(res.errors.filter((e) => e.startsWith('E15'))).toHaveLength(0);
  });
});

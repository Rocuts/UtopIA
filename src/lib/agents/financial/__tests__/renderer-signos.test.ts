// ---------------------------------------------------------------------------
// Regresión — los totales del reporte conservan su signo
// ---------------------------------------------------------------------------
// Auditoría 2026-08 (P0 `perdida-y-patrimonio-negativo-se-imprimen-positivos`):
// los totales canónicos del Balance y del Estado de Resultados se formateaban
// con `absolute = true` hardcodeado en `agents/renderer.ts`, y el Excel
// aplicaba `Math.abs` al patrimonio.
//
// Es el peor tipo de defecto: silencioso e invertido. Una empresa con pérdida
// del ejercicio recibía un reporte que decía UTILIDAD NETA $50.000.000,00 —
// exactamente lo mismo que habría dicho con una ganancia de esa magnitud. Y un
// patrimonio negativo, que es causal de disolución (Art. 457 num. 2 C.Co.) y
// bandera de empresa en marcha (NIA 570), aparecía en positivo.
//
// Convención NIIF: los negativos se presentan entre paréntesis.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  renderBalanceSheet,
  renderIncomeStatement,
} from '../agents/renderer';
import type { NiifReportJson } from '../contracts/niif-report';

// ---------------------------------------------------------------------------
// Fixture mínimo: empresa en pérdida con patrimonio negativo.
// ---------------------------------------------------------------------------
// Activo 1.000.000 = Pasivo 1.400.000 + Patrimonio (400.000)  ✔ ecuación
// Utilidad neta: pérdida de 250.000. ORI negativo. EBIT negativo.
// (cifras en centavos, contrato MoneyCop)
function makeReportEnPerdida(): NiifReportJson {
  return {
    company: {
      name: 'Empresa En Perdida SAS',
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
      totalAssetsPrimary: '100000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: '140000000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: '-40000000',
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [],
      grossProfitPrimary: '10000000',
      grossProfitComparative: null,
      operatingProfitPrimary: '-15000000',
      operatingProfitComparative: null,
      netIncomePrimary: '-25000000',
      netIncomeComparative: null,
      oriPrimary: '-500000',
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

describe('renderer — signo de los totales', () => {
  it('un patrimonio negativo se imprime entre paréntesis, no en positivo', () => {
    const md = renderBalanceSheet(makeReportEnPerdida());

    expect(
      md,
      'El patrimonio negativo debe presentarse entre paréntesis (convención NIIF). ' +
        'Imprimirlo en positivo oculta una causal de disolución.\n\n' + md,
    ).toContain('($400.000,00)');

    // Y NO debe existir la versión sin signo del mismo importe en el renglón
    // del total de patrimonio.
    const lineaPatrimonio = md
      .split('\n')
      .find((l) => l.toLowerCase().includes('total patrimonio'));
    expect(lineaPatrimonio, 'no se encontró el renglón de Total patrimonio').toBeDefined();
    expect(lineaPatrimonio).toContain('($400.000,00)');
    expect(lineaPatrimonio).not.toMatch(/\|\s*\*\*\$400\.000,00\*\*\s*\|/);
  });

  it('activo y pasivo positivos se siguen imprimiendo sin paréntesis', () => {
    const md = renderBalanceSheet(makeReportEnPerdida());
    const activo = md.split('\n').find((l) => l.includes('TOTAL ACTIVOS'));
    const pasivo = md.split('\n').find((l) => l.includes('TOTAL PASIVOS'));

    expect(activo).toContain('$1.000.000,00');
    expect(activo).not.toContain('(');
    expect(pasivo).toContain('$1.400.000,00');
    expect(pasivo).not.toContain('(');
  });

  it('una pérdida neta NO se imprime igual que una utilidad de la misma magnitud', () => {
    const md = renderIncomeStatement(makeReportEnPerdida());

    const utilidadNeta = md
      .split('\n')
      .find((l) => l.includes('UTILIDAD NETA DEL PERÍODO'));
    expect(utilidadNeta, 'no se encontró el renglón de utilidad neta').toBeDefined();
    expect(
      utilidadNeta,
      'Una pérdida de $250.000 se estaba imprimiendo como "$250.000,00", ' +
        'indistinguible de una ganancia.\n\n' + md,
    ).toContain('($250.000,00)');

    // EBIT y ORI negativos, mismo tratamiento.
    const ebit = md.split('\n').find((l) => l.includes('EBIT'));
    expect(ebit).toContain('($150.000,00)');
    const ori = md.split('\n').find((l) => l.includes('OTRO RESULTADO INTEGRAL'));
    expect(ori).toContain('($5.000,00)');

    // La utilidad bruta sí es positiva y no lleva paréntesis.
    const bruta = md.split('\n').find((l) => l.includes('UTILIDAD BRUTA'));
    expect(bruta).toContain('$100.000,00');
    expect(bruta).not.toContain('(');
  });

  it('el signo sobrevive en la columna comparativa', () => {
    const base = makeReportEnPerdida();
    const conComparativo = {
      ...base,
      company: { ...base.company, comparativePeriod: '2024' },
      incomeStatement: {
        ...base.incomeStatement,
        netIncomeComparative: '-9900000',
      },
    } as unknown as NiifReportJson;

    const md = renderIncomeStatement(conComparativo);
    const utilidadNeta = md
      .split('\n')
      .find((l) => l.includes('UTILIDAD NETA DEL PERÍODO'));

    expect(utilidadNeta).toContain('($250.000,00)');
    expect(
      utilidadNeta,
      'La pérdida del periodo comparativo también debe llevar signo.\n\n' + md,
    ).toContain('($99.000,00)');
  });
});

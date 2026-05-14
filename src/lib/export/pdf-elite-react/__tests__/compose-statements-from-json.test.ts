// compose-statements-from-json.test.ts — Wave 5 regression (2026-05-14)
// ----------------------------------------------------------------------------
// Verifica el contrato del renderer ParsedTable cuando hay periodo comparativo:
//
//   1. headers siempre incluye [<concept>, fiscalPeriod, comparativePeriod]
//      cuando company.comparativePeriod !== null.
//   2. CADA row de datos / total emite TANTAS celdas como columnas hay en
//      headers (alineación). Antes, una línea con amountComparative=null
//      colapsaba a 1 celda y desfasaba la tabla.
//   3. Cuando amountComparative=null en modo comparativo, la celda comparativa
//      muestra "n/c" explícito — no se silencia con cadena vacía.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  niifJsonToBalanceTable,
  niifJsonToCashFlowTable,
  niifJsonToIncomeTable,
} from '../compose-statements-from-json';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';

function makeJson(overrides: Partial<NiifReportJson> = {}): NiifReportJson {
  const base: NiifReportJson = {
    company: {
      name: 'Empresa Prueba SAS',
      nit: '900123456',
      entityType: null,
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: '2024',
      city: null,
      signatories: null,
    },
    balanceSheet: {
      assets: [
        {
          account: '11',
          label: 'Efectivo',
          amountPrimary: '15000000',
          amountComparative: '12000000',
          level: 2,
          isAbsolute: true,
          confidence: null,
          anomalyFlag: null,
        },
        {
          account: '13',
          label: 'Deudores',
          amountPrimary: '85000000',
          amountComparative: null, // <- null en modo comparativo: debe renderizar 'n/c'
          level: 2,
          isAbsolute: true,
          confidence: null,
          anomalyFlag: null,
        },
      ],
      liabilities: [],
      equity: [],
      totalAssetsPrimary: '100000000',
      totalAssetsComparative: '80000000',
      totalLiabilitiesPrimary: '40000000',
      totalLiabilitiesComparative: '35000000',
      totalEquityPrimary: '60000000',
      totalEquityComparative: '45000000',
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [
        {
          account: '41',
          label: 'Ingresos',
          amountPrimary: '500000000',
          amountComparative: '420000000',
          level: 2,
          isAbsolute: true,
          confidence: null,
          anomalyFlag: null,
        },
      ],
      grossProfitPrimary: '200000000',
      grossProfitComparative: '170000000',
      operatingProfitPrimary: '120000000',
      operatingProfitComparative: '95000000',
      netIncomePrimary: '80000000',
      netIncomeComparative: '60000000',
      oriPrimary: '0',
      oriComparative: '0',
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
  };
  return { ...base, ...overrides };
}

describe('niifJsonToBalanceTable — modo comparativo', () => {
  it('headers incluye fiscalPeriod y comparativePeriod', () => {
    const t = niifJsonToBalanceTable(makeJson());
    expect(t.headers).toEqual(['Cuenta', '2025', '2024']);
  });

  it('cada row emite 2 celdas de monto (alineación de columnas)', () => {
    const t = niifJsonToBalanceTable(makeJson());
    // Las rows de datos + totales DEBEN tener 2 cells. Las de sección
    // ("ACTIVOS", "PASIVOS Y PATRIMONIO") tienen cells=[] (header de bloque).
    for (const row of t.rows) {
      if (row.cells.length === 0) continue;
      expect(row.cells).toHaveLength(2);
    }
  });

  it('null amountComparative se renderiza como "n/c" en modo comparativo', () => {
    const t = niifJsonToBalanceTable(makeJson());
    const deudoresRow = t.rows.find((r) => r.account.includes('Deudores'));
    expect(deudoresRow).toBeDefined();
    expect(deudoresRow!.cells[1]).toBe('n/c');
  });

  it('TOTAL ACTIVOS lleva la cifra comparativa real, no n/c, cuando es non-null', () => {
    const t = niifJsonToBalanceTable(makeJson());
    const totalRow = t.rows.find((r) => r.account === 'TOTAL ACTIVOS');
    expect(totalRow).toBeDefined();
    expect(totalRow!.cells).toHaveLength(2);
    expect(totalRow!.cells[1]).not.toBe('n/c');
    expect(totalRow!.cells[1]).toMatch(/\$/);
  });
});

describe('niifJsonToBalanceTable — modo single-period', () => {
  it('headers solo lleva fiscalPeriod', () => {
    const json = makeJson();
    json.company.comparativePeriod = null;
    const t = niifJsonToBalanceTable(json);
    expect(t.headers).toEqual(['Cuenta', '2025']);
  });

  it('cada row de datos / total emite 1 sola celda', () => {
    const json = makeJson();
    json.company.comparativePeriod = null;
    const t = niifJsonToBalanceTable(json);
    for (const row of t.rows) {
      if (row.cells.length === 0) continue;
      expect(row.cells).toHaveLength(1);
    }
  });
});

describe('niifJsonToIncomeTable — modo comparativo', () => {
  it('totales pushed (UTILIDAD BRUTA, EBIT, NETA) llevan 2 celdas', () => {
    const t = niifJsonToIncomeTable(makeJson());
    const grossRow = t.rows.find((r) => r.account === 'UTILIDAD BRUTA');
    const opRow = t.rows.find((r) => r.account === 'UTILIDAD OPERATIVA (EBIT)');
    const netRow = t.rows.find((r) => r.account === 'UTILIDAD NETA DEL PERÍODO');
    expect(grossRow!.cells).toHaveLength(2);
    expect(opRow!.cells).toHaveLength(2);
    expect(netRow!.cells).toHaveLength(2);
  });

  it('total con comparativo null en modo comparativo muestra "n/c"', () => {
    const json = makeJson();
    json.incomeStatement.grossProfitComparative = null;
    const t = niifJsonToIncomeTable(json);
    const grossRow = t.rows.find((r) => r.account === 'UTILIDAD BRUTA');
    expect(grossRow!.cells[1]).toBe('n/c');
  });
});

// ---------------------------------------------------------------------------
// v2.2 #1 — Ecuación patrimonial visible (A = P + C)
// ---------------------------------------------------------------------------
describe('niifJsonToBalanceTable — ecuación patrimonial (v2.2 #1)', () => {
  function makeBalancedJson(): NiifReportJson {
    // Cents convention: $1.000,00 = "100000"
    const j = makeJson();
    j.balanceSheet.totalAssetsPrimary = '100000';
    j.balanceSheet.totalLiabilitiesPrimary = '30000';
    j.balanceSheet.totalEquityPrimary = '70000';
    j.balanceSheet.totalAssetsComparative = '80000';
    j.balanceSheet.totalLiabilitiesComparative = '35000';
    j.balanceSheet.totalEquityComparative = '45000';
    return j;
  }

  it('cuadre OK — título lleva ✅ y diferencia es $0,00 en ambos periodos', () => {
    const t = niifJsonToBalanceTable(makeBalancedJson());

    // Localiza el grupo VERIFICACIÓN: debe estar después de TOTAL PATRIMONIO
    const verifIdx = t.rows.findIndex((r) => r.account === 'VERIFICACIÓN');
    const totalEquityIdx = t.rows.findIndex((r) => r.account === 'TOTAL PATRIMONIO');
    expect(verifIdx).toBeGreaterThan(totalEquityIdx);
    expect(verifIdx).toBeGreaterThan(-1);

    // 6 filas: grupo + título + Activo + =Pasivo + +Patrimonio + Diferencia
    const trailer = t.rows.slice(verifIdx, verifIdx + 6);
    expect(trailer).toHaveLength(6);

    expect(trailer[0]).toMatchObject({
      account: 'VERIFICACIÓN',
      cells: [],
      emphasis: 'subtotal',
    });
    expect(trailer[1].account).toBe('✅ ECUACIÓN PATRIMONIAL — A = P + C');
    expect(trailer[1].emphasis).toBe('total');
    expect(trailer[1].cells).toHaveLength(2);
    expect(trailer[1].cells[0]).toBe('$1.000,00');
    expect(trailer[1].cells[1]).toBe('$800,00');

    expect(trailer[2].account).toBe('Activo');
    expect(trailer[2].cells).toEqual(['$1.000,00', '$800,00']);
    expect(trailer[3].account).toBe('= Pasivo');
    expect(trailer[3].cells).toEqual(['$300,00', '$350,00']);
    expect(trailer[4].account).toBe('+ Patrimonio');
    expect(trailer[4].cells).toEqual(['$700,00', '$450,00']);

    // Diferencia: cuadrado → $0,00 en ambos
    expect(trailer[5].account).toBe('Diferencia (debe ser $0,00)');
    expect(trailer[5].emphasis).toBe('subtotal');
    expect(trailer[5].cells).toEqual(['$0,00', '$0,00']);
  });

  it('descuadre primary — título lleva ⚠ y diferencia muestra el gap firmado', () => {
    // A=$1000, P=$300, C=$600 → gap = $100 (A − P − C)
    const j = makeJson();
    j.balanceSheet.totalAssetsPrimary = '100000';
    j.balanceSheet.totalLiabilitiesPrimary = '30000';
    j.balanceSheet.totalEquityPrimary = '60000';
    j.company.comparativePeriod = null; // single-period para aislar el primary
    j.balanceSheet.totalAssetsComparative = null;
    j.balanceSheet.totalLiabilitiesComparative = null;
    j.balanceSheet.totalEquityComparative = null;

    const t = niifJsonToBalanceTable(j);
    const titleRow = t.rows.find((r) => r.account.startsWith('⚠'));
    expect(titleRow).toBeDefined();
    expect(titleRow!.account).toBe('⚠ DESCUADRE DETECTADO — A ≠ P + C');
    expect(titleRow!.emphasis).toBe('total');

    const diffRow = t.rows.find((r) => r.account === 'Diferencia (debe ser $0,00)');
    expect(diffRow).toBeDefined();
    // single-period → 1 celda. formatCopFromCents con absolute=false muestra
    // el signo positivo sin paréntesis ($100,00) y negativos como ($X).
    expect(diffRow!.cells).toHaveLength(1);
    expect(diffRow!.cells[0]).toBe('$100,00');
  });

  it('comparativo descuadrado mientras primary cuadra — diferencia revela el gap por columna', () => {
    // Primary cuadrado ($1000 = $300 + $700), comparativo descuadrado por $50
    // ($800 ≠ $350 + $400 → gap $50). Convención: el título mantiene ✅
    // porque el primary (periodo del reporte) cuadra; la fila "Diferencia"
    // expone el descuadre del comparativo por columna.
    const j = makeJson();
    j.balanceSheet.totalAssetsPrimary = '100000';
    j.balanceSheet.totalLiabilitiesPrimary = '30000';
    j.balanceSheet.totalEquityPrimary = '70000';
    j.balanceSheet.totalAssetsComparative = '80000';
    j.balanceSheet.totalLiabilitiesComparative = '35000';
    j.balanceSheet.totalEquityComparative = '40000';

    const t = niifJsonToBalanceTable(j);

    const titleRow = t.rows.find(
      (r) => r.account === '✅ ECUACIÓN PATRIMONIAL — A = P + C',
    );
    expect(titleRow).toBeDefined();
    expect(titleRow!.cells).toEqual(['$1.000,00', '$800,00']);

    const diffRow = t.rows.find((r) => r.account === 'Diferencia (debe ser $0,00)');
    expect(diffRow).toBeDefined();
    expect(diffRow!.cells).toHaveLength(2);
    expect(diffRow!.cells[0]).toBe('$0,00');
    // Comparativo: 80000 - 35000 - 40000 = 5000 centavos = $50,00
    expect(diffRow!.cells[1]).toBe('$50,00');
  });

  it('comparativo con totales null muestra n/c en la fila Diferencia', () => {
    // Periodo comparativo declarado en company pero uno de los totales es null
    // (Pass-1 silenció el comparativo). La fila Diferencia debe surface n/c.
    const j = makeJson();
    j.balanceSheet.totalAssetsPrimary = '100000';
    j.balanceSheet.totalLiabilitiesPrimary = '30000';
    j.balanceSheet.totalEquityPrimary = '70000';
    j.balanceSheet.totalAssetsComparative = '80000';
    j.balanceSheet.totalLiabilitiesComparative = null;
    j.balanceSheet.totalEquityComparative = '45000';

    const t = niifJsonToBalanceTable(j);
    const diffRow = t.rows.find((r) => r.account === 'Diferencia (debe ser $0,00)');
    expect(diffRow).toBeDefined();
    expect(diffRow!.cells[1]).toBe('n/c');
  });
});

// ---------------------------------------------------------------------------
// Corrección v2.4 — EFE con ajuste no-cash por saldo inicial Cta.3605
// ---------------------------------------------------------------------------
// Fixture determinístico del caso documentado en la corrección v2.4:
//
//   - Saldo INICIAL Cta.3605 (utilidad 2024 arrastrada al patrimonio
//     de apertura de 2025) = $1.572.721.472,96
//   - Utilidad neta 2025 (P&L) = $2.228.496.789,73
//   - Efectivo Cta.11 inicio 2025 = $1.563.485.554,01
//   - Efectivo Cta.11 cierre 2025 = $2.413.677.888,64
//   - Cambio neto en caja = $850.192.334,63
//
// El EFE CORRECTO incluye una línea en operating con label LITERAL
// "Resultado de periodos anteriores reconocido en patrimonio de apertura..."
// y signo NEGATIVO. Sección financing queda vacía (sin pago real a socios).
// El validator NO debe disparar E10 sobre este label legítimo.
// ---------------------------------------------------------------------------
describe('niifJsonToCashFlowTable — Corrección v2.4 (ajuste no-cash)', () => {
  function makeV24Report(): NiifReportJson {
    return {
      company: {
        name: 'Empresa v2.4 SAS',
        nit: '900111222',
        entityType: null,
        sector: null,
        niifGroup: 2,
        fiscalPeriod: '2025',
        comparativePeriod: '2024',
        city: null,
        signatories: null,
      },
      balanceSheet: {
        assets: [],
        liabilities: [],
        equity: [],
        totalAssetsPrimary: '500000000000',
        totalAssetsComparative: '400000000000',
        totalLiabilitiesPrimary: '100000000000',
        totalLiabilitiesComparative: '95000000000',
        totalEquityPrimary: '400000000000',
        totalEquityComparative: '305000000000',
        notes: [],
        modeBanner: null,
      },
      incomeStatement: {
        lines: [],
        // Utilidad neta 2025 = $2.228.496.789,73 → 222.849.678.973 cents
        grossProfitPrimary: '300000000000',
        grossProfitComparative: '250000000000',
        operatingProfitPrimary: '250000000000',
        operatingProfitComparative: '200000000000',
        netIncomePrimary: '222849678973',
        netIncomeComparative: '157272147296',
        oriPrimary: '0',
        oriComparative: '0',
        notes: [],
        modeBanner: null,
      },
      cashFlow: {
        sections: [
          {
            section: 'operating',
            // EFE indirecto correcto v2.4:
            //   + 222.849.678.973  Resultado neto del ejercicio
            //   − 157.272.147.296  Resultado periodos anteriores (ajuste no-cash)
            //   −     299.860.069  Δ deudores
            //   −  52.015.584.530  Δ inventarios
            //   −       291.666.6  Δ impuesto corriente activo  (= 291666600 cents/100)
            //   + 72.048.812.985   Δ proveedores
            //   = 85.019.233.463  → $850.192.334,63
            lines: [
              {
                account: null,
                label: 'Resultado neto del ejercicio',
                amountPrimary: '222849678973',
                amountComparative: null,
                level: 2,
                isAbsolute: false,
                confidence: null,
                anomalyFlag: null,
              },
              {
                account: null,
                label:
                  'Resultado de periodos anteriores reconocido en patrimonio de apertura (ajuste de conciliación — no representa flujo de efectivo del período actual)',
                amountPrimary: '-157272147296',
                amountComparative: null,
                level: 2,
                isAbsolute: false,
                confidence: null,
                anomalyFlag: null,
              },
              {
                account: null,
                label: 'Cambio en deudores comerciales y cuentas por cobrar',
                amountPrimary: '-299860069',
                amountComparative: null,
                level: 2,
                isAbsolute: false,
                confidence: null,
                anomalyFlag: null,
              },
              {
                account: null,
                label: 'Cambio en inventarios',
                amountPrimary: '-52015584530',
                amountComparative: null,
                level: 2,
                isAbsolute: false,
                confidence: null,
                anomalyFlag: null,
              },
              {
                account: null,
                label: 'Cambio en impuesto corriente activo (Cta.1355 + Cta.1805)',
                amountPrimary: '-291666600',
                amountComparative: null,
                level: 2,
                isAbsolute: false,
                confidence: null,
                anomalyFlag: null,
              },
              {
                account: null,
                label:
                  'Cambio en proveedores, acreedores y otros pasivos operativos',
                amountPrimary: '72048812985',
                amountComparative: null,
                level: 2,
                isAbsolute: false,
                confidence: null,
                anomalyFlag: null,
              },
            ],
            netFlow: '85019233463',
          },
          {
            section: 'investing',
            lines: [],
            netFlow: '0',
          },
          {
            section: 'financing',
            // Vacío: SIN aportes / dividendos / créditos. La corrección v2.4
            // exige que esta sección permanezca a $0 cuando no hay evidencia
            // real de pago en efectivo.
            lines: [],
            netFlow: '0',
          },
        ],
        netChange: '85019233463',
        cashOpening: '156348555401',
        cashClosing: '241367788864',
        methodNote: 'indirect',
        degeneracyFlag: null,
      },
      equityChanges: {
        rows: [
          {
            kind: 'opening_balance',
            label: 'Saldo al 1 enero 2025',
            capitalSocial: '20000000000',
            primaColocacion: '0',
            reservaLegal: '5000000000',
            otrasReservas: '0',
            resultadosAcumulados: '122727852704',
            resultadoEjercicio: '157272147296',
            ori: '0',
            total: '305000000000',
          },
          {
            kind: 'closing_balance',
            label: 'Saldo al 31 diciembre 2025',
            capitalSocial: '20000000000',
            primaColocacion: '0',
            reservaLegal: '5000000000',
            otrasReservas: '0',
            resultadosAcumulados: '152150321027',
            resultadoEjercicio: '222849678973',
            ori: '0',
            total: '400000000000',
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
      reportMode: 'COMPARATIVO_COMPLETO',
    };
  }

  it('compone el EFE con la línea de ajuste no-cash en operating (label literal)', () => {
    const t = niifJsonToCashFlowTable(makeV24Report());
    const adjustmentRow = t.rows.find((r) =>
      r.account.startsWith('Resultado de periodos anteriores reconocido en patrimonio de apertura'),
    );
    expect(adjustmentRow).toBeDefined();
    // El renderer preserva signo (isAbsolute=false) — formato contable
    // estándar envuelve los negativos en paréntesis: "($X.XXX,XX)".
    expect(adjustmentRow!.cells[0]).toBe('($1.572.721.472,96)');
  });

  it('la sección financing queda vacía y su FLUJO NETO = $0', () => {
    const t = niifJsonToCashFlowTable(makeV24Report());
    const financingNet = t.rows.find((r) =>
      r.account.startsWith('FLUJO NETO ACTIVIDADES DE FINANCIAMIENTO'),
    );
    expect(financingNet).toBeDefined();
    expect(financingNet!.cells[0]).toBe('$0,00');
  });

  it('cashClosing del EFE iguala el saldo Cta.11 final $2.413.677.888,64', () => {
    const t = niifJsonToCashFlowTable(makeV24Report());
    const closing = t.rows.find((r) =>
      r.account.startsWith('EFECTIVO AL FINAL DEL PERÍODO'),
    );
    expect(closing).toBeDefined();
    expect(closing!.cells[0]).toBe('$2.413.677.888,64');
  });

  it('aumento neto en efectivo = $850.192.334,63 (cuadre matemático sin financing ficticio)', () => {
    const t = niifJsonToCashFlowTable(makeV24Report());
    const netIncrease = t.rows.find((r) =>
      r.account.startsWith('AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO'),
    );
    expect(netIncrease).toBeDefined();
    expect(netIncrease!.cells[0]).toBe('$850.192.334,63');
  });

  it('el validator E10 NO dispara sobre el label legítimo de ajuste no-cash', () => {
    const report = makeV24Report();
    const result = validateNiifReportJson(report, {
      cashAccountPuc11Cents: '241367788864',
    });
    // E10 NO debe encajar con la línea legítima.
    expect(result.errors.some((e) => e.includes('E10'))).toBe(false);
  });

  it('el validator E10 SÍ dispara si en su lugar se emite el flujo ficticio en financing', () => {
    const report = makeV24Report();
    // Mutación: convertir la fila legítima en el flujo ficticio prohibido
    // (lo que el modelo hacía antes de la corrección v2.4).
    report.cashFlow.sections[0].lines.splice(1, 1); // quita el ajuste no-cash
    report.cashFlow.sections[2].lines.push({
      account: null,
      label: 'Distribución de utilidades de periodos anteriores',
      amountPrimary: '-157272147296',
      amountComparative: null,
      level: 2,
      isAbsolute: false,
      confidence: null,
      anomalyFlag: null,
    });
    const result = validateNiifReportJson(report);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('E10') && e.includes('financing'))).toBe(true);
  });
});

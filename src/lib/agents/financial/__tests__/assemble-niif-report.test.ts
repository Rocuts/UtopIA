// Tests del ensamblador determinístico de sub-schemas Fase 3 del NIIF Analyst.
// Cubre: happy path, byte-exact MoneyCop, curatorFlags eco, technicalNotes
// orden, determinismo, equityChanges rows y companyInfo eco.

import { describe, it, expect } from 'vitest';
import {
  assembleNiifReport,
  NiifReportSchema,
  type BalanceAndPnlSubJson,
  type CashFlowAndEquitySubJson,
  type TechnicalNotesSubJson,
} from '../contracts/niif-report';

// ---------------------------------------------------------------------------
// Helper — triple representativo cuyo merge satisface NiifReportSchema
// ---------------------------------------------------------------------------
// Usamos los mismos valores numéricos que niif-json-validator.test.ts para
// mantener coherencia con las pruebas existentes.
// MoneyCop: string de enteros en centavos, sin separadores (ej. "1000000" = $10.000,00).

function makePass1(overrides: Partial<BalanceAndPnlSubJson> = {}): BalanceAndPnlSubJson {
  const base: BalanceAndPnlSubJson = {
    company: {
      name: 'Empresa Prueba SAS',
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
      totalAssetsPrimary: '1000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: '400000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: '600000',
      totalEquityComparative: null,
      notes: [],
    },
    incomeStatement: {
      lines: [],
      grossProfitPrimary: '500000',
      grossProfitComparative: null,
      operatingProfitPrimary: '300000',
      operatingProfitComparative: null,
      netIncomePrimary: '200000',
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
    },
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
  };
  return { ...base, ...overrides };
}

function makePass2(overrides: Partial<CashFlowAndEquitySubJson> = {}): CashFlowAndEquitySubJson {
  const base: CashFlowAndEquitySubJson = {
    cashFlow: {
      sections: [
        { section: 'operating', lines: [], netFlow: '150000' },
        { section: 'investing', lines: [], netFlow: '-50000' },
        { section: 'financing', lines: [], netFlow: '-30000' },
      ],
      netChange: '70000',
      cashOpening: '100000',
      cashClosing: '170000',
      methodNote: 'indirect',
    },
    equityChanges: {
      rows: [
        {
          kind: 'opening_balance',
          label: 'Saldo al 1 ene 2025',
          capitalSocial: '300000',
          primaColocacion: '0',
          reservaLegal: '50000',
          otrasReservas: '0',
          resultadosAcumulados: '50000',
          resultadoEjercicio: '0',
          ori: '0',
          total: '400000',
        },
        {
          kind: 'closing_balance',
          label: 'Saldo al 31 dic 2025',
          capitalSocial: '300000',
          primaColocacion: '0',
          reservaLegal: '50000',
          otrasReservas: '0',
          resultadosAcumulados: '50000',
          resultadoEjercicio: '200000',
          ori: '0',
          total: '600000',
        },
      ],
      notes: [],
    },
  };
  return { ...base, ...overrides };
}

function makePass3(overrides: Partial<TechnicalNotesSubJson> = {}): TechnicalNotesSubJson {
  const base: TechnicalNotesSubJson = {
    technicalNotes: [
      { ref: 'Nota 1', norma: 'E.T. Art. 647', body: 'Diferencia de criterio aplicada para reclasificación cuentas 1120.' },
      { ref: 'Nota 2', norma: 'NIIF for SMEs §2.36', body: 'Saldo cuenta 1355 Anticipos integrado al activo corriente.' },
      { ref: 'Nota 3', norma: null, body: 'Mapeo PUC Clase 4 → ingresos ordinarios exclusivo.' },
    ],
  };
  return { ...base, ...overrides };
}

function makeValidTriple(): [BalanceAndPnlSubJson, CashFlowAndEquitySubJson, TechnicalNotesSubJson] {
  return [makePass1(), makePass2(), makePass3()];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleNiifReport — Fase 3 merger determinístico', () => {

  // Test 1: Happy path — el output satisface NiifReportSchema.parse() completo
  it('happy path: assembled satisface NiifReportSchema.parse() sin errores', () => {
    const [p1, p2, p3] = makeValidTriple();
    const assembled = assembleNiifReport(p1, p2, p3);

    // NiifReportSchema.parse lanza ZodError si el shape no es correcto
    expect(() => NiifReportSchema.parse(assembled)).not.toThrow();
    const parsed = NiifReportSchema.parse(assembled);
    expect(parsed).toBeDefined();
    // Verificamos la presencia de los 7 campos top-level del schema
    expect(parsed.company).toBeDefined();
    expect(parsed.balanceSheet).toBeDefined();
    expect(parsed.incomeStatement).toBeDefined();
    expect(parsed.cashFlow).toBeDefined();
    expect(parsed.equityChanges).toBeDefined();
    expect(parsed.technicalNotes).toBeDefined();
    expect(parsed.curatorFlags).toBeDefined();
  });

  // Test 2: Byte-exact preservation de MoneyCop strings
  // El assembler no debe re-formatear, truncar ni transformar las strings numéricas
  it('byte-exact: MoneyCop strings de pass1/pass2/pass3 llegan idénticas al output', () => {
    const [p1, p2, p3] = makeValidTriple();
    const assembled = assembleNiifReport(p1, p2, p3);

    // Strings de Pass 1 — Balance
    expect(assembled.balanceSheet.totalAssetsPrimary).toBe('1000000');
    expect(assembled.balanceSheet.totalLiabilitiesPrimary).toBe('400000');
    expect(assembled.balanceSheet.totalEquityPrimary).toBe('600000');

    // Strings de Pass 1 — P&L
    expect(assembled.incomeStatement.grossProfitPrimary).toBe('500000');
    expect(assembled.incomeStatement.operatingProfitPrimary).toBe('300000');
    expect(assembled.incomeStatement.netIncomePrimary).toBe('200000');
    expect(assembled.incomeStatement.oriPrimary).toBe('0');

    // Strings de Pass 2 — EFE
    expect(assembled.cashFlow.netChange).toBe('70000');
    expect(assembled.cashFlow.cashOpening).toBe('100000');
    expect(assembled.cashFlow.cashClosing).toBe('170000');
    expect(assembled.cashFlow.sections[0].netFlow).toBe('150000');
    expect(assembled.cashFlow.sections[1].netFlow).toBe('-50000');
    expect(assembled.cashFlow.sections[2].netFlow).toBe('-30000');

    // Strings de Pass 2 — ECP rows
    expect(assembled.equityChanges.rows[0].capitalSocial).toBe('300000');
    expect(assembled.equityChanges.rows[1].resultadoEjercicio).toBe('200000');
    expect(assembled.equityChanges.rows[1].total).toBe('600000');
  });

  // Test 3: curatorFlags eco fiel desde pass1
  // Si pass1 trae flags específicos, deben aparecer byte-a-byte en assembled
  it('curatorFlags: eco byte-a-byte desde pass1', () => {
    const p1 = makePass1({
      curatorFlags: {
        equityConvergenceApplied: true,
        cashFlowClosureForced: false,
        negativeAssetReclassified: true,
        presumedCostWarning: false,
        reclassifiedAmountCop: '12345',
      },
    });
    const assembled = assembleNiifReport(p1, makePass2(), makePass3());

    expect(assembled.curatorFlags.equityConvergenceApplied).toBe(true);
    expect(assembled.curatorFlags.cashFlowClosureForced).toBe(false);
    expect(assembled.curatorFlags.negativeAssetReclassified).toBe(true);
    expect(assembled.curatorFlags.presumedCostWarning).toBe(false);
    // Byte-exact: "12345" no debe normalizarse a "12.345" ni "0012345"
    expect(assembled.curatorFlags.reclassifiedAmountCop).toBe('12345');
  });

  // Test 4: technicalNotes orden preservado desde pass3
  // El PDF Élite asume orden cronológico — el assembler NO debe re-ordenar
  it('technicalNotes: orden A→B→C preservado desde pass3', () => {
    const p3 = makePass3({
      technicalNotes: [
        { ref: 'A', norma: 'E.T. Art. 647', body: 'Nota A — primera en tiempo' },
        { ref: 'B', norma: 'NIC 7 §18', body: 'Nota B — segunda en tiempo' },
        { ref: 'C', norma: null, body: 'Nota C — tercera en tiempo' },
      ],
    });
    const assembled = assembleNiifReport(makePass1(), makePass2(), p3);

    expect(assembled.technicalNotes).toHaveLength(3);
    expect(assembled.technicalNotes[0].ref).toBe('A');
    expect(assembled.technicalNotes[1].ref).toBe('B');
    expect(assembled.technicalNotes[2].ref).toBe('C');
    // Verificar que el body también llegó intacto
    expect(assembled.technicalNotes[0].body).toBe('Nota A — primera en tiempo');
    expect(assembled.technicalNotes[2].body).toBe('Nota C — tercera en tiempo');
  });

  // Test 5: Determinismo — mismo triple → mismo JSON.stringify
  // Requerimiento de idempotencia para el pipeline de ensamblaje
  it('determinismo: doble invocación con el mismo triple produce JSON.stringify idéntico', () => {
    const [p1, p2, p3] = makeValidTriple();
    const first = assembleNiifReport(p1, p2, p3);
    const second = assembleNiifReport(p1, p2, p3);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  // Test 6: EquityChanges rows preservadas — kind, label, MoneyCop strings
  // El renderer PDF Élite lee rows en orden opening_balance → ... → closing_balance
  it('equityChanges: rows preservadas con kind, label y MoneyCop intactos', () => {
    const p2 = makePass2({
      equityChanges: {
        rows: [
          {
            kind: 'opening_balance',
            label: 'Saldo al 1 ene 2025',
            capitalSocial: '500000',
            primaColocacion: '100000',
            reservaLegal: '75000',
            otrasReservas: '25000',
            resultadosAcumulados: '80000',
            resultadoEjercicio: '0',
            ori: '0',
            total: '780000',
          },
          {
            kind: 'profit_for_period',
            label: 'Utilidad del ejercicio 2025',
            capitalSocial: '0',
            primaColocacion: '0',
            reservaLegal: '0',
            otrasReservas: '0',
            resultadosAcumulados: '0',
            resultadoEjercicio: '220000',
            ori: '0',
            total: '220000',
          },
          {
            kind: 'closing_balance',
            label: 'Saldo al 31 dic 2025',
            capitalSocial: '500000',
            primaColocacion: '100000',
            reservaLegal: '75000',
            otrasReservas: '25000',
            resultadosAcumulados: '80000',
            resultadoEjercicio: '220000',
            ori: '0',
            total: '1000000',
          },
        ],
        notes: [],
      },
    });
    const assembled = assembleNiifReport(makePass1(), p2, makePass3());

    const rows = assembled.equityChanges.rows;
    expect(rows).toHaveLength(3);

    // Orden: opening_balance → profit_for_period → closing_balance
    expect(rows[0].kind).toBe('opening_balance');
    expect(rows[0].capitalSocial).toBe('500000');
    expect(rows[0].total).toBe('780000');

    expect(rows[1].kind).toBe('profit_for_period');
    expect(rows[1].resultadoEjercicio).toBe('220000');
    expect(rows[1].label).toBe('Utilidad del ejercicio 2025');

    expect(rows[2].kind).toBe('closing_balance');
    expect(rows[2].total).toBe('1000000');
  });

  // Test 7: CompanyInfo eco byte-a-byte desde pass1
  // El assembler NO puede normalizar, limpiar ni truncar ningún campo de company
  it('companyInfo: eco byte-a-byte desde pass1 sin normalización', () => {
    const p1 = makePass1({
      company: {
        name: 'Comercializadora Del Norte SAS',
        nit: '900987654-1',
        entityType: 'SAS',
        sector: 'Manufactura textil',
        niifGroup: 2,
        fiscalPeriod: '2025',
        comparativePeriod: '2024',
        city: 'Medellín',
        signatories: null,
      },
    });
    const assembled = assembleNiifReport(p1, makePass2(), makePass3());

    expect(assembled.company.name).toBe('Comercializadora Del Norte SAS');
    expect(assembled.company.nit).toBe('900987654-1');
    expect(assembled.company.entityType).toBe('SAS');
    expect(assembled.company.sector).toBe('Manufactura textil');
    expect(assembled.company.niifGroup).toBe(2);
    expect(assembled.company.fiscalPeriod).toBe('2025');
    expect(assembled.company.comparativePeriod).toBe('2024');
    expect(assembled.company.city).toBe('Medellín');
    expect(assembled.company.signatories).toBeNull();
  });

  // Test 8: Assembled estructura no contiene campos extra no declarados en NiifReportSchema
  // Garantiza que el assembler no inyecta propiedades phantom que rompan downstream
  it('sin campos extra: assembled tiene exactamente los 7 campos de NiifReportSchema', () => {
    const [p1, p2, p3] = makeValidTriple();
    const assembled = assembleNiifReport(p1, p2, p3);

    const keys = Object.keys(assembled).sort();
    expect(keys).toEqual([
      'balanceSheet',
      'cashFlow',
      'company',
      'curatorFlags',
      'equityChanges',
      'incomeStatement',
      'technicalNotes',
    ]);
  });
});

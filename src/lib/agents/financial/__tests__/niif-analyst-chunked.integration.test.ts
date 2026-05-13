// ---------------------------------------------------------------------------
// Test de integración: runNiifAnalyst — 3 passes secuenciales (Fase 3.E2)
// ---------------------------------------------------------------------------
//
// Mockea `callFinancialAgent` con 3 fixtures predefinidos (sin OpenAI key).
// Asserta:
//   - 3 invocaciones en orden con agentNames correctos (pass1 → pass2 → pass3).
//   - Pass-2 system prompt contiene bloque <previously_computed> con
//     `totalAssetsPrimary` de Pass-1 (string literal MoneyCop).
//   - Pass-3 system prompt contiene anchors de Pass-1 + Pass-2 (cashClosing,
//     ecpClosingTotal).
//   - Output final satisface NiifReportSchema.safeParse() + validateNiifReportJson
//     (Capa 1 Elite Protocol — invariantes aritméticas E1-E4, tolerancia $0).
//   - SSE: >= 3 eventos stage_progress emitidos.
//   - Pass-2 failure propaga error con string "Pass 2 (EFE + ECP) falló".
//   - Pass-1 anchor value específico ("999888777") aparece literalmente en
//     el system prompt de Pass-2.
//
// Por qué `*.integration.test.ts`: el vitest.config.ts excluye los
// `*.integration.test.ts` del run global (los agentes financieros requieren
// setup de infra que no corre en CI). Para ejecutar únicamente este test:
//   npx vitest run src/lib/agents/financial/__tests__/niif-analyst-chunked.integration.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NiifReportSchema,
  type BalanceAndPnlSubJson,
  type CashFlowAndEquitySubJson,
  type TechnicalNotesSubJson,
} from '../contracts/niif-report';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import type { CompanyInfo } from '../types';

// ---------------------------------------------------------------------------
// Mock callFinancialAgent — ANTES de importar runNiifAnalyst
// ---------------------------------------------------------------------------
// Why: vi.mock hoisting requiere que el mock se declare antes de que el modulo
// bajo test sea importado. Cuando el test runner hoista vi.mock, el import
// de runNiifAnalyst ya recibe el mock en lugar del modulo real.

const callFinancialAgentMock = vi.fn();
vi.mock('../agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));

// Import DESPUES del mock para que el hoisting aplique correctamente.
import { runNiifAnalyst } from '../agents/niif-analyst';

// ---------------------------------------------------------------------------
// Fixtures coherentes (invariantes E1–E4, tolerancia $0)
// ---------------------------------------------------------------------------
// Valores numéricos alineados con niif-json-validator.test.ts y
// assemble-niif-report.test.ts para coherencia de suite.
//
// MoneyCop: string de enteros en centavos sin separadores.
//   "1000000" = $10.000,00 COP
//   "400000"  = $4.000,00  COP
//
// Invariantes satisfechas:
//   E1: totalAssets(1000000) = totalLiabilities(400000) + totalEquity(600000)
//   E2: cashClosing(170000) = cashOpening(100000) + netChange(70000)
//        netChange(70000) = 150000 + (-50000) + (-30000)
//   E4: equityChanges.closing.total(600000) == totalEquityPrimary(600000)
//   E6: ORI P&G(0) == delta ORI ECP (closing.ori(0) - opening.ori(0) = 0)

function makePass1Fixture(): BalanceAndPnlSubJson {
  return {
    company: {
      name: 'Empresa Prueba SAS',
      nit: '900123456',
      entityType: null,
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: null,
      city: null,
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
      modeBanner: null,
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
      modeBanner: null,
    },
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
    reportMode: null,
  };
}

function makePass2Fixture(): CashFlowAndEquitySubJson {
  return {
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
      degeneracyFlag: null,
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
}

function makePass3Fixture(): TechnicalNotesSubJson {
  return {
    technicalNotes: [
      {
        ref: 'Nota 1',
        norma: 'E.T. Art. 647',
        body: 'Diferencia de criterio aplicada para reclasificacion cuentas 1120.',
      },
      {
        ref: 'Nota 2',
        norma: 'NIIF for SMEs §2.36',
        body: 'Saldo cuenta 1355 Anticipos integrado al activo corriente.',
      },
    ],
  };
}

function makeCompany(): CompanyInfo {
  return {
    name: 'Empresa Prueba SAS',
    nit: '900123456',
    fiscalPeriod: '2025',
  };
}

function makeBaseMeta(agentName: string) {
  return {
    agentName,
    finishReason: 'stop',
    elapsedMs: 100,
    fallbackUsed: false,
    inputTokens: 1000,
    outputTokens: 500,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runNiifAnalyst chunked (Fase 3 — 3 passes secuenciales)', () => {

  it('happy path — invoca 3 passes en orden con agentNames correctos y ensambla output valido', async () => {
    callFinancialAgentMock
      .mockResolvedValueOnce({ json: makePass1Fixture(), meta: makeBaseMeta('niif-analyst-pass1') })
      .mockResolvedValueOnce({ json: makePass2Fixture(), meta: makeBaseMeta('niif-analyst-pass2') })
      .mockResolvedValueOnce({ json: makePass3Fixture(), meta: makeBaseMeta('niif-analyst-pass3') });

    const progressEvents: unknown[] = [];
    const result = await runNiifAnalyst(
      'csv raw data',
      makeCompany(),
      'es',
      undefined,
      'TOTALES VINCULANTES: totalActivos=1000000',
      undefined,
      (e) => progressEvents.push(e),
      undefined,
      undefined,
    );

    // -- 3 invocaciones exactas en orden --------------------------------------
    expect(callFinancialAgentMock).toHaveBeenCalledTimes(3);

    const calls = callFinancialAgentMock.mock.calls;
    expect(calls[0][0].agentName).toBe('niif-analyst-pass1');
    expect(calls[1][0].agentName).toBe('niif-analyst-pass2');
    expect(calls[2][0].agentName).toBe('niif-analyst-pass3');

    // -- Schemas correctos (Zod identity check por constructor) ---------------
    // Pass-1 y Pass-2 reciben schemas distintos; la forma mas robusta de
    // verificarlo sin depender de identidad de referencia es confirmar que
    // cada schema puede parsear su fixture propio y rechazar el del otro pass.
    const pass1Schema = calls[0][0].schema;
    const pass2Schema = calls[1][0].schema;
    const pass3Schema = calls[2][0].schema;

    // Pass-1 schema acepta pass1 fixture (tiene balanceSheet, incomeStatement)
    expect(pass1Schema.safeParse(makePass1Fixture()).success).toBe(true);
    // Pass-1 schema rechaza pass2 fixture (no tiene balanceSheet)
    expect(pass1Schema.safeParse(makePass2Fixture()).success).toBe(false);

    // Pass-2 schema acepta pass2 fixture (tiene cashFlow, equityChanges)
    expect(pass2Schema.safeParse(makePass2Fixture()).success).toBe(true);
    // Pass-2 schema rechaza pass1 fixture
    expect(pass2Schema.safeParse(makePass1Fixture()).success).toBe(false);

    // Pass-3 schema acepta pass3 fixture (tiene technicalNotes)
    expect(pass3Schema.safeParse(makePass3Fixture()).success).toBe(true);

    // -- Pass-2 system prompt contiene anchors de Pass-1 ---------------------
    // Why: niif-analyst.prompt.ts renderPass1AnchorsBlock() inyecta el valor
    // de totalAssetsPrimary con prefijo "$". El test verifica que la cifra
    // especifica de Pass-1 llega al prompt de Pass-2.
    const pass2System = calls[1][0].system as string;
    expect(pass2System).toContain('totalAssetsPrimary');
    expect(pass2System).toMatch(/previously_computed|Anchors de Pass 1/i);

    // -- Pass-3 system prompt contiene anchors de Pass-1 + Pass-2 -----------
    const pass3System = calls[2][0].system as string;
    // cashClosing es un anchor de Pass-2 que llega a Pass-3
    expect(pass3System).toContain('cashClosing');
    // ecpClosingTotal es un anchor de Pass-2 que llega a Pass-3
    expect(pass3System).toContain('ecpClosingTotal');
    // totalAssetsPrimary de Pass-1 tambien llega a Pass-3
    expect(pass3System).toContain('totalAssetsPrimary');

    // -- Resultado final satisface NiifReportSchema ---------------------------
    expect(result.json).toBeDefined();
    const parsed = NiifReportSchema.safeParse(result.json);
    expect(parsed.success).toBe(true);

    // -- fullContent (Markdown legacy) es no-vacio ---------------------------
    expect(result.fullContent.length).toBeGreaterThan(0);

    // -- balanceSheet markdown contiene el marcador canónico -----------------
    expect(result.balanceSheet).toContain('TOTAL ACTIVOS');

    // -- Capa 1 Elite Protocol — invariantes aritmeticas E1-E4 ---------------
    // validateNiifReportJson aplica tolerancia exacta $0 centavos.
    const validation = validateNiifReportJson(result.json!);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // -- SSE: >= 3 eventos stage_progress emitidos ---------------------------
    const stageProgresses = progressEvents.filter(
      (e) => (e as { type: string }).type === 'stage_progress',
    );
    expect(stageProgresses.length).toBeGreaterThanOrEqual(3);
  });

  it('Pass 2 failure propaga error con "Pass 2 (EFE + ECP) falló"', async () => {
    callFinancialAgentMock
      .mockResolvedValueOnce({ json: makePass1Fixture(), meta: makeBaseMeta('niif-analyst-pass1') })
      .mockRejectedValueOnce(new Error('LLM timeout'));

    await expect(
      runNiifAnalyst(
        'csv raw data',
        makeCompany(),
        'es',
        undefined,
        'TV',
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/Pass 2 \(EFE \+ ECP\) falló/);

    // Pass 3 nunca se invoca cuando Pass 2 falla
    expect(callFinancialAgentMock).toHaveBeenCalledTimes(2);
  });

  it('Pass 1 failure propaga error con "Pass 1 (Balance + P&L) falló"', async () => {
    callFinancialAgentMock.mockRejectedValueOnce(new Error('schema validation failed'));

    await expect(
      runNiifAnalyst(
        'csv raw data',
        makeCompany(),
        'es',
        undefined,
        'TV',
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/Pass 1 \(Balance \+ P&L\) falló/);

    // Pass 2 y Pass 3 nunca se invocan
    expect(callFinancialAgentMock).toHaveBeenCalledTimes(1);
  });

  it('Pass 1 anchor value especifico propagado literalmente al prompt de Pass 2', async () => {
    // Mutamos totalAssetsPrimary a un valor distinctivo para verificar que ese
    // string exacto aparece en el prompt de Pass-2 (no una version reformateada).
    const fixture1 = makePass1Fixture();
    fixture1.balanceSheet.totalAssetsPrimary = '999888777';

    callFinancialAgentMock
      .mockResolvedValueOnce({ json: fixture1, meta: makeBaseMeta('niif-analyst-pass1') })
      .mockResolvedValueOnce({ json: makePass2Fixture(), meta: makeBaseMeta('niif-analyst-pass2') })
      .mockResolvedValueOnce({ json: makePass3Fixture(), meta: makeBaseMeta('niif-analyst-pass3') });

    await runNiifAnalyst(
      'csv raw data',
      makeCompany(),
      'es',
      undefined,
      'TOTALES VINCULANTES: totalActivos=999888777',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    // El valor "999888777" de Pass-1 debe aparecer literalmente en el system
    // prompt de Pass-2. renderPass1AnchorsBlock() lo inyecta como
    // "- totalAssetsPrimary: $999888777".
    const pass2System = callFinancialAgentMock.mock.calls[1][0].system as string;
    expect(pass2System).toContain('999888777');
  });

  it('Pass 2 anchor cashClosing propagado literalmente al prompt de Pass 3', async () => {
    const fixture2 = makePass2Fixture();
    fixture2.cashFlow.cashClosing = '888777666';
    // Ajustar para que E2 siga siendo valido: cashOpening + netChange = cashClosing
    // Usamos cashOpening=800000000, netChange=88777666
    // 800000000 + 88777666 = 888777666
    fixture2.cashFlow.cashOpening = '800000000';
    fixture2.cashFlow.netChange = '88777666';
    // Ajustar sections para que sumNetFlows == netChange:
    // 90000000 + (-1000000) + (-222334) = 88777666
    fixture2.cashFlow.sections = [
      { section: 'operating', lines: [], netFlow: '90000000' },
      { section: 'investing', lines: [], netFlow: '-1000000' },
      { section: 'financing', lines: [], netFlow: '-222334' },
    ];

    callFinancialAgentMock
      .mockResolvedValueOnce({ json: makePass1Fixture(), meta: makeBaseMeta('niif-analyst-pass1') })
      .mockResolvedValueOnce({ json: fixture2, meta: makeBaseMeta('niif-analyst-pass2') })
      .mockResolvedValueOnce({ json: makePass3Fixture(), meta: makeBaseMeta('niif-analyst-pass3') });

    await runNiifAnalyst(
      'csv raw data',
      makeCompany(),
      'es',
      undefined,
      'TV',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    // renderPass2AnchorsBlock() inyecta "cashClosing: $888777666"
    const pass3System = callFinancialAgentMock.mock.calls[2][0].system as string;
    expect(pass3System).toContain('888777666');
  });

  it('HOTFIX d18fccd — Pass-1 *Comparative anchors propagados literalmente a Pass-2 y Pass-3', async () => {
    // Regresion del comparativo (Wave 4 audit): si Pass-1 emite cifras *Comparative
    // (caso isComparative=true) DEBEN aparecer literalmente en los system prompts
    // de Pass-2 y Pass-3 via renderPass1AnchorsBlock — esto cura el bug donde
    // Pass-2/3 null-eaban amountComparative por ausencia del anchor en el bloque
    // <previously_computed>.
    const fixture1 = makePass1Fixture();
    fixture1.balanceSheet.totalAssetsComparative = '888777666';
    fixture1.balanceSheet.totalLiabilitiesComparative = '333222111';
    fixture1.balanceSheet.totalEquityComparative = '555555555';
    fixture1.incomeStatement.netIncomeComparative = '111000000';
    fixture1.incomeStatement.grossProfitComparative = '444333222';
    fixture1.incomeStatement.operatingProfitComparative = '222111000';
    fixture1.incomeStatement.oriComparative = '0';

    callFinancialAgentMock
      .mockResolvedValueOnce({ json: fixture1, meta: makeBaseMeta('niif-analyst-pass1') })
      .mockResolvedValueOnce({ json: makePass2Fixture(), meta: makeBaseMeta('niif-analyst-pass2') })
      .mockResolvedValueOnce({ json: makePass3Fixture(), meta: makeBaseMeta('niif-analyst-pass3') });

    await runNiifAnalyst(
      'csv raw data',
      makeCompany(),
      'es',
      undefined,
      'TOTALES VINCULANTES con comparativo',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    // Los 7 valores *Comparative deben aparecer literales en el prompt de Pass-2.
    const pass2System = callFinancialAgentMock.mock.calls[1][0].system as string;
    expect(pass2System).toContain('888777666'); // totalAssetsComparative
    expect(pass2System).toContain('333222111'); // totalLiabilitiesComparative
    expect(pass2System).toContain('555555555'); // totalEquityComparative
    expect(pass2System).toContain('111000000'); // netIncomeComparative

    // Y tambien en Pass-3 (los notes citan ambas columnas).
    const pass3System = callFinancialAgentMock.mock.calls[2][0].system as string;
    expect(pass3System).toContain('888777666');
    expect(pass3System).toContain('111000000');
  });

  it('HOTFIX d18fccd — Pass-1 *Comparative null emite "N/A (sin comparativo)" en prompts downstream', async () => {
    // Caso LINEA_BASE: fixture base tiene *Comparative=null. Verificar que el
    // bloque renderPass1AnchorsBlock emite "N/A (sin comparativo)" en vez de
    // omitir las lineas — esto evita que el modelo interprete ausencia como
    // autorizacion para null-ear silenciosamente.
    callFinancialAgentMock
      .mockResolvedValueOnce({ json: makePass1Fixture(), meta: makeBaseMeta('niif-analyst-pass1') })
      .mockResolvedValueOnce({ json: makePass2Fixture(), meta: makeBaseMeta('niif-analyst-pass2') })
      .mockResolvedValueOnce({ json: makePass3Fixture(), meta: makeBaseMeta('niif-analyst-pass3') });

    await runNiifAnalyst(
      'csv',
      makeCompany(),
      'es',
      undefined,
      'TV',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const pass2System = callFinancialAgentMock.mock.calls[1][0].system as string;
    // El bloque "Anchors comparativos de Pass 1" debe estar presente con marcadores N/A.
    expect(pass2System).toContain('Anchors comparativos de Pass 1');
    expect(pass2System).toContain('N/A (sin comparativo)');
    // totalAssetsComparative explicito como N/A (no como ausencia silenciosa).
    expect(pass2System).toMatch(/totalAssetsComparative:\s+N\/A/);
  });

  it('NiifReportSchema.safeParse del output ensamblado devuelve todos los 8 campos top-level', async () => {
    // Hotfix Wave 4 (2026-05-13): `reportMode` ahora se propaga literal desde
    // Pass-1 tras endurecer el schema a `.nullable()` puro (8 campos vs 7 pre-fix).
    callFinancialAgentMock
      .mockResolvedValueOnce({ json: makePass1Fixture(), meta: makeBaseMeta('niif-analyst-pass1') })
      .mockResolvedValueOnce({ json: makePass2Fixture(), meta: makeBaseMeta('niif-analyst-pass2') })
      .mockResolvedValueOnce({ json: makePass3Fixture(), meta: makeBaseMeta('niif-analyst-pass3') });

    const result = await runNiifAnalyst(
      'csv raw data',
      makeCompany(),
      'es',
      undefined,
      'TV',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const json = result.json!;
    const topLevelKeys = Object.keys(json).sort();
    expect(topLevelKeys).toEqual([
      'balanceSheet',
      'cashFlow',
      'company',
      'curatorFlags',
      'equityChanges',
      'incomeStatement',
      'reportMode',
      'technicalNotes',
    ]);
  });
});

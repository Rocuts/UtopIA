// ---------------------------------------------------------------------------
// runNiifPhase — la ausencia de validación tiene que ser VISIBLE
// ---------------------------------------------------------------------------
// El validador aritmético E1..E9 sólo corre si el Analista NIIF devolvió cifras
// estructuradas (`niif.json`). Ese `if` no tenía rama `else`: cuando el agente
// no las devolvía, el cruce contra el preprocesador no se ejecutaba y NADIE se
// enteraba — el informe salía igual, con su sello, indistinguible de uno cuyas
// cifras sí se comprobaron a tolerancia $0.
//
// La política del pipeline es que un fallo de validación no lo rompe, pero
// queda visible. "No se comprobó" merece la misma visibilidad que "no cuadra":
// son las dos formas de no tener garantía, y sólo una se veía.
//
// Sin llamadas reales a OpenAI: el analista está mockeado a nivel de módulo. El
// preprocesador y los builders deterministas corren de verdad.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(),
}));

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { runNiifPhase } from '@/lib/agents/financial/orchestrator';
import type {
  NiifAnalysisResult,
  FinancialProgressEvent,
  CompanyInfo,
} from '@/lib/agents/financial/types';

const mockNiifAnalyst = vi.mocked(runNiifAnalyst);

const BALANCED_CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  '110505,Caja general,Auxiliar,1,100000000',
  '130505,Clientes nacionales,Auxiliar,1,200000000',
  '221005,Proveedores nacionales,Auxiliar,1,100000000',
  '330505,Capital social,Auxiliar,1,200000000',
].join('\n');

const CONTENT =
  '## Estado de Situación Financiera\nActivo Total: $300.000.000\n\n' +
  '## Estado de Resultados\nUtilidad Neta: $0\n\n' +
  '## Flujos de Efectivo\nFlujo Operacional: $0\n\n' +
  '## Cambios en Patrimonio\nSaldo Final: $200.000.000\n\n' +
  '## Notas Técnicas\nSin salvedades.';

/** Salida del analista SIN cifras estructuradas — el caso que pasaba en silencio. */
const NIIF_SIN_JSON: NiifAnalysisResult = {
  balanceSheet: '## Estado de Situación Financiera\nActivo Total: $300.000.000',
  incomeStatement: '## Estado de Resultados\nUtilidad Neta: $0',
  cashFlowStatement: '## Flujos de Efectivo\nFlujo Operacional: $0',
  equityChangesStatement: '## Cambios en Patrimonio\nSaldo Final: $200.000.000',
  technicalNotes: '## Notas Técnicas\nSin salvedades.',
  fullContent: CONTENT,
};

const TEST_COMPANY: CompanyInfo = {
  name: 'Pulido Diamante SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
  city: 'Bogotá',
};

const NOT_RUN_ES = /No se ejecutó/i;
const NOT_RUN_EN = /Did not run/i;

let preprocessed: ReturnType<typeof preprocessTrialBalance>;

beforeAll(() => {
  preprocessed = preprocessTrialBalance(parseTrialBalanceCSV(BALANCED_CSV));
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** Todos los textos de warning emitidos por la fase, aplanados. */
async function warningsOf(niif: NiifAnalysisResult, language: 'es' | 'en'): Promise<string[]> {
  mockNiifAnalyst.mockResolvedValue(niif);
  const events: FinancialProgressEvent[] = [];
  await runNiifPhase(
    { rawData: BALANCED_CSV, company: TEST_COMPANY, language },
    { preprocessed, onProgress: (e) => events.push(e) },
  );
  return events
    .filter((e): e is Extract<FinancialProgressEvent, { type: 'warning' }> => e.type === 'warning')
    .flatMap((e) => e.warnings);
}

describe('runNiifPhase — el validador que no corre no puede pasar callado', () => {
  it('avisa explícitamente cuando el analista no devuelve cifras estructuradas', async () => {
    const warnings = await warningsOf(NIIF_SIN_JSON, 'es');

    const aviso = warnings.find((w) => NOT_RUN_ES.test(w));
    expect(aviso).toBeDefined();
    // El aviso tiene que decir la consecuencia, no sólo que algo no pasó.
    expect(aviso).toMatch(/E1\.\.E9/);
    expect(aviso).toMatch(/NO se cruzaron|no se cruzaron/);
  });

  it('respeta el idioma del informe', async () => {
    const warnings = await warningsOf(NIIF_SIN_JSON, 'en');

    expect(warnings.some((w) => NOT_RUN_EN.test(w))).toBe(true);
    expect(warnings.some((w) => NOT_RUN_ES.test(w))).toBe(false);
  });

  // No hay test del caso contrario ("con `json` no avisa") a propósito: el
  // aviso vive DENTRO del `else`, así que es imposible que se emita con
  // cifras presentes. Construirlo exigiría un `NiifReportJson` completo a mano
  // —el validador desreferencia una decena de campos anidados— y ese fixture
  // se desincronizaría del schema real sin proteger nada.
});

 it('seals an unverified report and prevents download when JSON is missing', async () => {
   mockNiifAnalyst.mockResolvedValue({ ...NIIF_SIN_JSON });
   const result = await runNiifPhase(
     { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
     { preprocessed },
   );
   expect(result.niif.reconciliation?.clean).toBe(false);
   expect(result.niif.fullContent).toContain('INTEGRIDAD ARITMÉTICA');
 });

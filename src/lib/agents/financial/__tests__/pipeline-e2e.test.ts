// ---------------------------------------------------------------------------
// BACKLOG 3.5 — Tests E2E pipeline NIIF completo (mocked LLM)
// ---------------------------------------------------------------------------
// Verifica el contrato del orquestador end-to-end:
//   • Eventos SSE emitidos en el orden correcto (stage_start/complete 1..4).
//   • FinancialReport contiene niifAnalysis, strategicAnalysis, governance.
//   • BalanceValidationError se lanza cuando el balance no cuadra.
//   • Los 3 agentes LLM se llaman exactamente una vez cada uno.
//
// Sin llamadas reales a OpenAI: runNiifAnalyst / runStrategyDirector /
// runGovernanceSpecialist están mockeados al nivel de módulo. El preprocesador,
// el validador y todos los builders deterministas corren en real con el fixture
// `elite-pulido-diamante.csv` (balance multiperiodo 2024→2025 con Curator).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Mocks — antes de cualquier import real ──────────────────────────────────
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(),
}));
vi.mock('@/lib/agents/financial/agents/strategy-director', () => ({
  runStrategyDirector: vi.fn(),
}));
vi.mock('@/lib/agents/financial/agents/governance-specialist', () => ({
  runGovernanceSpecialist: vi.fn(),
}));
// ───────────────────────────────────────────────────────────────────────────

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runStrategyDirector } from '@/lib/agents/financial/agents/strategy-director';
import { runGovernanceSpecialist } from '@/lib/agents/financial/agents/governance-specialist';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import {
  orchestrateFinancialReport,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
import type {
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
  FinancialProgressEvent,
  CompanyInfo,
} from '@/lib/agents/financial/types';

const mockNiifAnalyst = vi.mocked(runNiifAnalyst);
const mockStrategyDirector = vi.mocked(runStrategyDirector);
const mockGovernanceSpecialist = vi.mocked(runGovernanceSpecialist);

// ── Fixture CSV ─────────────────────────────────────────────────────────────
// elite-pulido-diamante.csv tiene descuadres MATERIALES deliberados para probar
// el Curator (R1/R5/R6/R7) → siempre bloquea el gate. Para el happy path del
// pipeline usamos un CSV mínimo que cuadra perfectamente:
//   Activo 300M = Pasivo 100M + Patrimonio 200M.
// Sin cuentas P&L (Clases 4-7) → R8 no interviene → sin blocking.

const BALANCED_CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  '110505,Caja general,Auxiliar,1,100000000',
  '130505,Clientes nacionales,Auxiliar,1,200000000',
  '221005,Proveedores nacionales,Auxiliar,1,100000000',
  '330505,Capital social,Auxiliar,1,200000000',
].join('\n');

// La ruta al fixture multiperiodo se conserva para los tests de BalanceValidationError.
const FIXTURE_PATH = resolve(
  __dirname,
  '../../../preprocessing/__fixtures__/elite-pulido-diamante.csv',
);

// ── Mock outputs mínimos ─────────────────────────────────────────────────────
// El validador post-render sólo falla en placeholders [___] o PARTE I/II/III
// ausentes. PARTE I/II/III los inyecta buildConsolidatedReport — no dependen
// del contenido de los agentes. Por eso los mocks devuelven strings simples.

const MOCK_NIIF: NiifAnalysisResult = {
  balanceSheet: '## Estado de Situación Financiera\nActivo Total: $2.540.000.000',
  incomeStatement: '## Estado de Resultados\nUtilidad Neta: $186.750.000',
  cashFlowStatement: '## Flujos de Efectivo\nFlujo Operacional: $150.000.000',
  equityChangesStatement: '## Cambios en Patrimonio\nSaldo Final: $1.120.000.000',
  technicalNotes: '## Notas Técnicas\nBalance cuadra al centavo con R8.',
  fullContent:
    '## Estado de Situación Financiera\nActivo Total: $2.540.000.000\n\n' +
    '## Estado de Resultados\nUtilidad Neta: $186.750.000\n\n' +
    '## Flujos de Efectivo\nFlujo Operacional: $150.000.000\n\n' +
    '## Cambios en Patrimonio\nSaldo Final: $1.120.000.000\n\n' +
    '## Notas Técnicas\nBalance cuadra al centavo con R8.',
};

const MOCK_STRATEGY: StrategicAnalysisResult = {
  kpiDashboard: '## KPIs\nROE: 16,7 % | ROA: 7,3 % | Margen Neto: 5,2 %',
  breakEvenAnalysis: '## Punto de Equilibrio\nIngreso Mínimo: $1.800.000.000',
  projectedCashFlow: '## Flujo Proyectado 12 Meses\n...',
  strategicRecommendations: '## Recomendaciones\n1. Reducir cartera. 2. Optimizar costos.',
  fullContent:
    '## KPIs\nROE: 16,7 % | ROA: 7,3 % | Margen Neto: 5,2 %\n\n' +
    '## Punto de Equilibrio\nIngreso Mínimo: $1.800.000.000\n\n' +
    '## Flujo Proyectado 12 Meses\n...\n\n' +
    '## Recomendaciones\n1. Reducir cartera. 2. Optimizar costos.',
};

const MOCK_GOVERNANCE: GovernanceResult = {
  financialNotes: '## Nota 1 — Políticas Contables\nNIIF para PYMES Grupo 2.',
  shareholderMinutes: '## Acta de Asamblea 2025\nAprobación de estados financieros.',
  fullContent:
    '## Nota 1 — Políticas Contables\nNIIF para PYMES Grupo 2.\n\n' +
    '## Acta de Asamblea 2025\nAprobación de estados financieros.',
};

// ── Empresa de prueba ────────────────────────────────────────────────────────

const TEST_COMPANY: CompanyInfo = {
  name: 'Pulido Diamante SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  comparativePeriod: '2024',
  niifGroup: 2,
  city: 'Bogotá',
};

// ── Setup ────────────────────────────────────────────────────────────────────

let balancedPreprocessed: ReturnType<typeof preprocessTrialBalance>;

beforeAll(() => {
  const rows = parseTrialBalanceCSV(BALANCED_CSV);
  balancedPreprocessed = preprocessTrialBalance(rows);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockNiifAnalyst.mockResolvedValue(MOCK_NIIF);
  mockStrategyDirector.mockResolvedValue(MOCK_STRATEGY);
  mockGovernanceSpecialist.mockResolvedValue(MOCK_GOVERNANCE);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('orchestrateFinancialReport — happy path', () => {
  it('llama a los 3 agentes exactamente una vez', async () => {
    const report = await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    expect(report).toBeDefined();
    expect(mockNiifAnalyst).toHaveBeenCalledTimes(1);
    expect(mockStrategyDirector).toHaveBeenCalledTimes(1);
    expect(mockGovernanceSpecialist).toHaveBeenCalledTimes(1);
  });

  it('el reporte contiene niifAnalysis, strategicAnalysis y governance', async () => {
    const report = await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    expect(report.niifAnalysis).toStrictEqual(MOCK_NIIF);
    expect(report.strategicAnalysis).toStrictEqual(MOCK_STRATEGY);
    expect(report.governance).toStrictEqual(MOCK_GOVERNANCE);
  });

  it('el reporte incluye company y consolidatedReport', async () => {
    const report = await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    expect(report.company.name).toBe('Pulido Diamante SAS');
    expect(report.consolidatedReport).toContain('# REPORTE FINANCIERO CONSOLIDADO');
    expect(report.consolidatedReport).toContain('# PARTE I:');
    expect(report.consolidatedReport).toContain('# PARTE II:');
    expect(report.consolidatedReport).toContain('# PARTE III:');
  });

  it('generatedAt es un string ISO 8601', async () => {
    const report = await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('orchestrateFinancialReport — eventos SSE', () => {
  it('emite stage_start y stage_complete para los 4 stages en orden', async () => {
    const events: FinancialProgressEvent[] = [];

    await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      {
        preprocessed: balancedPreprocessed,
        onProgress: (e) => events.push(e),
      },
    );

    const stageEvents = events.filter(
      (e) => e.type === 'stage_start' || e.type === 'stage_complete',
    ) as Array<{ type: 'stage_start' | 'stage_complete'; stage: number; label: string }>;

    // Debe haber al menos 4 start + 4 complete (stages 1..4)
    const starts = stageEvents.filter((e) => e.type === 'stage_start');
    const completes = stageEvents.filter((e) => e.type === 'stage_complete');

    expect(starts.length).toBeGreaterThanOrEqual(4);
    expect(completes.length).toBeGreaterThanOrEqual(4);
  });

  it('los stages 1, 2, 3 y 4 tienen start antes de complete', async () => {
    const events: FinancialProgressEvent[] = [];

    await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      {
        preprocessed: balancedPreprocessed,
        onProgress: (e) => events.push(e),
      },
    );

    for (const stage of [1, 2, 3, 4] as const) {
      const startIdx = events.findIndex(
        (e) => e.type === 'stage_start' && (e as { stage: number }).stage === stage,
      );
      const completeIdx = events.findIndex(
        (e) => e.type === 'stage_complete' && (e as { stage: number }).stage === stage,
      );
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(completeIdx).toBeGreaterThan(startIdx);
    }
  });

  it('los stages 1→2→3 arrancan en orden secuencial', async () => {
    const events: FinancialProgressEvent[] = [];

    await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      {
        preprocessed: balancedPreprocessed,
        onProgress: (e) => events.push(e),
      },
    );

    const stageStarts = events
      .filter((e) => e.type === 'stage_start')
      .map((e) => (e as { stage: number }).stage);

    const idx1 = stageStarts.indexOf(1);
    const idx2 = stageStarts.indexOf(2);
    const idx3 = stageStarts.indexOf(3);

    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });
});

describe('orchestrateFinancialReport — BalanceValidationError', () => {
  it('lanza BalanceValidationError cuando el balance es bloqueante', async () => {
    // Construimos un PreprocessedBalance minimal con validation.blocking = true.
    // equationBalanced: false → bridgeActive = false → el blocking no se levanta.
    const blockingSnap = {
      period: '2025',
      validation: {
        blocking: true,
        reasons: ['Activo ≠ Pasivo + Patrimonio: diferencia de $50.000.000'],
        suggestedAccounts: ['110505', '330505'],
        adjustments: [],
      },
      summary: {
        equationBalanced: false,
        totalAssets: 0,
        totalLiabilities: 0,
        totalEquity: 0,
        totalRevenue: 0,
        totalExpenses: 0,
        netIncome: 0,
      },
    };

    const blockingPreprocessed = {
      periods: [blockingSnap],
      primary: blockingSnap,
    };

    await expect(
      orchestrateFinancialReport(
        { rawData: '', company: TEST_COMPANY, language: 'es' },
        { preprocessed: blockingPreprocessed },
      ),
    ).rejects.toThrow(BalanceValidationError);
  });

  it('BalanceValidationError incluye reasons y suggestedAccounts', async () => {
    const blockingSnap = {
      period: '2025',
      validation: {
        blocking: true,
        reasons: ['Activo $100 ≠ Pasivo $80 + Patrimonio $10'],
        suggestedAccounts: ['220505'],
        adjustments: [],
      },
      summary: { equationBalanced: false },
    };

    try {
      await orchestrateFinancialReport(
        { rawData: '', company: TEST_COMPANY, language: 'es' },
        { preprocessed: { periods: [blockingSnap], primary: blockingSnap } },
      );
      expect.fail('Debería haber lanzado BalanceValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(BalanceValidationError);
      const balErr = err as BalanceValidationError;
      // deriveValidation prefija cada reason con "[period] "
      expect(balErr.reasons.some((r) => r.includes('Activo $100 ≠ Pasivo $80 + Patrimonio $10'))).toBe(true);
      expect(balErr.suggestedAccounts).toContain('220505');
    }
  });

  it('no lanza cuando el balance está cuadrado (blocking: false)', async () => {
    // Usamos el balancedPreprocessed real (cuadra perfectamente) — garantiza que
    // todos los builders deterministas (buildNiifAncora, etc.) tienen el shape correcto.
    await expect(
      orchestrateFinancialReport(
        { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
        { preprocessed: balancedPreprocessed },
      ),
    ).resolves.toBeDefined();
  });
});

describe('orchestrateFinancialReport — firma de los agentes', () => {
  it('runNiifAnalyst recibe rawData, company, language y bindingTotalsBlock', async () => {
    await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    const [rawData, company, language, , bindingTotals] = mockNiifAnalyst.mock.calls[0];
    expect(rawData).toBe(BALANCED_CSV);
    expect(company.name).toBe('Pulido Diamante SAS');
    expect(language).toBe('es');
    expect(bindingTotals).toContain('TOTALES VINCULANTES');
  });

  it('runStrategyDirector recibe el NiifAnalysisResult del agente 1', async () => {
    await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    const [niifArg] = mockStrategyDirector.mock.calls[0];
    expect(niifArg).toStrictEqual(MOCK_NIIF);
  });

  it('runGovernanceSpecialist recibe NiifAnalysisResult + StrategicAnalysisResult', async () => {
    await orchestrateFinancialReport(
      { rawData: BALANCED_CSV, company: TEST_COMPANY, language: 'es' },
      { preprocessed: balancedPreprocessed },
    );

    const [niifArg, stratArg] = mockGovernanceSpecialist.mock.calls[0];
    expect(niifArg).toStrictEqual(MOCK_NIIF);
    expect(stratArg).toStrictEqual(MOCK_STRATEGY);
  });
});

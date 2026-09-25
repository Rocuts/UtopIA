// ---------------------------------------------------------------------------
// valoracion-18 (W3-A): <macro_vigente> de Estrategia con el servicio macro
// ---------------------------------------------------------------------------
// El servicio macro ya expone inflación, tasa de política y TRM con valor,
// vigencia y fuente por campo (`getMacroSnapshotForPrompts`), pero
// `runStrategyPhase` nunca lo pasaba al Director de Estrategia: el bloque
// <macro_vigente> salía siempre N/D y los escenarios se indexaban a una
// inflación "supuesta". Sin dato verificado el bloque sigue en N/D.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agents/financial/agents/strategy-director', () => ({
  runStrategyDirector: vi.fn(),
}));
vi.mock('@/lib/macro/prompt-snapshot', () => ({
  getMacroSnapshotForPrompts: vi.fn(),
}));

import { runStrategyDirector } from '@/lib/agents/financial/agents/strategy-director';
import { getMacroSnapshotForPrompts } from '@/lib/macro/prompt-snapshot';
import { runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import { buildStrategyDirectorPrompt } from '@/lib/agents/financial/prompts/strategy-director.prompt';
import type { MacroSnapshot } from '@/lib/agents/financial/valuation/macro-context';
import type { NiifAnalysisResult, StrategicAnalysisResult } from '@/lib/agents/financial/types';

const SNAPSHOT: MacroSnapshot = {
  inflationCopYoYPercent: { value: 5.1, asOf: '2026-08-31', source: 'DANE — IPC, variación anual' },
  policyRatePercent: null,
  trmCopPerUsd: null,
};

const NIIF = { fullContent: 'NIIF', json: null } as unknown as NiifAnalysisResult;
const STRATEGY = {
  kpiDashboard: '',
  breakEvenAnalysis: '',
  projectedCashFlow: '',
  strategicRecommendations: '',
  fullContent: 'Estrategia',
} as StrategicAnalysisResult;
const COMPANY = { name: 'X SAS', nit: '900123456', fiscalPeriod: '2025' };

const eliteSent = () => vi.mocked(runStrategyDirector).mock.calls[0]?.[7];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runStrategyDirector).mockResolvedValue(STRATEGY);
});

describe('runStrategyPhase — snapshot macro para <macro_vigente>', () => {
  it('pide el snapshot al servicio macro y lo pasa al Director de Estrategia', async () => {
    vi.mocked(getMacroSnapshotForPrompts).mockResolvedValue(SNAPSHOT);
    await runStrategyPhase({ niifResult: NIIF, bindingTotals: 'T', company: COMPANY, language: 'es' });
    expect(getMacroSnapshotForPrompts).toHaveBeenCalledTimes(1);
    expect(eliteSent()?.macro).toEqual(SNAPSHOT);
  });

  it('conserva el resto del contexto élite del caller', async () => {
    vi.mocked(getMacroSnapshotForPrompts).mockResolvedValue(SNAPSHOT);
    await runStrategyPhase({
      niifResult: NIIF, bindingTotals: 'T', company: COMPANY, language: 'es',
      elite: { hechosEmpresa: '<hechos_empresa>x</hechos_empresa>' },
    });
    expect(eliteSent()).toMatchObject({ hechosEmpresa: '<hechos_empresa>x</hechos_empresa>', macro: SNAPSHOT });
  });

  it('el snapshot del caller (incluso null) prevalece y no se consulta el servicio', async () => {
    await runStrategyPhase({
      niifResult: NIIF, bindingTotals: 'T', company: COMPANY, language: 'es', elite: { macro: null },
    });
    expect(getMacroSnapshotForPrompts).not.toHaveBeenCalled();
    expect(eliteSent()?.macro).toBeNull();
  });

  it('si el servicio falla, Estrategia sigue con <macro_vigente> en N/D', async () => {
    vi.mocked(getMacroSnapshotForPrompts).mockRejectedValue(new Error('db down'));
    await runStrategyPhase({ niifResult: NIIF, bindingTotals: 'T', company: COMPANY, language: 'es' });
    expect(eliteSent()?.macro).toBeNull();
  });

  it('el prompt publica valor, vigencia y fuente del dato y N/D en lo que falta', () => {
    const prompt = buildStrategyDirectorPrompt(COMPANY as never, 'es', undefined, { macro: SNAPSHOT });
    expect(prompt).toMatch(/Inflación anual Colombia \(IPC\): 5,10% \(vigencia 2026-08-31; fuente: DANE/);
    expect(prompt).toMatch(/TRM: N\/D/);
  });
});

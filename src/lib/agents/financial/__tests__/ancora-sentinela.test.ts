// ---------------------------------------------------------------------------
// pipeline-flujo-01 — el Âncora vacío no puede presentarse como dato real
// ---------------------------------------------------------------------------
// Sin preprocesado, `buildNiifAncora` devolvía un Âncora con "0" en todas las
// cifras y sin bandera de indisponibilidad. /niif lo emitía siempre y la vista
// de las cuatro áreas lo leía como un balance real: activos $0, utilidad $0 y
// un Score NIIF 80/100 sumado sobre checks sentinela. Contrato: null ≠ 0.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runNiifPhase } from '@/lib/agents/financial/orchestrator';
import {
  buildNiifAncora,
  isSentinelAncora,
  ancoraOrNull,
} from '@/lib/agents/financial/ancora/build-ancora';
import { deriveAncoraView } from '@/lib/ancora/derive-ancora-view';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { CompanyInfo, NiifAnalysisResult } from '@/lib/agents/financial/types';

const COMPANY: CompanyInfo = {
  name: 'X SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
  city: 'Bogotá',
};

const CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  '110505,Caja general,Auxiliar,1,100000000',
  '130505,Clientes nacionales,Auxiliar,1,200000000',
  '221005,Proveedores nacionales,Auxiliar,1,100000000',
  '330505,Capital social,Auxiliar,1,200000000',
].join('\n');

const NIIF_TEXT: NiifAnalysisResult = {
  balanceSheet: '## Estado de Situación Financiera',
  incomeStatement: '## Estado de Resultados',
  cashFlowStatement: '## Flujos de Efectivo',
  equityChangesStatement: '## Cambios en Patrimonio',
  technicalNotes: '## Notas Técnicas',
  fullContent: '## Estado de Situación Financiera',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runNiifAnalyst).mockResolvedValue({ ...NIIF_TEXT });
});

describe('Âncora sentinela (sin preprocesado)', () => {
  it('buildNiifAncora(undefined) queda marcado como sentinela y ancoraOrNull lo convierte en null', () => {
    const ancora = buildNiifAncora(undefined, COMPANY);
    expect(isSentinelAncora(ancora)).toBe(true);
    expect(ancoraOrNull(ancora)).toBeNull();
    // Y la vista, al recibir null, no fabrica cifras ni puntuación.
    const view = deriveAncoraView(ancoraOrNull(ancora), null, { name: COMPANY.name, nit: COMPANY.nit });
    expect(view.hasData).toBe(false);
    expect(view.niif.activos).toBeNull();
    expect(view.derived.scoreNiif).toBeNull();
  });

  it('un Âncora calculado desde el preprocesado NO es sentinela', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const ancora = buildNiifAncora(pp, COMPANY);
    expect(isSentinelAncora(ancora)).toBe(false);
    expect(ancoraOrNull(ancora)).toBe(ancora);
  });

  it('runNiifPhase sin preprocesado emite ancora=null (no un Âncora de ceros)', async () => {
    const phase = await runNiifPhase({
      rawData: '# INFORME DE VALIDACION ARITMETICA\nsin tabla parseable',
      company: COMPANY,
      language: 'es',
    });
    expect(phase.context.ppForAgents).toBeUndefined();
    expect(phase.ancora).toBeNull();
  });

  it('runNiifPhase con preprocesado sigue emitiendo el Âncora real', async () => {
    const phase = await runNiifPhase({ rawData: CSV, company: COMPANY, language: 'es' });
    expect(phase.ancora).not.toBeNull();
    expect(phase.ancora!.ccvNiif.A01).toBe('30000000000');
  });
});

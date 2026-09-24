// ---------------------------------------------------------------------------
// runNiifPhase — gate de emisión con el informe real y periodo determinista
// ---------------------------------------------------------------------------
// pipeline-flujo-02: V15 se evaluaba en el pre-vuelo sobre un texto vacío y
//   sellaba CON SALVEDADES todo balance de un solo periodo, aunque el analista
//   declarara la impracticabilidad. Ahora se evalúa sobre `niif.fullContent`.
// recalculo-11: V3 bloqueaba con el EFE R2 (no concilia) en vez del EFE
//   determinista.
// pipeline-flujo-17: el periodo del intake no se contrastaba con el del
//   balance y `company.fiscalPeriod/comparativePeriod` del JSON los emitía el
//   LLM sin validación.
//
// Sin llamadas reales a OpenAI: el analista está mockeado a nivel de módulo.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runNiifPhase, alignReportCompanyPeriods } from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { CompanyInfo, NiifAnalysisResult } from '@/lib/agents/financial/types';

const COMPANY: CompanyInfo = {
  name: 'Pulido Diamante SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
  city: 'Bogotá',
};

const SINGLE_2025 = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

const TWO_PERIODS = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000,60000000',
  '410505,Ventas,Auxiliar,1,100000000,150000000',
  '510505,Sueldos,Auxiliar,1,80000000,110000000',
].join('\n');

function textOnly(fullContent: string): NiifAnalysisResult {
  return {
    balanceSheet: '## Estado de Situación Financiera',
    incomeStatement: '## Estado de Resultados',
    cashFlowStatement: '## Flujos de Efectivo',
    equityChangesStatement: '## Cambios en Patrimonio',
    technicalNotes: '## Notas Técnicas',
    fullContent,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('V15 se evalúa sobre el informe del analista, no sobre el pre-vuelo vacío', () => {
  it('balance de un periodo + analista que declara la impracticabilidad → sin V15 en el sello', async () => {
    vi.mocked(runNiifAnalyst).mockResolvedValue(
      textOnly(
        '## Notas Técnicas\nLos estados financieros se presentan sin comparativos del periodo 2024 ' +
          'dado que la información resultó impracticable de obtener (NIIF for SMEs §3.14, §10.21).',
      ),
    );
    const phase = await runNiifPhase({ rawData: SINGLE_2025, company: COMPANY, language: 'es' });
    expect(phase.context.ppForAgents?.comparativos_impracticables).toBe(true);
    expect(phase.context.preflight?.blockers.map((b) => b.code) ?? []).not.toContain('V15');
    expect(phase.niif.fullContent).not.toContain('V15:');
  });

  it('balance de un periodo + analista que NO la declara → V15 sella el informe', async () => {
    vi.mocked(runNiifAnalyst).mockResolvedValue(textOnly('## Notas Técnicas\nSin observaciones.'));
    const phase = await runNiifPhase({ rawData: SINGLE_2025, company: COMPANY, language: 'es' });
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.fullContent).toContain('V15:');
    expect(phase.niif.fullContent).toContain('libros del periodo 2024');
  });
});

describe('V3 usa el EFE determinista', () => {
  it('un EFE R2 que no concilia no sella el informe si el determinista cuadra', async () => {
    vi.mocked(runNiifAnalyst).mockResolvedValue(textOnly('## Notas Técnicas\nComparativo 2024 disponible.'));
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    const cfi = pp.primary.cashFlowIndirecto!;
    pp.primary.cashFlowIndirecto = {
      ...cfi,
      netChangeInCash: cfi.observedChangeInCash + 1_559_097_749.11,
      reconciled: false,
    };
    const phase = await runNiifPhase(
      { rawData: TWO_PERIODS, company: COMPANY, language: 'es' },
      { preprocessed: pp },
    );
    expect(phase.niif.fullContent).not.toMatch(/V3:/);
  });
});

describe('Periodo determinista (pipeline-flujo-17)', () => {
  it('intake 2025 con balance 2024 → bloqueante de periodo y JSON con el año del balance', async () => {
    const json = makeCoherentNiifReport();
    json.company.fiscalPeriod = '2019';
    json.company.comparativePeriod = '2018';
    vi.mocked(runNiifAnalyst).mockResolvedValue({ ...textOnly('## Informe'), json });
    const csv2024 = SINGLE_2025.replace('saldo 2025', 'saldo 2024');
    const phase = await runNiifPhase({ rawData: csv2024, company: COMPANY, language: 'es' });
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.fullContent).toMatch(/formulario declara el ejercicio 2025.*balance de prueba corresponde a 2024/);
    expect(phase.niif.json?.company.fiscalPeriod).toBe('2024');
    // Balance de un solo periodo: no hay comparativo verificable que rotular.
    expect(phase.niif.json?.company.comparativePeriod).toBeNull();
  });

  it('alignReportCompanyPeriods toma periodos del preprocesado y la identidad del intake', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    const json = makeCoherentNiifReport();
    json.company.fiscalPeriod = '2019';
    json.company.comparativePeriod = null;
    json.company.name = 'Nombre inventado';
    const { json: aligned, changed } = alignReportCompanyPeriods(json, COMPANY, pp);
    expect(aligned.company.fiscalPeriod).toBe('2025');
    expect(aligned.company.comparativePeriod).toBe('2024');
    expect(aligned.company.name).toBe(COMPANY.name);
    expect(aligned.company.nit).toBe(COMPANY.nit);
    expect(changed.length).toBeGreaterThan(0);
  });

  it('comparativo impracticable (§3.14) → sin rótulo comparativo (E9 no exige columnas que no se presentan)', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    pp.comparativos_impracticables = true;
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    const { json: aligned } = alignReportCompanyPeriods(json, COMPANY, pp);
    expect(aligned.company.fiscalPeriod).toBe('2025');
    expect(aligned.company.comparativePeriod).toBeNull();
  });

  it('sin preprocesado usa el periodo del intake y no inventa comparativo', () => {
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2023';
    const { json: aligned } = alignReportCompanyPeriods(json, COMPANY, undefined);
    expect(aligned.company.fiscalPeriod).toBe('2025');
    expect(aligned.company.comparativePeriod).toBeNull();
  });
});

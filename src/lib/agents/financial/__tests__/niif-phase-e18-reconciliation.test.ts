// ---------------------------------------------------------------------------
// runNiifPhase — E18 en el validador de la fase, veredicto conservado y V3 en
// el pre-vuelo
// ---------------------------------------------------------------------------
// niif-contrato-02: E18 (EFE emitido vs EFE determinista) sólo corría dentro
//   del analista; `buildNiifValidatorOptions` no pasaba `deterministicCashFlow`
//   y los gates de la fase, /export y /html no lo evaluaban.
// niif-contrato-02 (b) / pipeline-flujo-15: al sellar, `niif.reconciliation`
//   se reconstruía sin `cashFlowDiscrepancies` ni `degradedPasses`.
// recalculo-11: el pre-vuelo de Stage 0 evaluaba el gate sin el snapshot
//   comparativo, de modo que V3 (EFE determinista) nunca corría ahí.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));
vi.mock('@/lib/pillars/audit-report-emittable', async (orig) => {
  const actual = await orig<typeof import('@/lib/pillars/audit-report-emittable')>();
  return { ...actual, auditReportEmittable: vi.fn(actual.auditReportEmittable) };
});

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import {
  buildNiifValidatorOptions,
  prepareFinancialContext,
  runNiifPhase,
  sellarConSalvedades,
} from '@/lib/agents/financial/orchestrator';
import { auditReportEmittable } from '@/lib/pillars/audit-report-emittable';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import {
  buildDeterministicCashFlow,
  crossCheckCashFlowAgainstDeterministic,
  formatCashFlowCrossCheckViolations,
} from '@/lib/agents/financial/contracts/deterministic-breakdown';
import type { CompanyInfo, NiifAnalysisResult } from '@/lib/agents/financial/types';

const COMPANY: CompanyInfo = {
  name: 'Pulido Diamante SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
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
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,0,20000000',
  '410505,Ventas,Auxiliar,1,100000000,150000000',
  '510505,Sueldos,Auxiliar,1,80000000,110000000',
].join('\n');

function analystResult(over: Partial<NiifAnalysisResult> = {}): NiifAnalysisResult {
  return {
    balanceSheet: '## Estado de Situación Financiera',
    incomeStatement: '## Estado de Resultados',
    cashFlowStatement: '## Flujos de Efectivo',
    equityChangesStatement: '## Cambios en Patrimonio',
    technicalNotes: '## Notas Técnicas',
    fullContent: '## Notas Técnicas\nComparativo 2024 disponible.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('niif-contrato-02 — E18 en buildNiifValidatorOptions', () => {
  it('con dos periodos las opciones llevan el EFE determinista; con uno, no', () => {
    const two = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    const opts = buildNiifValidatorOptions(two);
    expect(opts.deterministicCashFlow).toBeTruthy();
    expect(opts.deterministicCashFlow).toEqual(buildDeterministicCashFlow(two.primary, two.comparative!));

    const one = preprocessTrialBalance(parseTrialBalanceCSV(SINGLE_2025));
    expect(buildNiifValidatorOptions(one).deterministicCashFlow ?? null).toBeNull();
  });

  it('runNiifPhase sella con E18 un EFE que no es el determinista', async () => {
    const json = makeCoherentNiifReport();
    vi.mocked(runNiifAnalyst).mockResolvedValue(
      analystResult({ json, reconciliation: { deviations: [], lineGaps: [], repairAttempted: false, clean: true } }),
    );
    const phase = await runNiifPhase({ rawData: TWO_PERIODS, company: COMPANY, language: 'es' });
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.fullContent).toMatch(/E18\./);
  });

  it('no duplica en el sello las discrepancias del EFE que el analista ya declaró', async () => {
    const json = makeCoherentNiifReport();
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    const efe = buildDeterministicCashFlow(pp.primary, pp.comparative!)!;
    const alreadyDeclared = formatCashFlowCrossCheckViolations(
      crossCheckCashFlowAgainstDeterministic(json.cashFlow, efe),
    );
    expect(alreadyDeclared.length).toBeGreaterThan(0);
    vi.mocked(runNiifAnalyst).mockResolvedValue(
      analystResult({
        json,
        reconciliation: {
          deviations: [], lineGaps: [], repairAttempted: false, clean: false,
          cashFlowDiscrepancies: alreadyDeclared,
        },
      }),
    );
    const phase = await runNiifPhase({ rawData: TWO_PERIODS, company: COMPANY, language: 'es' });
    expect(phase.niif.fullContent).not.toMatch(/E18\./);
    expect(phase.niif.reconciliation?.cashFlowDiscrepancies).toEqual(alreadyDeclared);
  });
});

describe('niif-contrato-02 — el sello conserva el veredicto previo', () => {
  it('sellarConSalvedades conserva cashFlowDiscrepancies y degradedPasses', () => {
    const niif = analystResult({
      reconciliation: {
        deviations: [], lineGaps: [], repairAttempted: true, clean: true,
        cashFlowDiscrepancies: ['EFE: operación difiere'],
        degradedPasses: ['Notas técnicas'],
      },
    });
    sellarConSalvedades(niif, ['E1. descuadre'], 'es');
    expect(niif.reconciliation).toMatchObject({
      clean: false,
      repairAttempted: true,
      cashFlowDiscrepancies: ['EFE: operación difiere'],
      degradedPasses: ['Notas técnicas'],
    });
  });

  it('el sello del gate de emisión (V15) tampoco pierde los pases degradados', async () => {
    vi.mocked(runNiifAnalyst).mockResolvedValue(
      analystResult({
        fullContent: '## Notas Técnicas\nSin observaciones.',
        reconciliation: {
          deviations: [], lineGaps: [], repairAttempted: false, clean: true,
          cashFlowDiscrepancies: [], degradedPasses: ['Notas técnicas'],
        },
      }),
    );
    const phase = await runNiifPhase({ rawData: SINGLE_2025, company: COMPANY, language: 'es' });
    expect(phase.niif.fullContent).toContain('V15:');
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.reconciliation?.degradedPasses).toEqual(['Notas técnicas']);
  });
});

describe('recalculo-11 — el pre-vuelo recibe el snapshot comparativo', () => {
  it('auditReportEmittable del pre-vuelo corre con comparativeSnapshot y sin checks de texto', async () => {
    const ctx = await prepareFinancialContext({ rawData: TWO_PERIODS, company: COMPANY, language: 'es' });
    const call = vi.mocked(auditReportEmittable).mock.calls.at(-1)!;
    expect(call[4]).toMatchObject({ skipReportTextChecks: true });
    expect(call[4]?.comparativeSnapshot?.period).toBe(ctx.ppForAgents?.comparative?.period);
    expect(call[4]?.comparativeSnapshot).toBeTruthy();
  });
});

describe('prompts-normativa-08 — tipo societario del gate con la misma normalización del acta', () => {
  it.each([
    ['S. A. S.', 'SAS'],
    ['Sociedad por Acciones Simplificada', 'SAS'],
    ['Sociedad Anónima', 'SA'],
    ['Limitada', 'LTDA'],
    ['E.U.', 'EU'],
    ['Comandita simple', 'OTRO'],
  ])('%s → %s', async (entityType, expected) => {
    await prepareFinancialContext({ rawData: SINGLE_2025, company: { ...COMPANY, entityType }, language: 'es' });
    const call = vi.mocked(auditReportEmittable).mock.calls.at(-1)!;
    expect(call[2].tipoSocietario).toBe(expected);
  });

  it('sin tipo declarado sigue siendo indeterminado (no se asume SAS en el gate)', async () => {
    await prepareFinancialContext({ rawData: SINGLE_2025, company: { ...COMPANY, entityType: undefined }, language: 'es' });
    const call = vi.mocked(auditReportEmittable).mock.calls.at(-1)!;
    expect(call[2].tipoSocietario).toBeUndefined();
  });
});

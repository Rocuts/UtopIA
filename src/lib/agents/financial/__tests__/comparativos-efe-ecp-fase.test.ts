// ---------------------------------------------------------------------------
// Comparativos del EFE y del ECP en la fase NIIF completa (pendiente #3)
// ---------------------------------------------------------------------------
// El analista real (`runNiifAnalyst`) con el LLM mockeado: el Pass-2 intenta
// escribir cifras comparativas en el EFE y el código las descarta y adjunta
// las deterministas (tres cortes) o la nota de impracticabilidad (dos cortes).
// La fase (`runNiifPhase`) valida con las mismas anclas y no sella.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import { runNiifPhase } from '@/lib/agents/financial/orchestrator';
import {
  csvDosCortes,
  csvTresCortes,
  informeTresCortes,
  preprocesarTresCortes,
} from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { CompanyInfo } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const COMPANY: CompanyInfo = {
  name: 'Demo Tres Cortes SAS',
  nit: '900765432-6',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
};

/** El LLM devuelve el informe honesto; en el Pass-2 inventa un comparativo del EFE. */
function mockPasses(json: NiifReportJson) {
  callFinancialAgentMock.mockImplementation(async (opts: { agentName: string }) => {
    if (opts.agentName.startsWith('niif-analyst-pass1')) {
      return {
        json: {
          company: json.company,
          balanceSheet: json.balanceSheet,
          incomeStatement: json.incomeStatement,
          curatorFlags: json.curatorFlags,
          reportMode: json.reportMode,
        },
        meta: {},
      };
    }
    if (opts.agentName === 'niif-analyst-pass2') {
      return {
        json: {
          cashFlow: {
            ...json.cashFlow,
            sections: json.cashFlow.sections.map((s) => ({
              section: s.section,
              netFlow: s.netFlow,
              lines: s.lines
                .filter((l) => l.amountPrimary !== '0')
                .map((l) => ({ ...l, amountComparative: '123456789' })),
            })),
          },
          equityChanges: { rows: json.equityChanges.rows, notes: [] },
        },
        meta: {},
      };
    }
    return { json: { technicalNotes: [] }, meta: {} };
  });
}

async function fase(csv: string, pp: PreprocessedBalance) {
  mockPasses(informeTresCortes(pp));
  return runNiifPhase({ rawData: csv, company: COMPANY, language: 'es' }, { preprocessed: pp });
}

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

describe('runNiifPhase — comparativos del EFE y del ECP', () => {
  it('tres cortes: el comparativo del modelo se descarta, se adjunta el determinista y el informe sale limpio', async () => {
    const pp = preprocesarTresCortes();
    const phase = await fase(csvTresCortes(), pp);
    const json = phase.niif.json!;
    const cells = json.cashFlow.sections.flatMap((s) => s.lines.map((l) => l.amountComparative));
    expect(cells).not.toContain('123456789');
    expect(json.cashFlow.netChangeComparative).toBe('1500000000');
    expect(json.cashFlow.cashClosingComparative).toBe(json.cashFlow.cashOpening);
    expect(json.equityChanges.comparativeRows?.length).toBeGreaterThan(2);
    expect(phase.niif.reconciliation?.clean).toBe(true);
    expect(phase.niif.fullContent).not.toMatch(/\[NIIF JSON validator\]|E18\.|E24\./);
  });

  it('dos cortes: sin cifras comparativas del EFE/ECP, con la nota determinista, y sin sello', async () => {
    const csv = csvDosCortes();
    const pp = preprocesarTresCortes(csv);
    const phase = await fase(csv, pp);
    const json = phase.niif.json!;
    expect(json.cashFlow.sections.flatMap((s) => s.lines).every((l) => l.amountComparative === null)).toBe(true);
    expect(json.cashFlow.comparativeNote).toMatch(/no presentada.*3\.14 y 10\.21/);
    expect(json.equityChanges.comparativeRows).toBeNull();
    expect(json.equityChanges.comparativeNote).toMatch(/Estado de cambios en el patrimonio/);
    expect(phase.niif.reconciliation?.clean).toBe(true);
  });
});

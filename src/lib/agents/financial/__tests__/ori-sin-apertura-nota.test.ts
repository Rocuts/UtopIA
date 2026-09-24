// ---------------------------------------------------------------------------
// I5-niif 3 — ORI con un solo corte y saldo en el grupo 38
// ---------------------------------------------------------------------------
// Con un solo corte la variación del grupo 38 (superávit por valorizaciones /
// ORI) del periodo no es medible, y `oriPrimary` no admite N/D: el ERI
// presenta ORI $0. La limitación dependía de que el modelo la escribiera en
// `incomeStatement.notes`; ningún código la garantizaba. Ahora la escribe el
// analista de forma determinista, en el idioma del informe.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));

import { parseTrialBalanceCSV, preprocessTrialBalance, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { runNiifAnalyst } from '../agents/niif-analyst';
import { buildOriAnchors, oriNotMeasurableNote } from '../contracts/deterministic-breakdown';
import type { NiifReportJson } from '../contracts/niif-report';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import { buildNiifAnalystPass1Prompt } from '../prompts/niif-analyst.prompt';
import type { CompanyInfo } from '../types';

const COMPANY: CompanyInfo = {
  name: 'Empresa Prueba SAS',
  nit: '900123456',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
};

const csv = (saldos38: number[], periodos: string[]) =>
  [
    `codigo,nombre,nivel,transaccional,${periodos.map((p) => `saldo ${p}`).join(',')}`,
    `110505,Caja,Auxiliar,1,${periodos.map(() => 50_000_000).join(',')}`,
    `190505,Valorizaciones de inversiones,Auxiliar,1,${saldos38.join(',')}`,
    `311505,Capital suscrito y pagado,Auxiliar,1,${periodos.map(() => 50_000_000).join(',')}`,
    `381005,Superavit por valorizaciones de inversiones,Auxiliar,1,${saldos38.join(',')}`,
    `410505,Ventas,Auxiliar,1,${periodos.map(() => 10_000_000).join(',')}`,
    `510506,Sueldos,Auxiliar,1,${periodos.map(() => 10_000_000).join(',')}`,
  ].join('\n');

const pp = (saldos38: number[], periodos: string[]): PreprocessedBalance =>
  preprocessTrialBalance(parseTrialBalanceCSV(csv(saldos38, periodos)));

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
      return { json: { cashFlow: json.cashFlow, equityChanges: { rows: json.equityChanges.rows, notes: [] } }, meta: {} };
    }
    return { json: { technicalNotes: [] }, meta: {} };
  });
}

const analizar = (p: PreprocessedBalance, language: 'es' | 'en') =>
  runNiifAnalyst('csv', COMPANY, language, undefined, '', p, undefined, undefined, undefined, 'LINEA_BASE');

beforeEach(() => {
  callFinancialAgentMock.mockReset();
  mockPasses(makeCoherentNiifReport());
});

describe('ORI no medible con un solo corte — nota determinista', () => {
  it('el ancla del periodo actual es notMeasurable con un solo corte y saldo en el grupo 38', () => {
    expect(buildOriAnchors(pp([5_000_000], ['2025'])).primary?.kind).toBe('notMeasurable');
    expect(buildOriAnchors(pp([0], ['2025'])).primary?.kind).toBe('noGroup38');
    expect(buildOriAnchors(pp([3_000_000, 5_000_000], ['2024', '2025'])).primary?.kind).toBe('measured');
  });

  it('la nota existe en español y en inglés sólo para el ancla no medible', () => {
    const anchor = buildOriAnchors(pp([5_000_000], ['2025'])).primary;
    expect(oriNotMeasurableNote(anchor, 'es')).toEqual({
      ref: null,
      norma: 'NIIF para las PYMES, Sección 5',
      body:
        'Otro resultado integral (ORI) del periodo 2025: no medible sin el corte de apertura. El balance de ' +
        'prueba registra saldo en el grupo 38 (superávit por valorizaciones / ORI), pero sin un corte de ' +
        'apertura utilizable su variación del periodo no se puede determinar; el ORI del periodo se presenta en ' +
        '$0 y esa cifra no es una medición. Para medirlo se requiere un balance de prueba utilizable del corte ' +
        'anterior.',
    });
    expect(oriNotMeasurableNote(anchor, 'en')?.body).toBe(
      'Other comprehensive income (OCI) for 2025: not measurable without the opening cut-off. The trial ' +
        'balance shows a balance in PUC group 38 (revaluation surplus / OCI), but without a usable opening ' +
        'cut-off its movement for the period cannot be determined; OCI for the period is presented as $0 and ' +
        'that figure is not a measurement. Measuring it requires a usable trial balance of the previous cut-off.',
    );
    expect(oriNotMeasurableNote(anchor, 'en')?.norma).toBe('IFRS for SMEs, Section 5');
    expect(oriNotMeasurableNote(buildOriAnchors(pp([0], ['2025'])).primary, 'es')).toBeNull();
    expect(oriNotMeasurableNote(buildOriAnchors(pp([3_000_000, 5_000_000], ['2024', '2025'])).primary, 'es')).toBeNull();
    expect(oriNotMeasurableNote(null, 'es')).toBeNull();
  });

  it('runNiifAnalyst la añade a incomeStatement.notes aunque el modelo no la escriba (es)', async () => {
    const result = await analizar(pp([5_000_000], ['2025']), 'es');
    const notes = result.json!.incomeStatement.notes.map((n) => n.body);
    expect(notes.filter((b) => b.startsWith('Otro resultado integral (ORI) del periodo 2025: no medible'))).toHaveLength(1);
    expect(result.json!.incomeStatement.oriPrimary).toBe('0');
    expect(result.incomeStatement).toMatch(/no medible sin el corte de apertura/);
  });

  it('en un informe en inglés la nota sale en inglés', async () => {
    const result = await analizar(pp([5_000_000], ['2025']), 'en');
    const notes = result.json!.incomeStatement.notes.map((n) => n.body);
    expect(notes.some((b) => b.startsWith('Other comprehensive income (OCI) for 2025: not measurable'))).toBe(true);
    expect(notes.some((b) => b.startsWith('Otro resultado integral (ORI)'))).toBe(false);
  });

  it('sin saldo en el grupo 38 o con corte de apertura no se añade', async () => {
    const sinGrupo = await analizar(pp([0], ['2025']), 'es');
    expect(sinGrupo.json!.incomeStatement.notes.some((n) => /no medible sin el corte de apertura/.test(n.body))).toBe(false);
    const dosCortes = await analizar(pp([3_000_000, 5_000_000], ['2024', '2025']), 'es');
    expect(dosCortes.json!.incomeStatement.notes.some((n) => /no medible sin el corte de apertura/.test(n.body))).toBe(false);
  });

  // Revisión I5-niif: con dos cortes y el comparativo impracticable tampoco
  // hay apertura utilizable (el ancla es notMeasurable); la nota no puede
  // afirmar que el balance trae "un solo corte".
  it('con el comparativo impracticable la nota no afirma que hay un solo corte', async () => {
    const p = { ...pp([3_000_000, 5_000_000], ['2024', '2025']), comparativos_impracticables: true };
    expect(buildOriAnchors(p).primary?.kind).toBe('notMeasurable');
    for (const language of ['es', 'en'] as const) {
      const result = await analizar(p, language);
      const nota = result.json!.incomeStatement.notes.find((n) => /\(ORI\)|\(OCI\)/.test(n.body));
      expect(nota?.body).toMatch(language === 'es' ? /sin un corte de apertura utilizable/ : /without a usable opening cut-off/);
      expect(nota?.body).not.toMatch(/un solo corte|single cut-off/);
    }
  });

  it('el prompt ya no le pide al modelo declarar la limitación: la declara el código', () => {
    const p1 = buildNiifAnalystPass1Prompt(COMPANY, 'es', 'LINEA_BASE', pp([5_000_000], ['2025']));
    expect(p1).not.toContain('la limitación se declara en incomeStatement.notes');
    expect(p1).toMatch(/oriPrimary = "0"; la nota de esa limitación la agrega el código en incomeStatement\.notes/);
  });
});

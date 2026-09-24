// ---------------------------------------------------------------------------
// I5-niif 4 — Sufijo de porción de un grupo partido por plazo, por idioma
// ---------------------------------------------------------------------------
// `normalizeNiifStatementLabels` añade " — porción corriente / no corriente" a
// los dos renglones de un grupo PUC partido por plazo (integración I4, 5a).
// Salía en español también en los informes en inglés: el contexto de rótulos
// no llevaba el idioma. Ahora lo lleva; sin idioma se conserva el del sufijo
// que ya fijó quien lo conocía (el analista), así el orquestador, el Excel y
// el PDF no lo devuelven al español.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import {
  aplicarVencimientosDeclarados,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { normalizeNiifStatementLabels } from '@/lib/export/statement-presentation';
import {
  completeBreakdownFromSnapshot,
  fillComparativeBreakdownFromSnapshot,
  reconcileAnchors,
} from '../agents/reconcile-anchors';
import { toNiifAnalysisResult } from '../agents/renderer';
import type { NiifReportJson } from '../contracts/niif-report';
import { informeHonesto } from '../__fixtures__/perdida-comparativo-w4a';
import { runNiifPhase } from '../orchestrator';

const CSV_DOS_CORTES = [
  'Razón social: DEMO PERDIDAS SAS',
  'NIT: 900.123.456-8',
  'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
  '110505,Caja,Auxiliar,100000,140000',
  '120505,CDT a 18 meses,Auxiliar,10000,30000',
  '120510,Acciones negociables,Auxiliar,15000,20000',
  '152405,Equipo de oficina,Auxiliar,150000,200000',
  '210505,Crédito bancario a 3 años,Auxiliar,50000,80000',
  '220505,Proveedores,Auxiliar,25000,70000',
  '310505,Capital,Auxiliar,200000,200000',
  '413505,Ventas,Auxiliar,0,100000',
  '510506,Sueldos,Auxiliar,0,60000',
].join('\n');

/** 120505 declarado no corriente: el grupo 12 queda partido por plazo. */
function preprocesar(): PreprocessedBalance {
  const { rows } = aplicarVencimientosDeclarados(parseTrialBalanceCSVWithMeta(CSV_DOS_CORTES).rows, {
    '120505': 'no_corriente',
  });
  return preprocessTrialBalance(rows);
}

/** Informe honesto con el ESF completado por el código (grupo 12 en dos bloques). */
function esfPartido(pp: PreprocessedBalance): NiifReportJson {
  const json = informeHonesto(pp);
  json.balanceSheet = { ...json.balanceSheet, assets: [], liabilities: [], equity: [] };
  const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
  const { json: done } = completeBreakdownFromSnapshot(json, gaps, pp.primary);
  return fillComparativeBreakdownFromSnapshot(done, pp.comparative ?? undefined).json;
}

const grupo12 = (json: NiifReportJson) =>
  json.balanceSheet.assets.filter((l) => l.account === '12').map((l) => l.label);

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

describe('normalizeNiifStatementLabels — idioma del sufijo de porción', () => {
  it('sin idioma ni sufijo previo: español (comportamiento de I4)', () => {
    const json = normalizeNiifStatementLabels(esfPartido(preprocesar())).json;
    expect(grupo12(json)).toEqual(['Inversiones — porción corriente', 'Inversiones — porción no corriente']);
  });

  it('language "en": sufijo en inglés', () => {
    const json = normalizeNiifStatementLabels(esfPartido(preprocesar()), { language: 'en' }).json;
    expect(grupo12(json)).toEqual(['Inversiones — current portion', 'Inversiones — non-current portion']);
  });

  it('sin idioma se conserva el sufijo en inglés que ya trae el grupo; con idioma explícito se reescribe', () => {
    const en = normalizeNiifStatementLabels(esfPartido(preprocesar()), { language: 'en' }).json;
    const again = normalizeNiifStatementLabels(en, { primaryPeriodoTipo: 'cerrado' });
    expect(grupo12(again.json)).toEqual(['Inversiones — current portion', 'Inversiones — non-current portion']);
    const es = normalizeNiifStatementLabels(en, { language: 'es' }).json;
    expect(grupo12(es)).toEqual(['Inversiones — porción corriente', 'Inversiones — porción no corriente']);
    // Idempotente en cada idioma.
    expect(normalizeNiifStatementLabels(es, { language: 'es' }).changed).toBe(0);
  });

  it('el sufijo en inglés de un renglón de detalle (no de grupo) es del analista y no se toca', () => {
    const json = esfPartido(preprocesar());
    json.balanceSheet.assets.unshift({
      ...json.balanceSheet.assets[0],
      account: '120505',
      label: 'CDT a 18 meses — non-current portion',
    });
    const out = normalizeNiifStatementLabels(json, { language: 'es' }).json;
    expect(out.balanceSheet.assets[0].label).toBe('CDT a 18 meses — non-current portion');
  });

  it('toNiifAnalysisResult pasa el idioma al Markdown y al JSON', () => {
    const r = toNiifAnalysisResult(esfPartido(preprocesar()), { language: 'en' });
    expect(grupo12(r.json!)).toEqual(['Inversiones — current portion', 'Inversiones — non-current portion']);
    expect(r.balanceSheet).toContain('Inversiones — non-current portion');
    expect(r.balanceSheet).not.toContain('porción');
  });
});

describe('ruta real — informe en inglés', () => {
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

  it('el grupo partido lleva el sufijo en inglés en el JSON y en el Markdown que entrega runNiifPhase', async () => {
    const pp = preprocesar();
    // El modelo deja el ESF sin desglose: el código lo completa por plazo.
    const json = informeHonesto(pp);
    json.balanceSheet = { ...json.balanceSheet, assets: [], liabilities: [] };
    mockPasses(json);
    const phase = await runNiifPhase(
      {
        rawData: CSV_DOS_CORTES,
        company: { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
        language: 'en',
      },
      { preprocessed: pp },
    );
    expect(grupo12(phase.niif.json!)).toEqual(['Inversiones — current portion', 'Inversiones — non-current portion']);
    expect(phase.niif.balanceSheet).toContain('Inversiones — current portion');
    expect(phase.niif.balanceSheet).not.toMatch(/porción (?:no )?corriente/);
  });
});

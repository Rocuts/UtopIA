// ---------------------------------------------------------------------------
// Dictamen del Revisor Fiscal (pipeline fiscal-opinion) — regresiones 2026-09
// ---------------------------------------------------------------------------
// tributario-modulos-11  fallbacks "Sin incorrecciones materiales" / opinión limpia
// prompts-normativa-02   umbral SAGRILAFT 160.000 UVT
// prompts-normativa-20   empresa en marcha, KAM obligatorios, NIC 1 §43, Art. 457
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MisstatementReviewReportJson, ComplianceCheckReportJson } from '../../contracts/fiscal-opinion';

const callMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (...args: unknown[]) => callMock(...args),
}));

const COMPANY = { name: 'Perdidas SAS', nit: '900123456', fiscalPeriod: '2025', entityType: 'SAS' };

function misstatementJson(over: Partial<MisstatementReviewReportJson> = {}): MisstatementReviewReportJson {
  return {
    materiality: { benchmark: '5% UAI', baseAmount: 1_000_000, materialityThreshold: 50_000, performanceMateriality: 37_500, trivialThreshold: 2_500 },
    misstatements: [
      { code: 'MIS-001', type: 'factual', description: 'Gasto no causado', amount: 80_000, corrected: false, affectedArea: 'Gastos', normReference: 'NIA 450' },
    ],
    totalUncorrected: 1,
    materialInAggregate: false,
    assessment: 'immaterial',
    analysis: 'a',
    ...over,
  };
}

beforeEach(() => {
  callMock.mockReset();
});

describe('Evaluadores fallidos (tributario-modulos-11)', () => {
  it('con los tres evaluadores caídos el dictamen queda BLOQUEADO y nada se declara limpio', async () => {
    callMock.mockImplementation(async () => {
      throw new Error('timeout');
    });
    const { orchestrateFiscalOpinion } = await import('../orchestrator');
    const res = await orchestrateFiscalOpinion({
      report: { company: COMPANY, consolidatedReport: 'Informe' } as never,
      language: 'es',
    });
    expect(res.dictamen.opinionType).toBe('no_emitida');
    expect(res.evaluatorsFailed).toEqual(['empresa_en_marcha', 'incorrecciones', 'cumplimiento']);
    expect(res.goingConcern.conclusion).toBe('no_evaluado');
    expect(res.misstatementReview.assessment).toBe('no_evaluado');
    expect(res.misstatementReview.materiality.materialityThreshold).toBeNull();
    expect(res.consolidatedReport).not.toContain('LIMPIA (Sin Salvedades)');
    expect(res.consolidatedReport).not.toContain('Sin incorrecciones materiales');
    expect(res.consolidatedReport).not.toContain('Materialidad global:** $0,00');
    expect(res.consolidatedReport).toContain('Dictamen no emitido');
    // El redactor no se invoca sobre fallbacks.
    expect(callMock.mock.calls.some((c) => (c[0] as { agentName: string }).agentName === 'opinion-drafter')).toBe(false);
  });

  it('las incorrecciones no corregidas por encima de la materialidad fuerzan "material" aunque el LLM diga lo contrario', async () => {
    const { toLegacyShape } = await import('../agents/misstatement-reviewer');
    const res = toLegacyShape(misstatementJson());
    expect(res.totalUncorrected).toBe(80_000);
    expect(res.materialInAggregate).toBe(true);
    expect(res.assessment).toBe('material');
  });

  it('el redactor no puede emitir opinión limpia con incorrecciones materiales / generalizadas / base inadecuada', async () => {
    const { enforceDrafterCoherence } = await import('../agents/opinion-drafter');
    expect(
      enforceDrafterCoherence('limpia', { misstatement: { materialInAggregate: true, assessment: 'material' } as never }),
    ).toBe('con_salvedades');
    expect(enforceDrafterCoherence('con_salvedades', { misstatement: { materialInAggregate: true, assessment: 'pervasive' } as never })).toBe('adversa');
    expect(enforceDrafterCoherence('limpia', { goingConcern: { conclusion: 'base_inadecuada' } as never })).toBe('adversa');
    expect(enforceDrafterCoherence('limpia', { misstatement: { materialInAggregate: false, assessment: 'immaterial' } as never })).toBe('limpia');
  });
});

describe('SAGRILAFT (prompts-normativa-02)', () => {
  it('el umbral general es 40.000 SMMLV (CE 100-000016/2020), no 160.000 UVT', async () => {
    const { evaluateSagrilaft, SAGRILAFT_FUENTE } = await import('../sagrilaft');
    // Balance con corte 2026: SMMLV 2026 del repo (NM-15: el SMMLV sale del año del corte).
    const ev = evaluateSagrilaft({ activosCop: 20_000_000_000, ingresosCop: 10_000_000_000, anioCorte: 2026 });
    expect(ev.umbralCop).toBe(70_036_200_000);
    expect(ev.superaUmbralGeneral).toBe(false);
    expect(ev.obligada).toBe('no_determinable');
    expect(SAGRILAFT_FUENTE).toContain('100-000016 de 2020');
    expect(evaluateSagrilaft({ activosCop: null, ingresosCop: null }).superaUmbralGeneral).toBeNull();
  });

  it('el prompt ya no fija 160.000 UVT / $8.379.840.000 ni ordena "no_cumple" sin constancia de vigilancia', async () => {
    const { buildComplianceCheckerPrompt } = await import('../prompts/compliance-checker.prompt');
    const p = buildComplianceCheckerPrompt(COMPANY as never, 'es');
    expect(p).not.toContain('160.000 UVT');
    expect(p).not.toContain('8.379.840.000');
    expect(p).toContain('40.000 SMMLV');
    expect(p).toContain('NEVER "no_cumple"');
  });

  it('un ítem SAGRILAFT en "no_cumple" pasa a "no_evaluado" y sale de los incumplimientos', async () => {
    const { applySagrilaftOverride } = await import('../agents/compliance-checker');
    const { evaluateSagrilaft } = await import('../sagrilaft');
    const item = {
      code: 'COMP-001', area: 'SAGRILAFT', requirement: 'Sistema de autocontrol LA/FT', status: 'no_cumple' as const,
      normReference: 'Circular Externa 100-000016 SuperSociedades', observation: 'Supera umbral sin evidencia.',
    };
    const json: ComplianceCheckReportJson = {
      statutoryFunctions: [], regulatoryItems: [item], independenceAssessment: 'i', nonComplianceItems: [item],
      complianceScore: 50, analysis: 'a',
    };
    const out = applySagrilaftOverride(json, evaluateSagrilaft({ activosCop: 9_000_000_000, ingresosCop: null }));
    expect(out.regulatoryItems[0].status).toBe('no_evaluado');
    expect(out.nonComplianceItems).toHaveLength(0);
  });
});

describe('NIA 570 / 701 y causales derogadas (prompts-normativa-20)', () => {
  it('opinion drafter: KAM sólo cuando aplican, sección separada de empresa en marcha, sin NIC 1 par. 43 como excepción', async () => {
    const { buildOpinionDrafterPrompt } = await import('../prompts/opinion-drafter.prompt');
    const p = buildOpinionDrafterPrompt(COMPANY as never, 'es', { comparativosImpracticables: true });
    expect(p).not.toContain('keyAuditMatters tiene entre 1 y 3 entradas');
    expect(p).not.toContain('minimo 1, maximo 3');
    expect(p).toContain('Incertidumbre material relacionada con empresa en funcionamiento');
    expect(p).not.toContain('citando NIC 1 par. 43 (excepcion por impracticabilidad)');
    expect(p).not.toMatch(/con_salvedades si hay incorrecciones materiales no generalizadas o incertidumbre revelada/);
  });

  it('going concern: sin causal del Art. 457 C.Co. ni duda automática por un indicador', async () => {
    const { buildGoingConcernPrompt } = await import('../prompts/going-concern.prompt');
    const p = buildGoingConcernPrompt(COMPANY as never, 'es');
    expect(p).not.toContain('Art. 457 C.Co.: causal de disolucion');
    expect(p).not.toContain('If patrimonio neto < 50% del capital suscrito then assessment = doubt');
    expect(p).toContain('Ley 2069/2020 Art. 4');
    expect(p).toContain('par. 16');
  });

  it('la sección de incertidumbre material del redactor llega al informe consolidado', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      switch (args.agentName) {
        case 'going-concern':
          return { json: { assessment: 'doubt', conclusion: 'incertidumbre_material', indicators: [], recommendedDisclosures: [], analysis: 'a' }, meta: {} };
        case 'misstatement-reviewer':
          return { json: misstatementJson({ misstatements: [], materialInAggregate: false }), meta: {} };
        case 'compliance-checker':
          return { json: { statutoryFunctions: [], regulatoryItems: [], independenceAssessment: 'i', nonComplianceItems: [], complianceScore: 90, analysis: 'a' }, meta: {} };
        default:
          return {
            json: {
              opinionType: 'limpia', dictamenText: 'Dictamen.', keyAuditMatters: [], emphasisParagraphs: [], otherMatterParagraphs: [],
              managementLetter: 'Carta.', goingConcernSection: 'Llamamos la atención sobre la Nota 2: incertidumbre material.',
            },
            meta: {},
          };
      }
    });
    const { orchestrateFiscalOpinion } = await import('../orchestrator');
    const res = await orchestrateFiscalOpinion({ report: { company: COMPANY, consolidatedReport: 'Informe' } as never, language: 'es' });
    expect(res.dictamen.opinionType).toBe('limpia');
    expect(res.consolidatedReport).toContain('INCERTIDUMBRE MATERIAL RELACIONADA CON EMPRESA EN FUNCIONAMIENTO');
  });
});

// ---------------------------------------------------------------------------
// Precios de transferencia — el ajuste en COP no sale del modelo
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (pendiente #8): con el PLI fuera del
// rango, `requiredAdjustmentCop` (y el ajuste por operación y del Formato 1125)
// conservaba la cifra del LLM rotulada como «estimación del modelo». El
// contrato no trae la base del PLI en COP por operación (el denominador del
// indicador), así que el código no puede calcular (mediana − observado) × base:
// el ajuste es N/D con motivo y las notas del modelo que citan montos se
// sustituyen por ese motivo. Dentro del rango el ajuste es $0.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llmOutputs: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (!(opts.agentName in llmOutputs)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llmOutputs[opts.agentName]), meta: {} };
  }),
}));

import { ComparableAnalysisReportSchema, TpDocumentationReportSchema } from '../../contracts/transfer-pricing';
import { computeTpRangeCheck, enforceComparableAnalysis, TP_AJUSTE_COP_SIN_BASE_MOTIVO } from '../lib/deterministic';
import { runComparableAnalyst } from '../agents/comparable-analyst';
import { enforceTpDocumentation, runTPDocumentationWriter } from '../agents/tp-documentation-writer';
import type { CompanyInfo } from '../../types';
import type { TPAnalysisResult } from '../types';

const company: CompanyInfo = { name: 'Filial SAS', nit: '900123456-1', fiscalPeriod: '2025' };
const companyJson = {
  name: 'Filial SAS', nit: '900123456-1', entityType: 'SAS', sector: null, niifGroup: 2,
  fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
};
const tpPrev: TPAnalysisResult = {
  taxYear: 2025,
  obligationAssessment: 'x', transactionCharacterization: 'x', functionalAnalysis: 'x',
  methodSelection: 'x', preliminaryPricingAnalysis: 'x', fullContent: 'analisis',
};

function comparable(name: string, pli: number) {
  return {
    name, jurisdiction: 'CO', source: 'SIREM', activityDescription: 'distribución', pliPercent: pli,
    comparabilityQuality: 'media', adjustmentsApplied: [], inclusionRationale: 'x', isSimulated: false,
  };
}

function comparableJson(observed: number) {
  return {
    company: companyJson,
    searchStrategy: { sectorCodes: ['4690'], geographicScope: ['CO'], timeWindow: '2023-2025', exclusionFilters: [], rationale: 'x' },
    comparabilityFactors: [],
    selectedComparables: [comparable('A', 4), comparable('B', 5), comparable('C', 6), comparable('D', 7), comparable('E', 8)],
    interquartileRange: { min: 0, q1: 1, median: 2, q3: 99, max: 100, observedPliPercent: observed, isWithinRange: true },
    adjustments: [],
    // Cifra inventada por el «modelo» sin base del PLI en COP.
    armLengthConclusion: {
      complies: false, requiredAdjustmentCop: '777777700', requiredAdjustmentPercent: 9,
      taxImpactNote: 'Mayor renta gravable de $7.777.777 e impuesto de $2.722.222.', rationale: 'No cumple.',
    },
    citations: [],
    technicalNotes: [],
  };
}

function docJson() {
  return {
    company: companyJson,
    executiveSummary: { objective: 'x', period: '2025', transactionsOverview: 'x', methodsApplied: ['MNT'], overallComplianceConclusion: 'no_cumple', keyRisks: [], keyRecommendations: [] },
    localFile: { taxpayerInfo: 'x', industryDescription: 'x', transactionsDetail: 'x', functionalAnalysisDetail: 'x', economicAnalysisDetail: 'x',
      conclusionsByOperation: [{ transactionDescription: 'Compra', complies: false, requiredAdjustmentCop: '555555500', fiscalImpactNote: 'Ajuste de $5.555.555.' }] },
    masterFile: { groupOrganizationalStructure: 'x', groupBusinessDescription: 'x', groupIntangibles: 'x', intercompanyFinancialActivities: 'x', groupFinancialAndTaxPositions: 'x' },
    formato1125Rows: [{ operationCode: '01', relatedPartyName: 'Matriz Inc', relatedPartyTaxId: 'US-1', countryCode: 'US', amountCop: '100', methodCode: 5,
      observedPliPercent: 2, q1Percent: 1, medianPercent: 2, q3Percent: 99, isWithinRange: true, adjustmentCop: '333333300', remarks: null }],
    potentialSanctions: [],
    recommendations: [],
    art647Defense: { applies: false, rationale: 'x' },
    citations: [],
  };
}

beforeEach(() => {
  for (const k of Object.keys(llmOutputs)) delete llmOutputs[k];
});

describe('PT — ajuste en COP sin base determinista', () => {
  it('el esquema admite ajuste N/D (null) en la conclusión, por operación y en el 1125', () => {
    const c = comparableJson(2);
    c.armLengthConclusion.requiredAdjustmentCop = null as unknown as string;
    expect(ComparableAnalysisReportSchema.safeParse(c).success).toBe(true);
    const d = docJson();
    d.localFile.conclusionsByOperation[0].requiredAdjustmentCop = null as unknown as string;
    d.formato1125Rows[0].adjustmentCop = null as unknown as string;
    expect(TpDocumentationReportSchema.safeParse(d).success).toBe(true);
  });

  it('fuera del rango: ajuste COP null con motivo; el % es el determinista', () => {
    const json = ComparableAnalysisReportSchema.parse(comparableJson(2));
    const check = computeTpRangeCheck(json);
    const out = enforceComparableAnalysis(json, check);
    expect(check.isWithinRange).toBe(false);
    expect(out.armLengthConclusion.requiredAdjustmentCop).toBeNull();
    expect(out.armLengthConclusion.requiredAdjustmentPercent).toBe(4);
    expect(out.armLengthConclusion.taxImpactNote).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO);
  });

  it('sin PLI observado el % tampoco se convierte en 0', () => {
    const raw = comparableJson(2);
    (raw.interquartileRange as { observedPliPercent: number | null }).observedPliPercent = null;
    const json = ComparableAnalysisReportSchema.parse(raw);
    const out = enforceComparableAnalysis(json, computeTpRangeCheck(json));
    expect(out.armLengthConclusion.requiredAdjustmentPercent).toBeNull();
    expect(out.armLengthConclusion.requiredAdjustmentCop).toBeNull();
  });

  it('dentro del rango el ajuste es $0', () => {
    const json = ComparableAnalysisReportSchema.parse(comparableJson(6));
    const out = enforceComparableAnalysis(json, computeTpRangeCheck(json));
    expect(out.armLengthConclusion.requiredAdjustmentCop).toBe('0');
  });

  it('el informe no publica la cifra del modelo (Agente 2 y Agente 3)', async () => {
    llmOutputs['comparable-analyst'] = comparableJson(2);
    const comp = await runComparableAnalyst(tpPrev, company, 'es');
    expect(comp.armLengthConclusion).not.toContain('7.777.777');
    expect(comp.armLengthConclusion).toMatch(/N\/D/);

    llmOutputs['tp-documentation-writer'] = docJson();
    const r = await runTPDocumentationWriter(tpPrev, comp, company, 'es');
    expect(r.localReport).not.toContain('5.555.555');
    expect(r.formato1125Guide).not.toContain('3.333.333');
    expect(r.localReport).toMatch(/Ajuste: N\/D/);
    const doc = enforceTpDocumentation(TpDocumentationReportSchema.parse(docJson()), comp.rangeCheck);
    expect(doc.localFile.conclusionsByOperation[0].requiredAdjustmentCop).toBeNull();
    expect(doc.formato1125Rows[0].adjustmentCop).toBeNull();
  });
});

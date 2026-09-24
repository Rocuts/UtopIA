// ---------------------------------------------------------------------------
// Precios de transferencia — motivos deterministas en el idioma del informe
// ---------------------------------------------------------------------------
// TP_AJUSTE_COP_SIN_BASE_MOTIVO (ajuste en COP N/D sin base del PLI) y el
// motivo del escenario ilustrativo de computeTpRangeCheck sólo existían en
// español: un informe pedido en inglés los imprimía en español bajo rótulos
// en inglés. Ahora el código los escribe en es/en según `language`.
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
import {
  computeTpRangeCheck,
  enforceComparableAnalysis,
  notaSinMontosDelModelo,
  tpAjusteCopSinBaseMotivo,
  tpMotivoRango,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN,
} from '../lib/deterministic';
import { runComparableAnalyst } from '../agents/comparable-analyst';
import { enforceTpDocumentation } from '../agents/tp-documentation-writer';
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

function comparable(name: string, pli: number, isSimulated = false) {
  return {
    name, jurisdiction: 'CO', source: 'SIREM', activityDescription: 'distribución', pliPercent: pli,
    comparabilityQuality: 'media', adjustmentsApplied: [], inclusionRationale: 'x', isSimulated,
  };
}

function comparableJson(observed: number, simulated = false) {
  return {
    company: companyJson,
    searchStrategy: { sectorCodes: ['4690'], geographicScope: ['CO'], timeWindow: '2023-2025', exclusionFilters: [], rationale: 'x' },
    comparabilityFactors: [],
    selectedComparables: [comparable('A', 4, simulated), comparable('B', 5), comparable('C', 6), comparable('D', 7), comparable('E', 8)],
    interquartileRange: { min: 0, q1: 1, median: 2, q3: 99, max: 100, observedPliPercent: observed, isWithinRange: true },
    adjustments: [],
    armLengthConclusion: {
      complies: false, requiredAdjustmentCop: '777777700', requiredAdjustmentPercent: 9,
      taxImpactNote: 'Higher taxable income of $7,777,777 and tax of $2,722,222.', rationale: 'Does not comply.',
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
      conclusionsByOperation: [{ transactionDescription: 'Purchase', complies: false, requiredAdjustmentCop: '555555500', fiscalImpactNote: null }] },
    masterFile: { groupOrganizationalStructure: 'x', groupBusinessDescription: 'x', groupIntangibles: 'x', intercompanyFinancialActivities: 'x', groupFinancialAndTaxPositions: 'x' },
    formato1125Rows: [{ operationCode: '01', relatedPartyName: 'Parent Inc', relatedPartyTaxId: 'US-1', countryCode: 'US', amountCop: '100', methodCode: 5,
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

describe('PT — motivo del ajuste en COP N/D según idioma', () => {
  it('es/en: dos textos distintos, cada uno en su idioma', () => {
    expect(tpAjusteCopSinBaseMotivo('es')).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO);
    expect(tpAjusteCopSinBaseMotivo('en')).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN);
    expect(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN).toMatch(/COP adjustment not determinable/);
    expect(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN).not.toMatch(/análisis|determinable: el/);
  });

  it('una nota en inglés con montos también se sustituye (y por el motivo en inglés)', () => {
    expect(notaSinMontosDelModelo('Adjustment of USD 2 million and $7,777,777', null, 'en')).toBe(
      TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN,
    );
    expect(notaSinMontosDelModelo(null, null, 'en')).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN);
    expect(notaSinMontosDelModelo('Sin impacto material.', null, 'en')).toBe('Sin impacto material.');
  });

  it('enforceComparableAnalysis en inglés escribe el motivo en inglés; en español por defecto', () => {
    const json = ComparableAnalysisReportSchema.parse(comparableJson(2));
    const check = computeTpRangeCheck(json);
    expect(enforceComparableAnalysis(json, check, 'en').armLengthConclusion.taxImpactNote).toBe(
      TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN,
    );
    expect(enforceComparableAnalysis(json, check).armLengthConclusion.taxImpactNote).toBe(
      TP_AJUSTE_COP_SIN_BASE_MOTIVO,
    );
  });

  it('el escenario ilustrativo también se explica en el idioma pedido', () => {
    const json = ComparableAnalysisReportSchema.parse(comparableJson(2, true));
    const check = computeTpRangeCheck(json);
    expect(check.conclusive).toBe(false);
    expect(tpMotivoRango(check, 'es')).toMatch(/Escenario ilustrativo, no concluyente: 1 de 5 comparables son simulados/);
    expect(tpMotivoRango(check, 'en')).toMatch(/Illustrative scenario, not conclusive: 1 of 5 comparables are simulated/);
  });

  it('Agente 2 y Agente 3 en inglés no imprimen los motivos en español', async () => {
    llmOutputs['comparable-analyst'] = comparableJson(2, true);
    const comp = await runComparableAnalyst(tpPrev, company, 'en');
    expect(comp.armLengthConclusion).toContain(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN);
    expect(comp.armLengthConclusion).not.toContain(TP_AJUSTE_COP_SIN_BASE_MOTIVO);
    expect(comp.armLengthConclusion).toMatch(/Illustrative scenario, not conclusive/);
    expect(comp.armLengthConclusion).not.toMatch(/Escenario ilustrativo/);

    const doc = enforceTpDocumentation(TpDocumentationReportSchema.parse(docJson()), comp.rangeCheck, 'en');
    expect(doc.localFile.conclusionsByOperation[0].fiscalImpactNote).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN);
    expect(doc.formato1125Rows[0].remarks).toMatch(/^ILLUSTRATIVE — do not file: Illustrative scenario/);
  });
});

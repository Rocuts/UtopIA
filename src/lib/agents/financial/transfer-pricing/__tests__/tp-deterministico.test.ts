// ---------------------------------------------------------------------------
// Precios de transferencia — cifras deterministas sobre la salida del LLM
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-09: umbrales 260-5/260-9 con la UVT del año gravable
//     (AG 2025 ⇒ UVT $49.799), no con UVT 2026 fija; booleanos y conclusión
//     recalculados; año no registrado ⇒ error explícito.
//   - tributario-modulos-10: rango intercuartil (DUR 1625/2016 art.
//     1.2.2.2.5), «dentro del rango» y «CUMPLE» recalculados; con comparables
//     simulados la conclusión es un escenario ilustrativo.
//   - tributario-modulos-17: topes del Art. 260-11 desde la tabla literal.
// El LLM se simula con salidas manipuladas.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llmOutputs: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (!(opts.agentName in llmOutputs)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llmOutputs[opts.agentName]), meta: {} };
  }),
}));

import {
  interquartileRangeDur1625,
  taxYearFromFiscalPeriod,
  tpObligationThresholds,
} from '../lib/deterministic';
import { runTPAnalyst } from '../agents/tp-analyst';
import { runComparableAnalyst } from '../agents/comparable-analyst';
import { runTPDocumentationWriter } from '../agents/tp-documentation-writer';
import type { CompanyInfo } from '../../types';
import type { TPAnalysisResult } from '../types';

const company: CompanyInfo = { name: 'Filial SAS', nit: '900123456-1', fiscalPeriod: '2025' };
const companyJson = {
  name: 'Filial SAS', nit: '900123456-1', entityType: 'SAS', sector: null, niifGroup: 2,
  fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
};

beforeEach(() => {
  for (const k of Object.keys(llmOutputs)) delete llmOutputs[k];
});

describe('umbrales de obligatoriedad por año gravable (Arts. 260-5 / 260-9)', () => {
  it('AG 2025 usa UVT 2025: $4.979.900.000 y $3.037.739.000', () => {
    const t = tpObligationThresholds(2025);
    expect(t.grossEquityThresholdCents).toBe('497990000000');
    expect(t.grossIncomeThresholdCents).toBe('303773900000');
  });

  it('AG 2026 usa UVT 2026: $5.237.400.000 y $3.194.814.000', () => {
    const t = tpObligationThresholds(2026);
    expect(t.grossEquityThresholdCents).toBe('523740000000');
    expect(t.grossIncomeThresholdCents).toBe('319481400000');
  });

  it('año sin UVT registrada o periodo sin año ⇒ error explícito', () => {
    expect(() => tpObligationThresholds(2031)).toThrow(/UVT oficial no configurada para 2031/);
    expect(() => taxYearFromFiscalPeriod('actual')).toThrow(/año gravable/);
  });

  it('el LLM dice NO OBLIGADO con patrimonio $5.100M en AG 2025 ⇒ se recalcula OBLIGADO', async () => {
    llmOutputs['tp-analyst'] = {
      company: companyJson,
      obligation: {
        isObligated: false,
        grossEquityCop: '510000000000', // $5.100M
        grossEquityThresholdCop: '523740000000', // UVT 2026 fija
        grossEquityMeetsThreshold: false,
        grossIncomeCop: '100000000000',
        grossIncomeThresholdCop: '319481400000',
        grossIncomeMeetsThreshold: false,
        hasTaxHavenTransactions: false,
        rationale: 'No supera 100.000 UVT (UVT 2026).',
      },
      relatedParties: [{ name: 'Matriz Inc', taxId: 'US-1', jurisdiction: 'EE.UU.', relationshipType: 'matriz', isTaxHaven: false }],
      controlledTransactions: [{ description: 'Compra de inventario', type: 'bienes', direction: 'importacion', amountCop: '200000000000', relatedPartyName: 'Matriz Inc', contractualNotes: null }],
      functionalAnalysis: [],
      methodSelection: { selectedMethod: 'MNT', testedParty: 'contribuyente', profitLevelIndicator: 'margen operacional', discardedMethods: [], justification: 'x' },
      preliminaryPricing: { observedPliPercent: 3, riskFlags: [], requiresMedianAdjustment: false },
      citations: [],
      technicalNotes: [],
    };
    const r = await runTPAnalyst('datos', company, 'es');
    expect(r.taxYear).toBe(2025);
    expect(r.obligationAssessment).toMatch(/\*\*Conclusión:\*\* OBLIGADO/);
    expect(r.obligationAssessment).toContain('$4.979.900.000');
    expect(r.obligationAssessment).not.toContain('$5.237.400.000');
  });

  it('periodo 2031 falla ANTES de llamar al LLM', async () => {
    await expect(runTPAnalyst('datos', { ...company, fiscalPeriod: '2031' }, 'es')).rejects.toThrow(/2031/);
  });
});

describe('rango intercuartil — DUR 1625/2016 art. 1.2.2.2.5', () => {
  it('n impar: posiciones exactas', () => {
    expect(interquartileRangeDur1625([5, 1, 4, 2, 3])).toEqual({ n: 5, min: 1, q1: 2, median: 3, q3: 4, max: 5 });
  });

  it('n par: interpolación de la parte decimal de la posición', () => {
    // mediana pos 3,5; P25 pos 2,25; P75 pos (3,5 − 1) + 2,25 = 4,75
    expect(interquartileRangeDur1625([1, 2, 3, 4, 5, 6])).toEqual({ n: 6, min: 1, q1: 2.25, median: 3.5, q3: 4.75, max: 6 });
    // mediana pos 2,5; P25 pos 1,75; P75 pos 3,25
    expect(interquartileRangeDur1625([40, 10, 30, 20])).toEqual({ n: 4, min: 10, q1: 17.5, median: 25, q3: 32.5, max: 40 });
  });

  it('sin comparables ⇒ null', () => {
    expect(interquartileRangeDur1625([])).toBeNull();
  });
});

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

function comparableJson(comparables: ReturnType<typeof comparable>[], observed: number | null) {
  return {
    company: companyJson,
    searchStrategy: { sectorCodes: ['4690'], geographicScope: ['CO'], timeWindow: '2023-2025', exclusionFilters: [], rationale: 'x' },
    comparabilityFactors: [],
    selectedComparables: comparables,
    // Rango y conclusión manipulados por el «modelo».
    interquartileRange: { min: 0, q1: 1, median: 2, q3: 99, max: 100, observedPliPercent: observed, isWithinRange: true },
    adjustments: [],
    armLengthConclusion: { complies: true, requiredAdjustmentCop: '0', requiredAdjustmentPercent: 0, taxImpactNote: null, rationale: 'Cumple.' },
    citations: [],
    technicalNotes: [],
  };
}

describe('Agente 2 — el rango y la conclusión se recalculan desde los comparables', () => {
  it('PLI observado fuera de Q1-Q3 con comparables reales ⇒ NO CUMPLE y ajuste a la mediana', async () => {
    llmOutputs['comparable-analyst'] = comparableJson(
      [comparable('A', 4), comparable('B', 5), comparable('C', 6), comparable('D', 7), comparable('E', 8)],
      2,
    );
    const r = await runComparableAnalyst(tpPrev, company, 'es');
    expect(r.rangeCheck.stats).toMatchObject({ q1: 5, median: 6, q3: 7 });
    expect(r.rangeCheck.isWithinRange).toBe(false);
    expect(r.rangeCheck.requiredAdjustmentPercent).toBe(4);
    expect(r.armLengthConclusion).toMatch(/NO CUMPLE/);
    expect(r.interquartileRange).toContain('| Q3 (P75) | 7.00% |');
  });

  it('con un comparable simulado la conclusión es escenario ilustrativo, nunca CUMPLE', async () => {
    llmOutputs['comparable-analyst'] = comparableJson(
      [comparable('A', 4), comparable('B', 5), comparable('C', 6, true), comparable('D', 7)],
      5.5,
    );
    const r = await runComparableAnalyst(tpPrev, company, 'es');
    expect(r.rangeCheck.conclusive).toBe(false);
    expect(r.armLengthConclusion).toMatch(/NO CONCLUYENTE \(escenario ilustrativo\)/);
    expect(r.armLengthConclusion).not.toMatch(/\*\* CUMPLE/);
  });
});

describe('Agente 3 — Formato 1125 y sanciones deterministas', () => {
  it('sobrescribe Q1/mediana/Q3 de las filas y aplica la tabla del Art. 260-11', async () => {
    llmOutputs['comparable-analyst'] = comparableJson(
      [comparable('A', 4), comparable('B', 5), comparable('C', 6, true), comparable('D', 7)],
      5.5,
    );
    const comp = await runComparableAnalyst(tpPrev, company, 'es');
    llmOutputs['tp-documentation-writer'] = {
      company: companyJson,
      executiveSummary: { objective: 'x', period: '2025', transactionsOverview: 'x', methodsApplied: ['MNT'], overallComplianceConclusion: 'cumple', keyRisks: [], keyRecommendations: [] },
      localFile: { taxpayerInfo: 'x', industryDescription: 'x', transactionsDetail: 'x', functionalAnalysisDetail: 'x', economicAnalysisDetail: 'x',
        conclusionsByOperation: [{ transactionDescription: 'Compra', complies: true, requiredAdjustmentCop: '0', fiscalImpactNote: null }] },
      masterFile: { groupOrganizationalStructure: 'x', groupBusinessDescription: 'x', groupIntangibles: 'x', intercompanyFinancialActivities: 'x', groupFinancialAndTaxPositions: 'x' },
      formato1125Rows: [{ operationCode: '01', relatedPartyName: 'Matriz Inc', relatedPartyTaxId: 'US-1', countryCode: 'US', amountCop: '100', methodCode: 5,
        observedPliPercent: 5.5, q1Percent: 1, medianPercent: 2, q3Percent: 99, isWithinRange: true, adjustmentCop: '0', remarks: null }],
      potentialSanctions: [{ scenario: 'no_documentacion', maximumUvt: 20000, maximumCop: '104748000000', description: 'hasta 20.000 UVT' }],
      recommendations: [],
      art647Defense: { applies: false, rationale: 'x' },
      citations: [],
    };
    const r = await runTPDocumentationWriter(tpPrev, comp, company, 'es');
    // Rango del 1125 = cálculo determinista, no el del modelo.
    expect(r.formato1125Guide).toContain('4.75%'); // Q1 de [4,5,6,7] = pos 1,75 → 4,75
    expect(r.formato1125Guide).not.toContain('99.00%');
    expect(r.formato1125Guide).toMatch(/ILUSTRATIVA — no presentar/);
    expect(r.executiveSummary).toMatch(/NO CONCLUYENTE/);
    expect(r.localReport).not.toMatch(/— CUMPLE/);
    // Art. 260-11 lit. A.3.a: 4%, tope 25.000 UVT (no 20.000); COP con UVT 2026 (presentación).
    expect(r.conclusions).toContain('| A.3.a |');
    expect(r.conclusions).toContain('25.000');
    expect(r.conclusions).toContain('$1.309.350.000');
    expect(r.conclusions).not.toContain('hasta 20.000 UVT');
  });
});

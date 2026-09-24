// ---------------------------------------------------------------------------
// Precios de transferencia — montos del ajuste en el texto libre del modelo
// (I4-escudo 7)
// ---------------------------------------------------------------------------
// Con el ajuste en COP N/D (no hay base del PLI en COP por operación), sólo
// `taxImpactNote` / `fiscalImpactNote` se filtraban. Los demás textos libres
// que hablan del ajuste —`armLengthConclusion.rationale`, las notas técnicas
// del Agente 2 y, en el Agente 3, el análisis económico, los riesgos y
// recomendaciones, las observaciones del Formato 1125 y la defensa del
// Art. 647— seguían publicando la cifra que inventó el modelo como si la
// hubiera calculado el código. Se retira cada FRASE que menciona el ajuste o
// su impacto fiscal con un monto, y se añade una sola vez el motivo; el resto
// del texto (y los montos de las operaciones, que no son el ajuste) se
// conserva. Dentro del rango (ajuste "0" determinista) el texto no se toca.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { ComparableAnalysisReportJson, TpDocumentationReportJson } from '../../contracts/transfer-pricing';
import {
  computeTpRangeCheck,
  enforceComparableAnalysis,
  textoSinMontosDeAjuste,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN,
} from '../lib/deterministic';
import { enforceTpDocumentation } from '../agents/tp-documentation-writer';

const companyJson = {
  name: 'Filial SAS', nit: '900123456-1', entityType: 'SAS', sector: null, niifGroup: 2,
  fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
};

function comparable(name: string, pli: number) {
  return {
    name, jurisdiction: 'CO', source: 'SIREM', activityDescription: 'distribución', pliPercent: pli,
    comparabilityQuality: 'media', adjustmentsApplied: [], inclusionRationale: 'x', isSimulated: false,
  };
}

const INVENTADO = 'Se requiere un ajuste de $150.000.000 a la mediana conforme al Art. 260-4 E.T.';

function comparableJson(observed: number): ComparableAnalysisReportJson {
  return {
    company: companyJson,
    searchStrategy: { sectorCodes: ['4690'], geographicScope: ['CO'], timeWindow: '2023-2025', exclusionFilters: [], rationale: 'x' },
    comparabilityFactors: [],
    selectedComparables: [comparable('A', 4), comparable('B', 5), comparable('C', 6), comparable('D', 7), comparable('E', 8)],
    interquartileRange: { min: 0, q1: 1, median: 2, q3: 99, max: 100, observedPliPercent: observed, isWithinRange: true },
    adjustments: [],
    armLengthConclusion: {
      complies: false, requiredAdjustmentCop: '777777700', requiredAdjustmentPercent: 9,
      taxImpactNote: null,
      rationale: `El margen observado queda por debajo del rango intercuartil. ${INVENTADO} El método aplicado es el MMNT.`,
    },
    citations: [],
    technicalNotes: [
      'La muestra usa 5 comparables de SIREM.',
      'El impacto fiscal estimado es una mayor renta gravable de 150 millones.',
    ],
  } as unknown as ComparableAnalysisReportJson;
}

function docJson(): TpDocumentationReportJson {
  return {
    company: companyJson,
    executiveSummary: {
      objective: 'x', period: '2025',
      transactionsOverview: 'Compras a la matriz por $2.000.000.000 en 2025.',
      methodsApplied: ['MNT'], overallComplianceConclusion: 'no_cumple',
      keyRisks: ['Ajuste de USD 250,000 a la base gravable.', 'Documentación incompleta de los comparables.'],
      keyRecommendations: ['Reconocer un mayor impuesto de 52.500.000 pesos.'],
    },
    localFile: {
      taxpayerInfo: 'x', industryDescription: 'x',
      transactionsDetail: 'Compra de inventario a la matriz por $2.000.000.000 (operación 01).',
      functionalAnalysisDetail: 'x',
      economicAnalysisDetail: 'Se aplicó el MMNT sobre el margen operativo. El ajuste a la mediana asciende a $150.000.000.',
      conclusionsByOperation: [{ transactionDescription: 'Compra', complies: false, requiredAdjustmentCop: '555555500', fiscalImpactNote: null }],
    },
    masterFile: { groupOrganizationalStructure: 'x', groupBusinessDescription: 'x', groupIntangibles: 'x', intercompanyFinancialActivities: 'x', groupFinancialAndTaxPositions: 'x' },
    formato1125Rows: [{ operationCode: '01', relatedPartyName: 'Matriz Inc', relatedPartyTaxId: 'US-1', countryCode: 'US', amountCop: '100', methodCode: 5,
      observedPliPercent: 20, q1Percent: 1, medianPercent: 2, q3Percent: 99, isWithinRange: true, adjustmentCop: '333333300',
      remarks: 'Ajuste de $150.000.000 a declarar.' }],
    potentialSanctions: [],
    recommendations: [{ title: 'Ajustar', detail: 'Declarar el ajuste de 150 MM en la renta del año.', norm: null }],
    art647Defense: { applies: true, rationale: 'La diferencia de criterio cubre el ajuste de $150.000.000.' },
    citations: [],
  } as unknown as TpDocumentationReportJson;
}

const MONTO = /\$\s?\d|\d\s?(?:COP|USD|pesos|MM|millones)\b|USD\s?\d/;

describe('textoSinMontosDeAjuste', () => {
  it('retira sólo la frase del ajuste con monto y añade el motivo una vez', () => {
    const t = `Primera frase sin cifras. ${INVENTADO} Última frase.`;
    const r = textoSinMontosDeAjuste(t, null, 'es');
    expect(r).not.toContain('150.000.000');
    expect(r).toContain('Primera frase sin cifras.');
    expect(r).toContain('Última frase.');
    // «Art. 260-4 E.T.» no parte la frase: no queda un resto suelto.
    expect(r).not.toMatch(/260-4/);
    expect(r.split(TP_AJUSTE_COP_SIN_BASE_MOTIVO).length - 1).toBe(1);
  });

  it('en inglés usa el motivo en inglés', () => {
    const r = textoSinMontosDeAjuste('The required adjustment is USD 250,000.', null, 'en');
    expect(r).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN);
  });

  it('conserva montos que no son del ajuste y textos sin montos', () => {
    const t = 'Compras a la matriz por $2.000.000.000 en 2025.';
    expect(textoSinMontosDeAjuste(t, null, 'es')).toBe(t);
    const s = 'Ajuste de 2,3 puntos porcentuales sobre el margen operativo.';
    expect(textoSinMontosDeAjuste(s, null, 'es')).toBe(s);
  });

  it('con ajuste determinista ("0") no toca el texto; es idempotente', () => {
    expect(textoSinMontosDeAjuste(INVENTADO, '0', 'es')).toBe(INVENTADO);
    const una = textoSinMontosDeAjuste(INVENTADO, null, 'es');
    expect(textoSinMontosDeAjuste(una, null, 'es')).toBe(una);
  });
});

describe('Agente 2 — conclusión de plena competencia fuera del rango', () => {
  it('rationale y notas técnicas sin el monto inventado del ajuste', () => {
    const json = comparableJson(20); // fuera del rango ⇒ ajuste COP N/D
    const check = computeTpRangeCheck(json);
    expect(check.isWithinRange).toBe(false);
    const out = enforceComparableAnalysis(json, check, 'es');
    expect(out.armLengthConclusion.requiredAdjustmentCop).toBeNull();
    expect(out.armLengthConclusion.rationale).not.toContain('150.000.000');
    expect(out.armLengthConclusion.rationale).toContain('por debajo del rango intercuartil');
    expect(out.armLengthConclusion.rationale).toContain('MMNT');
    expect(out.technicalNotes.join(' ')).not.toMatch(/150 millones/);
    expect(out.technicalNotes).toContain('La muestra usa 5 comparables de SIREM.');
  });

  it('dentro del rango el texto del modelo se conserva', () => {
    const json = comparableJson(6);
    const out = enforceComparableAnalysis(json, computeTpRangeCheck(json), 'es');
    expect(out.armLengthConclusion.requiredAdjustmentCop).toBe('0');
    expect(out.armLengthConclusion.rationale).toContain('150.000.000');
  });
});

describe('Agente 3 — documentación con el ajuste N/D', () => {
  it('análisis económico, riesgos, recomendaciones, Formato 1125 y Art. 647 sin montos del ajuste', () => {
    const check = computeTpRangeCheck(comparableJson(20));
    const out = enforceTpDocumentation(docJson(), check, 'es');
    const textos = [
      out.localFile.economicAnalysisDetail,
      ...out.executiveSummary.keyRisks,
      ...out.executiveSummary.keyRecommendations,
      ...out.recommendations.map((r) => r.detail),
      out.formato1125Rows[0].remarks ?? '',
      out.art647Defense.rationale,
    ];
    for (const t of textos) expect(t, t).not.toMatch(MONTO);
    expect(out.localFile.economicAnalysisDetail).toContain('Se aplicó el MMNT');
    expect(out.executiveSummary.keyRisks).toContain('Documentación incompleta de los comparables.');
    // Los montos de las operaciones no son el ajuste: se conservan.
    expect(out.localFile.transactionsDetail).toContain('$2.000.000.000');
    expect(out.executiveSummary.transactionsOverview).toContain('$2.000.000.000');
  });
});

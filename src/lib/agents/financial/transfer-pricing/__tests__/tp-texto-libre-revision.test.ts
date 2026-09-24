// ---------------------------------------------------------------------------
// Precios de transferencia — revisión del filtro de montos del ajuste N/D
// (I4-escudo 7, revisión adversarial)
// ---------------------------------------------------------------------------
// `textoSinMontosDeAjuste` dejaba pasar montos inventados del ajuste en tres
// redacciones corrientes del modelo:
//   - un paréntesis tras «E.T.» partía la frase: «El ajuste bajo el Art. 260-4
//     E.T. ($1.200 millones)…» quedaba en dos trozos, uno con la mención del
//     ajuste y otro con el monto, y ninguno se retiraba;
//   - cifras sin símbolo de moneda: «1.250.000.000 de pesos» o «un ajuste de
//     1.250.000.000»;
//   - la cifra en la frase siguiente, retomada con un anafórico: «Se requiere
//     un ajuste a la mediana. Este asciende a $1.200.000.000.»
// Además, las posiciones fiscales del grupo del Master File no se filtraban.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { ComparableAnalysisReportJson, TpDocumentationReportJson } from '../../contracts/transfer-pricing';
import {
  computeTpRangeCheck,
  notaSinMontosDelModelo,
  textoSinMontosDeAjuste,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO,
} from '../lib/deterministic';
import { enforceTpDocumentation } from '../agents/tp-documentation-writer';

const MOTIVO = TP_AJUSTE_COP_SIN_BASE_MOTIVO;

describe('textoSinMontosDeAjuste — redacciones que filtraban el monto', () => {
  it.each([
    ['paréntesis tras «E.T.»', 'El ajuste bajo el Art. 260-4 E.T. ($1.200 millones) incrementa la renta gravable.'],
    ['cifra con «de pesos»', 'El ajuste requerido asciende a 1.250.000.000 de pesos.'],
    ['cifra sin moneda', 'Un ajuste de 1.250.000.000 aumentaría el impuesto.'],
    ['impacto sin «fiscal»', 'Impacto: $420.000.000 adicionales en renta.'],
  ])('%s: la frase se retira y queda el motivo', (_n, t) => {
    expect(textoSinMontosDeAjuste(t, null, 'es')).toBe(MOTIVO);
  });

  it('anafórico en la frase siguiente a la del ajuste: se retira esa frase', () => {
    const r = textoSinMontosDeAjuste(
      'Se requiere un ajuste a la mediana. Este asciende a $1.200.000.000. El método es el MMNT.',
      null,
      'es',
    );
    expect(r).not.toContain('1.200.000.000');
    expect(r).toContain('Se requiere un ajuste a la mediana.');
    expect(r).toContain('El método es el MMNT.');
    expect(r).toContain(MOTIVO);
  });

  it('en inglés: «This amounts to USD …» tras la frase del ajuste', () => {
    const r = textoSinMontosDeAjuste(
      'An adjustment to the median is required. This amounts to USD 400,000.',
      null,
      'en',
    );
    expect(r).not.toMatch(/400,000/);
  });

  it('no retira montos de operaciones ni un NIT, ni frases anafóricas sin ajuste previo', () => {
    for (const t of [
      'Compras a la matriz por $2.000.000.000 en 2025. Esta operación se pactó en dólares.',
      'La vinculada NIT 900.123.456-7 no requiere ajuste.',
      'La operación de venta asciende a $5.000 millones. Esta se liquida en 2026.',
    ]) {
      expect(textoSinMontosDeAjuste(t, null, 'es'), t).toBe(t);
    }
  });

  it('la nota de impacto fiscal con una cifra sin moneda también se sustituye', () => {
    expect(notaSinMontosDelModelo('Mayor renta gravable de 1.250.000.000.', null, 'es')).toBe(MOTIVO);
    expect(notaSinMontosDelModelo('Mayor renta gravable por determinar.', null, 'es')).toBe(
      'Mayor renta gravable por determinar.',
    );
  });
});

describe('Agente 3 — Master File con el ajuste N/D', () => {
  it('las posiciones fiscales del grupo no publican el monto inventado del ajuste', () => {
    const company = {
      name: 'Filial SAS', nit: '900123456-1', entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    };
    const comparable = (name: string, pli: number) => ({
      name, jurisdiction: 'CO', source: 'SIREM', activityDescription: 'x', pliPercent: pli,
      comparabilityQuality: 'media', adjustmentsApplied: [], inclusionRationale: 'x', isSimulated: false,
    });
    const check = computeTpRangeCheck({
      selectedComparables: [comparable('A', 4), comparable('B', 5), comparable('C', 6), comparable('D', 7), comparable('E', 8)],
      interquartileRange: { min: 0, q1: 1, median: 2, q3: 99, max: 100, observedPliPercent: 20, isWithinRange: true },
    } as unknown as ComparableAnalysisReportJson);
    expect(check.isWithinRange).toBe(false);
    const doc = {
      company,
      executiveSummary: {
        objective: 'x', period: '2025', transactionsOverview: 'x', methodsApplied: ['MNT'],
        overallComplianceConclusion: 'no_cumple', keyRisks: [], keyRecommendations: [],
      },
      localFile: {
        taxpayerInfo: 'x', industryDescription: 'x', transactionsDetail: 'x', functionalAnalysisDetail: 'x',
        economicAnalysisDetail: 'x', conclusionsByOperation: [],
      },
      masterFile: {
        groupOrganizationalStructure: 'x', groupBusinessDescription: 'x', groupIntangibles: 'x',
        intercompanyFinancialActivities: 'x',
        groupFinancialAndTaxPositions:
          'El grupo consolida en Estados Unidos. La filial reconocerá un ajuste de $300.000.000 en su renta.',
      },
      formato1125Rows: [],
      potentialSanctions: [],
      recommendations: [],
      art647Defense: { applies: false, rationale: 'x' },
      citations: [],
    } as unknown as TpDocumentationReportJson;
    const out = enforceTpDocumentation(doc, check, 'es');
    expect(out.masterFile.groupFinancialAndTaxPositions).not.toContain('300.000.000');
    expect(out.masterFile.groupFinancialAndTaxPositions).toContain('El grupo consolida en Estados Unidos.');
  });
});

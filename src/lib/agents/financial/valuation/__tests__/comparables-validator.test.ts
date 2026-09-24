// Regresión valoracion-13 — múltiplos: signo, aplicabilidad, estadísticas y rango en código.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const agentQueue: unknown[] = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: agentQueue.shift(), meta: {} })),
}));

import { runMarketComparables } from '@/lib/agents/financial/valuation/agents/market-comparables';
import { validateComparables } from '@/lib/agents/financial/valuation/validators/comparables-validator';
import {
  MarketComparablesReportSchema,
  type MarketComparablesReportJson,
} from '@/lib/agents/financial/contracts/valuation';

const company = { name: 'ACME SAS', nit: '900123456-7', fiscalPeriod: '2025' } as never;
const pesos = (n: number) => String(Math.round(n * 100));

function llmComps(over: Partial<MarketComparablesReportJson['impliedValuation']> = {}, evEbitdas = [5, 6, 7, 9]): MarketComparablesReportJson {
  const comps = evEbitdas.map((m, i) => ({
    name: `Rango Damodaran ${i}`, country: 'LatAm', source: 'Damodaran', sourceAsOf: '2026-01',
    revenueCop: null, ebitdaCop: pesos(-10_000_000), evEbitda: m, pe: null, pBv: null, evRevenue: 1 + i * 0.5, rationale: 'x',
  }));
  return {
    company: { name: 'ACME SAS', nit: '900123456-7', fiscalPeriod: '2025', entityType: null, sector: null, city: null, comparativePeriod: null, niifGroup: null, signatories: null } as never,
    comparableSelection: { criteria: ['CIIU'], comparables: comps, geographicNote: 'x' },
    // mediana real de [5,6,7,9] = 6,5; el LLM reporta 8,0 y media 10
    multipleStatistics: [{ multiple: 'ev_ebitda', median: 8, mean: 10, min: 5, max: 9, count: 4 }],
    impliedValuation: {
      targetRevenueCop: pesos(2_000_000_000), targetEbitdaCop: pesos(-500_000_000),
      targetNetIncomeCop: pesos(-800_000_000), targetBookValueCop: null, targetNetDebtCop: pesos(100_000_000),
      enterpriseValueMinCop: pesos(1), enterpriseValueMedianCop: pesos(2), enterpriseValueMaxCop: pesos(3),
      equityValueMinCop: pesos(1), equityValueMedianCop: pesos(2), equityValueMaxCop: pesos(3),
      primaryMultiple: 'ev_ebitda', primaryMultipleRationale: 'x',
      ...over,
    },
    adjustments: [{ type: 'illiquidity_discount', appliedPercent: 25, rationale: 'x' }],
    adjustedValueRange: { conservativeCop: pesos(3), baseCop: pesos(2), optimisticCop: pesos(1) },
    limitations: [], citations: [],
  };
}

beforeEach(() => { agentQueue.length = 0; });

describe('valoracion-13 — múltiplos validados en código', () => {
  it('EBITDA y utilidad negativos del objetivo conservan el signo; EV/EBITDA primario no aplica ⇒ N/D', async () => {
    const json = llmComps();
    expect(MarketComparablesReportSchema.safeParse(json).success).toBe(true);
    agentQueue.push(json);
    const res = await runMarketComparables('datos', company, 'es');
    expect(res.impliedValuation).toContain('- EBITDA: ($500.000.000,00)');
    expect(res.impliedValuation).toContain('- Utilidad neta: ($800.000.000,00)');
    expect(res.impliedValuation).not.toContain('- EBITDA: $500.000.000,00');
    expect(res.status).toBe('blocked');
    expect(res.computed).toBeNull();
    expect(res.impliedValuation).toContain('NO EMITIBLE');
    expect(res.multiplesAnalysis).toMatch(/\| EV\/EBITDA \| 6\.50x \| 6\.75x \| 5\.00x \| 9\.00x \| 4 \| N\/A — EBITDA del objetivo ≤ 0 \|/);
    // Comparables con EBITDA negativo se imprimen con signo
    expect(res.comparableSelection).toContain('($10.000.000,00)');
  });

  it('estadísticas recalculadas desde los comparables; lo emitido por el LLM queda como discrepancia', () => {
    const v = validateComparables(llmComps({ primaryMultiple: 'ev_revenue' }));
    if (v.status !== 'ok') throw new Error('esperaba ok');
    const evEbitda = v.computed.statistics.find((s) => s.multiple === 'ev_ebitda')!;
    expect(evEbitda).toMatchObject({ median: 6.5, mean: 6.75, min: 5, max: 9, count: 4, applicable: false });
    expect(v.discrepancies.map((d) => d.field)).toEqual(expect.arrayContaining(['EV/EBITDA mediana', 'EV/EBITDA media']));
  });

  it('valor implícito y rango ajustado se recalculan: conservador ≤ base ≤ optimista', () => {
    // EV/Revenue de los comparables = [1; 1,5; 2; 2,5] ⇒ mín 1, mediana 1,75, máx 2,5
    const v = validateComparables(llmComps({ primaryMultiple: 'ev_revenue' }));
    if (v.status !== 'ok') throw new Error('esperaba ok');
    const c = v.computed;
    expect(c.implied.enterpriseValueMinCop).toBe(pesos(2_000_000_000));
    expect(c.implied.enterpriseValueMedianCop).toBe(pesos(3_500_000_000));
    expect(c.implied.enterpriseValueMaxCop).toBe(pesos(5_000_000_000));
    // Patrimonio = EV − deuda neta (100M)
    expect(c.implied.equityValueMedianCop).toBe(pesos(3_400_000_000));
    // Descuento por iliquidez 25% ⇒ × 0,75
    expect(c.adjustedRange).toEqual({
      conservativeCop: pesos(1_425_000_000),
      baseCop: pesos(2_550_000_000),
      optimisticCop: pesos(3_675_000_000),
    });
    const [lo, mid, hi] = [c.adjustedRange.conservativeCop, c.adjustedRange.baseCop, c.adjustedRange.optimisticCop].map(BigInt);
    expect(lo <= mid && mid <= hi).toBe(true);
    // El rango invertido del LLM ($3 > $1) queda como discrepancia
    expect(v.discrepancies.map((d) => d.field)).toContain('Rango ajustado conservador');
  });

  it('múltiplo de EV sin deuda neta del objetivo ⇒ no emitible', () => {
    const v = validateComparables(llmComps({ primaryMultiple: 'ev_revenue', targetNetDebtCop: null }));
    expect(v.status).toBe('blocked');
    if (v.status === 'blocked') expect(v.blockingErrors[0].code).toBe('net_debt_missing');
  });

  it('se admiten menos de 4 comparables con limitación declarada', () => {
    const json = llmComps({ primaryMultiple: 'ev_revenue' }, [5, 6]);
    expect(MarketComparablesReportSchema.safeParse(json).success).toBe(true);
    const v = validateComparables(json);
    if (v.status !== 'ok') throw new Error('esperaba ok');
    expect(v.notes.map((n) => n.code)).toContain('small_sample');
  });
});

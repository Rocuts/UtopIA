// ---------------------------------------------------------------------------
// Planeación tributaria — TTD N/D, Σ ahorros determinista y Art. 257/258
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-08: el «cálculo dual» del LLM (TMT = UAI × 15%,
//     impuesto a cargo = MAX, tmtAplicable=true por defecto) llegaba al
//     reporte. Sin ID/UD verificados: TTD, impuesto a cargo y aplicabilidad
//     N/D; Σ ahorros e impuesto optimizado recalculados.
//   - tributario-calc-16: el bloque del Art. 257 no puede ser «TOTAL
//     VINCULANTE» sobre una base del LLM; tope CONJUNTO Art. 258 y excedente
//     trasladable.
//   - tributario-calc-13: cuantías de sanción vigentes en el prompt.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llmOutputs: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (!(opts.agentName in llmOutputs)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llmOutputs[opts.agentName]), meta: {} };
  }),
}));

const facts: unknown[] = [];
vi.mock('@/lib/db/facts', () => ({
  getActiveFacts: vi.fn(async () => facts),
}));

import { runTaxOptimizer } from '../agents/tax-optimizer';
import { computeDonationDiscount } from '../orchestrator';
import { buildComplianceValidatorPrompt } from '../prompts/compliance-validator.prompt';
import type { CompanyInfo } from '../../types';

const company: CompanyInfo = { name: 'Comercial SAS', nit: '900123456-1', fiscalPeriod: '2025' };
const companyJson = {
  name: 'Comercial SAS', nit: '900123456-1', entityType: 'SAS', sector: null, niifGroup: 2,
  fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
};

function rec(id: string, savings: string) {
  return {
    id, title: 'x', norma: 'Art. 256 E.T.', regimeTarget: null, rationale: 'x', estimatedSavingsCents: savings,
    implementationCostCents: '0', roiPct: null, horizon: 'corto', priority: 'alta', riskLevel: 'bajo', preconditions: [],
  };
}

beforeEach(() => {
  for (const k of Object.keys(llmOutputs)) delete llmOutputs[k];
  facts.length = 0;
});

describe('Optimizador — cifras del LLM sustituidas por cálculo determinista o N/D', () => {
  it('TMT = UAI × 15% y MAX del modelo se descartan; Σ ahorros recalculada', async () => {
    llmOutputs['tax-optimizer'] = {
      company: companyJson,
      currentDiagnosis: {
        currentRegime: 'ordinario',
        effectiveTaxRatePct: 35,
        taxableIncomeCents: '100000000000', // $1.000M
        accountingProfitBeforeTaxCents: '100000000000',
        dualCalculation: {
          rentaOrdinaria35Cents: '1', // manipulado
          tributacionMinima15Cents: '15000000000',
          impuestoACargoCents: '35000000000',
          tmtAplicable: true,
          tmtExemptionReason: null,
        },
        currentBenefitsUsed: [],
        diagnosticNotes: 'x',
      },
      recommendations: [rec('S1', '1000000000'), rec('S2', '3000000000')],
      savingsProjection: {
        currentScenarioTaxCents: '35000000000',
        optimizedScenarioTaxCents: '1',
        totalAnnualSavingsCents: '99999999999', // ≠ Σ
        effectiveRateBeforePct: 35,
        effectiveRateAfterPct: 1,
        assumptions: [],
      },
      implementationRoadmap: [],
      preparerNotes: [],
    };
    const r = await runTaxOptimizer('datos', company, 'es');
    expect(r.impuestoACargoCents).toBeNull();
    expect(r.impuestoBasicoOrdinarioCents).toBe('35000000000');
    expect(r.currentStructureAnalysis).toContain('| Impuesto adicional por TTD (parág. 6 Art. 240 E.T.) | N/D |');
    expect(r.currentStructureAnalysis).toContain('| Impuesto a cargo del periodo | N/D |');
    expect(r.currentStructureAnalysis).not.toMatch(/MAX/);
    // Σ = 10M + 30M = 40M; optimizado = 350M − 40M = 310M.
    expect(r.projectedSavings).toContain('$40.000.000,00');
    expect(r.projectedSavings).toContain('$310.000.000,00');
    expect(r.projectedSavings).toContain('31.00%');
    // Orden descendente por ahorro.
    expect(r.optimizationStrategies.indexOf('### S2.')).toBeLessThan(r.optimizationStrategies.indexOf('### S1.'));
  });
});

describe('Art. 257 — estimación con tope conjunto del Art. 258', () => {
  it('sin impuesto a cargo verificado: ESTIMACIÓN, tope conjunto y excedente trasladable', async () => {
    facts.push({ kind: 'donation', fiscalPeriod: '2025', structured: { montoCentavos: '40000000000' } }); // $400M
    const b = await computeDonationDiscount('ws1', '2025', null, '35000000000'); // base $350M
    expect(b).not.toBeNull();
    expect(b!.baseVerificada).toBe(false);
    expect(b!.creditoCents).toBe('10000000000'); // 25% de $400M = $100M
    expect(b!.limiteCents).toBe('8750000000'); // 25% de $350M = $87,5M
    expect(b!.descuentoCents).toBe('8750000000');
    expect(b!.excedenteTrasladableCents).toBe('1250000000'); // $12,5M al periodo siguiente
  });
});

describe('compliance-validator — cuantías de sanción vigentes', () => {
  it('Art. 651: 1% / 0,7% / 0,5% y tope 7.500 UVT; reducciones Arts. 709/713', () => {
    const p = buildComplianceValidatorPrompt(company, 'es');
    expect(p).not.toMatch(/hasta 5% montos/);
    expect(p).not.toMatch(/reducible al 50% si corrige/);
    expect(p).toContain('7.500 UVT');
    expect(p).toContain('0,7%');
    expect(p).toMatch(/Art\. 709/);
    expect(p).toMatch(/Art\. 713/);
  });
});

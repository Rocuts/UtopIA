// ---------------------------------------------------------------------------
// Conciliación fiscal — umbral 2516 por año, tarifa por forma de recuperación
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-18: Decreto 1998/2017 (no el 2235/2017, que regula
//     concesiones/APP) y umbral de 45.000 UVT con la UVT del año gravable
//     (AG 2025 ⇒ $2.240.955.000, no $2.356.830.000).
//   - tributario-modulos-19: DTA/DTL con la tarifa de la forma de recuperación
//     (35% renta ordinaria, 15% ganancia ocasional — Art. 313 E.T.),
//     totales por categoría y cuadre de la cédula puente recalculados.
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

import { formato2516Threshold } from '../lib/deterministic';
import { buildDifferenceIdentifierPrompt } from '../prompts/difference-identifier.prompt';
import { buildDeferredTaxCalculatorPrompt } from '../prompts/deferred-tax-calculator.prompt';
import { orchestrateTaxReconciliation } from '../orchestrator';
import type { CompanyInfo } from '../../types';

const company: CompanyInfo = { name: 'Inmobiliaria SAS', nit: '900123456-1', fiscalPeriod: '2025' };
const companyJson = {
  name: 'Inmobiliaria SAS', nit: '900123456-1', entityType: 'SAS', sector: null, niifGroup: 2,
  fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
};

beforeEach(() => {
  for (const k of Object.keys(llmOutputs)) delete llmOutputs[k];
});

describe('umbral del Formato 2516 con la UVT del año gravable', () => {
  it('AG 2025: 45.000 × $49.799 = $2.240.955.000', () => {
    expect(formato2516Threshold('2025').thresholdCents).toBe('224095500000');
  });

  it('el prompt del Agente 1 cita el umbral del año y el Decreto 1998/2017', () => {
    const p = buildDifferenceIdentifierPrompt(company, 'es');
    expect(p).toContain('$2.240.955.000');
    expect(p).not.toContain('$2.356.830.000');
    expect(p).toContain('Decreto 1998/2017');
    expect(p).not.toContain('2235/2017');
    expect(p).not.toMatch(/maquinaria 15/);
    expect(buildDeferredTaxCalculatorPrompt(company, 'es')).not.toContain('2235/2017');
  });

  it('año sin UVT registrada ⇒ error explícito', () => {
    expect(() => formato2516Threshold('2031')).toThrow(/2031/);
  });
});

function item(over: Record<string, unknown>) {
  return {
    id: 'D1', category: 'activos', concept: 'x', accountingBaseCents: '0', fiscalBaseCents: '0',
    differenceCents: '0', classification: 'temporaria_imponible', niifReference: 'NIC 16', fiscalReference: 'Art. 69 E.T.',
    recoveryForm: 'uso_o_realizacion_ordinaria', applicableRatePct: null,
    deferredTaxAssetCents: '0', deferredTaxLiabilityCents: '0', notes: null,
    ...over,
  };
}

describe('impuesto diferido con tarifa por forma de recuperación y cuadres', () => {
  it('terreno revaluado (ganancia ocasional) al 15%; totales y cédula puente recalculados', async () => {
    llmOutputs['difference-identifier'] = {
      company: companyJson,
      differences: [
        // Terreno revaluado $1.000M: el «modelo» lo calculó al 35%.
        item({ id: 'D1', concept: 'Revaluación terreno', differenceCents: '100000000000', recoveryForm: 'venta_ganancia_ocasional', deferredTaxLiabilityCents: '35000000000' }),
        // Provisión NIC 37 $100M deducible al 35%, el modelo puso DTA inventado.
        item({ id: 'D2', category: 'pasivos', concept: 'Provisión litigios', differenceCents: '-10000000000', classification: 'temporaria_deducible', deferredTaxAssetCents: '999' }),
        item({ id: 'D3', category: 'costos_deducciones', concept: 'Multas', differenceCents: '500000000', classification: 'permanente', deferredTaxAssetCents: '175000000' }),
      ],
      categorySummaries: [{ category: 'activos', totalAbsoluteDifferenceCents: '1', totalDtaCents: '1', totalDtlCents: '1', itemCount: 9 }],
      bridgeSchedule: [
        { label: 'Patrimonio NIIF', amountCents: '500000000000', classification: 'patrimonio_niif', reference: null },
        { label: '(−) Revaluación terreno', amountCents: '-100000000000', classification: 'ajuste_activo', reference: 'Art. 69 E.T.' },
        { label: 'Patrimonio fiscal', amountCents: '410000000000', classification: 'patrimonio_fiscal', reference: 'Art. 282 E.T.' },
      ],
      patrimonioNiifCents: '500000000000',
      patrimonioFiscalCents: '410000000000', // no cuadra: 500 − 100 = 400
      formato2516Mapping: [],
      preparerNotes: [],
    };
    llmOutputs['deferred-tax-calculator'] = {
      company: companyJson,
      worksheet: [
        { differenceItemId: 'D1', concept: 'Revaluación terreno', temporaryDifferenceCents: '100000000000', type: 'imponible', taxRatePct: 35, dtaCents: '0', dtlCents: '35000000000', dtaRecognized: false, recognizedDtaCents: '0', recognitionEvidence: null },
        { differenceItemId: 'D2', concept: 'Provisión', temporaryDifferenceCents: '10000000000', type: 'deducible', taxRatePct: 35, dtaCents: '1', dtlCents: '0', dtaRecognized: true, recognizedDtaCents: '1', recognitionEvidence: 'utilidades' },
      ],
      dtaDtlSummary: { totalDtaCents: '1', totalRecognizedDtaCents: '1', totalDtlCents: '35000000000', netPositionCents: '-1' },
      movement: { openingBalanceDtaCents: null, openingBalanceDtlCents: null, pnlChargeDtaCents: null, pnlChargeDtlCents: null, oriChargeDtaCents: null, oriChargeDtlCents: null, closingBalanceDtaCents: '1', closingBalanceDtlCents: '1', netPositionCents: '0' },
      expenseBreakdown: { accountingProfitBeforeTaxCents: '0', permanentIncreaseCents: '0', permanentDecreaseCents: '0', temporaryNetCents: '0', taxableIncomeCents: '0', taxRatePct: 35, currentTaxCents: '0', deferredTaxExpenseCents: '0', totalTaxExpenseCents: '0' },
      effectiveRateReconciliation: { nominalRatePct: 35, reconcilingItems: [], effectiveRatePct: 35 },
      formato2516Mapping: [],
      journalEntries: [],
      preparerNotes: [],
    };

    const report = await orchestrateTaxReconciliation({ rawData: 'x', company, language: 'es' });
    const items = report.differenceAnalysis.items;
    expect(items.find((i) => i.id === 'D1')).toMatchObject({ applicableRatePct: 15, deferredTaxLiabilityCents: '15000000000' });
    expect(items.find((i) => i.id === 'D2')).toMatchObject({ applicableRatePct: 35, deferredTaxAssetCents: '3500000000' });
    expect(items.find((i) => i.id === 'D3')).toMatchObject({ deferredTaxAssetCents: '0', deferredTaxLiabilityCents: '0' });
    expect(report.differenceAnalysis.bridgeBalances).toBe(false);
    expect(report.differenceAnalysis.bridgeSchedule).toMatch(/LA CÉDULA PUENTE NO CUADRA/);

    // Hoja del Agente 2 con las tarifas del Agente 1.
    expect(report.deferredTaxCalculation.deferredTaxWorksheet).toContain(
      '| D1 | Revaluación terreno | $1.000.000.000,00 | imponible | 15% | $0,00 | $150.000.000,00 |',
    );
    expect(report.deferredTaxCalculation.deferredTaxWorksheet).toContain('| D2 | Provisión | $100.000.000,00 | deducible | 35% | $35.000.000,00 |');
    expect(report.deferredTaxCalculation.dtaDtlSchedule).toContain('| Total DTL | $150.000.000,00 |');
    expect(report.deferredTaxCalculation.dtaDtlSchedule).toContain('| Total DTA reconocido (NIC 12 §24) | $35.000.000,00 |');

    expect(report.consolidatedReport).toContain('Decreto 1998/2017');
    expect(report.consolidatedReport).toContain('$2.240.955.000');
  });
});

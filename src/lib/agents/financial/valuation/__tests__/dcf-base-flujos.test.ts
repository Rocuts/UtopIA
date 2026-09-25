// ---------------------------------------------------------------------------
// valoracion-21 (contrato) — base monetaria de los FCF, de g y del WACC
// ---------------------------------------------------------------------------
// P3 corrigió el prompt (FCF, WACC y g en COP nominales), pero el contrato que
// viaja al LLM seguía describiendo g como "alineada con PIB Colombia largo
// plazo" (una cifra real) y nada impedía descontar flujos reales a un WACC
// nominal. Ahora el contrato declara `projection.cashFlowBasis`
// ('nominal' | 'real', nullable por strict-mode) y el validador determinista:
//   - nominal ⇒ g < WACC se verifica en la misma base (WACC COP nominal);
//   - real    ⇒ DCF no emitible hasta convertir flujos y g a nominal;
//   - null    ⇒ nota visible: se asume nominal, la base del WACC.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { toDcfModelResult } from '@/lib/agents/financial/valuation/agents/dcf-modeler';
import { validateDcf } from '@/lib/agents/financial/valuation/validators/dcf-validator';
import {
  DcfModelReportSchema,
  type DcfModelReportJson,
} from '@/lib/agents/financial/contracts/valuation';

const pesos = (n: number) => String(Math.round(n * 100));

function dcf(cashFlowBasis: 'nominal' | 'real' | null): DcfModelReportJson {
  const rows = [2026, 2027, 2028].map((year) => ({
    year,
    revenueCop: pesos(5_000_000_000),
    ebitdaCop: pesos(1_100_000_000),
    ebitCop: pesos(1_000_000_000),
    taxCop: pesos(350_000_000),
    depAmortCop: pesos(100_000_000),
    capexCop: pesos(150_000_000),
    workingCapitalChangeCop: pesos(50_000_000),
    fcfCop: pesos(550_000_000),
  }));
  return {
    company: {
      name: 'ACME SAS', nit: '900123456-7', fiscalPeriod: '2025', entityType: null, sector: null,
      city: null, comparativePeriod: null, niifGroup: null, signatories: null,
    } as never,
    projection: { rows, keyAssumptions: ['Crecimiento 0%'], cashFlowBasis },
    wacc: {
      riskFreeBasis: 'TES_COP_ex_default',
      sovereignYieldPercent: 6.5,
      defaultSpreadPercent: 1.5,
      riskFreeRatePercent: 5,
      countryRiskPremiumPercent: 2,
      equityRiskPremiumPercent: 3,
      beta: 1,
      sizePremiumPercent: 0,
      copInflationPercent: null,
      usdInflationPercent: null,
      costOfEquityPercent: 10,
      costOfDebtPercent: 12,
      taxRatePercent: 35,
      equityWeightPercent: 100,
      debtWeightPercent: 0,
      waccPercent: 10,
      marketDataProvenance: 'supuesto de prueba',
      rationale: 'x',
    },
    terminalValue: {
      nextYearFcfCop: pesos(561_000_000),
      perpetualGrowthPercent: 2,
      waccPercent: 10,
      terminalValueCop: pesos(7_012_500_000),
      terminalValuePercentOfTotal: 79.4,
      rationale: 'x',
    },
    valuation: {
      enterpriseValueCop: '663636363637',
      financialDebtCop: null,
      cashAndEquivalentsCop: null,
      netDebtCop: '0',
      otherBridgeAdjustmentsCop: null,
      equityValueCop: '663636363637',
      sharesOutstanding: null,
      pricePerShareCop: null,
    },
    limitations: [],
    citations: ['NIIF 13'],
  };
}

describe('valoracion-21 — contrato del DCF', () => {
  it('g se describe en la base nominal de FCF y WACC, sin anclarla al PIB', () => {
    const g = DcfModelReportSchema.shape.terminalValue.shape.perpetualGrowthPercent;
    expect(g.description ?? '').not.toMatch(/PIB/i);
    expect(g.description ?? '').toMatch(/misma base nominal/i);
    expect(g.description ?? '').toMatch(/< WACC/);
  });

  it('cashFlowBasis es un enum nominal/real nullable (strict-mode) y obligatorio en el objeto', () => {
    const basis = DcfModelReportSchema.shape.projection.shape.cashFlowBasis;
    expect(basis.safeParse('nominal').success).toBe(true);
    expect(basis.safeParse('real').success).toBe(true);
    expect(basis.safeParse(null).success).toBe(true);
    expect(basis.safeParse(undefined).success).toBe(false);
    expect(basis.safeParse('usd').success).toBe(false);
    expect(DcfModelReportSchema.safeParse(dcf('nominal')).success).toBe(true);
  });
});

describe('valoracion-21 — validador DCF: g < WACC en la misma base', () => {
  it('nominal: emitible y sin nota de base', () => {
    const v = validateDcf(dcf('nominal'));
    expect(v.status).toBe('ok');
    if (v.status !== 'ok') return;
    expect(v.notes.map((n) => n.code)).not.toContain('cash_flow_basis_undeclared');
  });

  it('real: DCF no emitible hasta convertir flujos y g a nominal', () => {
    const v = validateDcf(dcf('real'));
    expect(v.status).toBe('blocked');
    if (v.status !== 'blocked') return;
    const err = v.blockingErrors.find((e) => e.code === 'cash_flow_basis_real');
    expect(err).toBeDefined();
    expect(err!.es).toMatch(/\(1 \+ g\) = \(1 \+ g real\) × \(1 \+ inflación/);
    expect(err!.en).toMatch(/nominal/);
    const res = toDcfModelResult(dcf('real'), 'es');
    expect(res.status).toBe('blocked');
    expect(res.fullContent).toContain('DCF NO EMITIBLE');
  });

  it('sin base declarada: emitible con nota visible (se asume nominal, la base del WACC)', () => {
    const v = validateDcf(dcf(null));
    expect(v.status).toBe('ok');
    if (v.status !== 'ok') return;
    const nota = v.notes.find((n) => n.code === 'cash_flow_basis_undeclared');
    expect(nota?.es).toMatch(/se asume nominal/);
    const res = toDcfModelResult(dcf(null), 'en');
    expect(res.validationReport).toMatch(/assumed nominal/);
  });
});

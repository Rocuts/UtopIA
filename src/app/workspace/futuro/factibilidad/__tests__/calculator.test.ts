// IW4 (valoracion-09) — La calculadora de /workspace/futuro/factibilidad tenía
// su propio VPN/TIR en float, aceptaba flujos no convencionales como TIR única
// y arrancaba con una tasa de descuento de 13,5 % "WACC CO típico" sin fuente.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { computeCalculator } from '../calculator';
import { computeProjectMetrics } from '@/lib/agents/financial/feasibility/calc/project-metrics';

describe('calculadora de factibilidad — misma función determinista del pipeline', () => {
  it('con tasa declarada: VPN/TIR/IR = computeProjectMetrics (centavos)', () => {
    const r = computeCalculator({
      investmentCop: 1_000_000,
      cashflowsCop: [400_000, 400_000, 400_000],
      taxRate: 0,
      discountRatePercent: 10,
    });
    const ref = computeProjectMetrics(
      '100000000',
      [1, 2, 3].map((year) => ({ year, freeCashFlowCop: '40000000' })),
      10,
    );
    if (ref.status !== 'ok') throw new Error('ref');
    expect(r.npv).toBe(Number(ref.metrics.npvCop) / 100);
    expect(r.irr).toBeCloseTo(ref.metrics.irrPercent! / 100, 10);
    expect(r.pi).toBe(ref.metrics.profitabilityIndex);
    expect(r.discountRateMissing).toBe(false);
  });

  it('sin tasa declarada: VPN, IR, TIRM y payback descontado son N/D; TIR y payback no', () => {
    const r = computeCalculator({
      investmentCop: 1_000_000,
      cashflowsCop: [400_000, 400_000, 400_000],
      taxRate: 0,
      discountRatePercent: null,
    });
    expect(r.discountRateMissing).toBe(true);
    expect(r.npv).toBeNull();
    expect(r.pi).toBeNull();
    expect(r.mirr).toBeNull();
    expect(r.discountedPayback).toBeNull();
    expect(r.irr).not.toBeNull();
    expect(r.payback).toBeCloseTo(2.5, 2);
  });

  it('flujos no convencionales: TIR N/D con motivo (antes una raíz cualquiera)', () => {
    const r = computeCalculator({
      investmentCop: 1_000_000,
      cashflowsCop: [3_000_000, -2_500_000],
      taxRate: 0,
      discountRatePercent: 12,
    });
    expect(r.irr).toBeNull();
    expect(r.irrNote?.es).toMatch(/no convencionales/);
  });

  it('la página no fija 13,5 % como WACC por defecto ni calcula VPN/TIR por su cuenta', () => {
    const src = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8');
    expect(src).not.toMatch(/useState<number>\(0\.135\)/);
    expect(src).not.toMatch(/13[.,]5\s*%?\s*WACC/);
    expect(src).not.toMatch(/function computeNpv|function computeIrr|function computePayback/);
    expect(src).toMatch(/computeCalculator/);
  });
});

// valoracion-26 — el ajuste (1 − t) se aplicaba también a los flujos
// negativos, como si toda pérdida diera un crédito fiscal inmediato. Las
// pérdidas fiscales se compensan con rentas futuras (Art. 147 E.T.), que esta
// calculadora no modela: los flujos negativos quedan sin escudo fiscal.
describe('valoracion-26 — tratamiento fiscal de los flujos negativos', () => {
  it('sólo los flujos positivos se ajustan por (1 − t)', () => {
    const r = computeCalculator({
      investmentCop: 1_000_000,
      cashflowsCop: [800_000, -200_000, 900_000],
      taxRate: 0.35,
      discountRatePercent: 10,
    });
    expect(r.effectiveCashflowsCop).toEqual([520_000, -200_000, 585_000]);
  });

  it('la página rotula la simplificación fiscal', () => {
    const src = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8');
    expect(src).toMatch(/Art\. 147/);
  });
});

// Regresión valoracion-09 — VPN/TIR/TIRM/payback/IR/punto de equilibrio en código.
import { describe, it, expect } from 'vitest';
import {
  computeBreakEven,
  computeNpvCents,
  computeProjectMetrics,
} from '@/lib/agents/financial/feasibility/calc/project-metrics';

const pesos = (n: number) => String(Math.round(n * 100));
const flows = (values: number[]) => values.map((v, i) => ({ year: i + 1, freeCashFlowCop: pesos(v) }));

describe('computeProjectMetrics', () => {
  it('I0 = 1.000.000, FCLP 500.000 × 3, tasa 10%', () => {
    const r = computeProjectMetrics(pesos(1_000_000), flows([500_000, 500_000, 500_000]), 10);
    if (r.status !== 'ok') throw new Error('esperaba ok');
    const m = r.metrics;
    expect(m.rows.map((x) => x.pvCop)).toEqual(['45454545', '41322314', '37565740']);
    expect(m.pvInflowsCop).toBe('124342599');
    expect(m.npvCop).toBe('24342599'); // $243.425,99
    expect(m.irrPercent).toBeCloseTo(23.3752, 3);
    expect(m.mirrPercent).toBeCloseTo(18.2837, 2);
    expect(m.paybackYears).toBe(2);
    expect(m.discountedPaybackYears).toBe(2.35);
    expect(m.profitabilityIndex).toBe(1.2434);
    expect(computeNpvCents(pesos(1_000_000), flows([500_000, 500_000, 500_000]), 10)).toBe(BigInt(24342599));
  });

  it('flujos no convencionales ⇒ TIR N/D con motivo; sin recuperación ⇒ payback N/D', () => {
    const r = computeProjectMetrics(pesos(100), flows([230, -132]), 10);
    if (r.status !== 'ok') throw new Error('esperaba ok');
    expect(r.metrics.irrPercent).toBeNull();
    expect(r.metrics.irrNote?.es).toContain('no convencionales');
    const neverBack = computeProjectMetrics(pesos(1_000), flows([100, 100]), 10);
    if (neverBack.status !== 'ok') throw new Error('esperaba ok');
    expect(neverBack.metrics.paybackYears).toBeNull();
    expect(BigInt(neverBack.metrics.npvCop) < BigInt(0)).toBe(true);
  });

  it('insumos inválidos ⇒ métricas N/D con motivos', () => {
    const r = computeProjectMetrics('0', [{ year: 1, freeCashFlowCop: '1' }, { year: 3, freeCashFlowCop: '1' }], 10);
    expect(r.status).toBe('unavailable');
    if (r.status === 'unavailable') expect(r.reasons.map((x) => x.es).join(' | ')).toMatch(/inversión inicial no positiva.*no consecutivos/);
  });
});

describe('computeBreakEven', () => {
  it('CF 400M, P 18.500, CVu 11.200 ⇒ 54.794,52 unidades', () => {
    const r = computeBreakEven(pesos(400_000_000), pesos(18_500), pesos(11_200));
    if (r.status !== 'ok') throw new Error('esperaba ok');
    expect(r.units).toBe(54794.52);
    expect(r.revenueCop).toBe('101369863014');
    expect(r.contributionMarginCop).toBe(pesos(7_300));
  });

  it('margen de contribución ≤ 0 o insumos faltantes ⇒ N/D', () => {
    const neg = computeBreakEven(pesos(1_000), pesos(1_000), pesos(1_200));
    expect(neg.status).toBe('unavailable');
    if (neg.status === 'unavailable') expect(neg.reason.es).toContain('margen de contribución');
    expect(computeBreakEven(null, pesos(1), pesos(1)).status).toBe('unavailable');
  });
});

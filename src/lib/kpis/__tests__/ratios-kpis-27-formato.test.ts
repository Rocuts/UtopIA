// ---------------------------------------------------------------------------
// ratios-kpis-27 (parte KPIs) — formato es-CO y N/D en los motores de KPI
// ---------------------------------------------------------------------------
// exit-value, roi-probabilistic y tax-efficiency formateaban con sufijo `B`
// (en español se lee billón = 10^12), punto decimal (`5.40`, `20.0%`) y
// publicaban `$0 COP` / `0.0%` para un valor no finito. Ahora usan el formato
// único de @/lib/charts/format (coma decimal, `mil M`, paréntesis) y N/D.
// valoracion-25 (P5) ya había convertido en N/D los supuestos ausentes; aquí
// se verifica que siga así.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { calculateExitValue, formatCop } from '../exit-value';
import { calculateRoiProbabilistic } from '../roi-probabilistic';
import { calculateTef } from '../tax-efficiency';
import { KpiNoCalculableError } from '../no-calculable';
import { formatKpiCop, formatKpiPercentPoints } from '../format';
import type { KpiResult } from '@/types/kpis';

/** Todas las cadenas formateadas de un KPI. */
const textos = (r: KpiResult) => [
  r.formatted,
  ...(r.breakdown ?? []).map((b) => b.formatted),
  ...(r.assumptions ?? []),
];
const fila = (r: KpiResult, label: string) => (r.breakdown ?? []).find((b) => b.label === label)?.formatted;

/** Sufijos anglosajones o decimales con punto (`5.40`, `20.0%`, `7.00x`). */
const ANGLO = /\d\s?[BTK]\b|\d\.\d{1,2}(?:%|x|×|\s?[A-Z])|B COP|\$0 COP|0\.0%/;

describe('ratios-kpis-27 — Exit Value', () => {
  const r = calculateExitValue({
    ebitda: 800_000_000,
    industry: 'services',
    growthRate: 0.1,
    netDebt: 200_000_000,
    wacc: 0.135,
  });

  it('miles de millones como «mil M» con coma decimal, sin B ni punto decimal', () => {
    expect(r.value).toBe(5_400_000_000);
    expect(r.formatted).toBe('$5,4 mil M');
    for (const t of textos(r)) expect(t).not.toMatch(ANGLO);
    expect(fila(r, 'Múltiplo aplicado')).toBe('7,00×');
    expect((r.assumptions ?? []).join(' ')).toMatch(/13,5%/);
  });

  it('patrimonio negativo entre paréntesis (NIIF), no con signo menos', () => {
    const neg = calculateExitValue({ ebitda: 100_000_000, industry: 'retail', growthRate: 0, netDebt: 1_000_000_000 });
    expect(neg.value).toBe(-400_000_000);
    expect(neg.formatted).toBe('($400 M)');
  });

  it('el formateador exportado ya no publica $0 COP para un valor no finito', () => {
    expect(formatCop(Number.NaN)).toBe('N/D');
    expect(formatCop(Number.POSITIVE_INFINITY)).toBe('N/D');
  });

  it('sin deuda neta declarada sigue N/D (valoracion-25)', () => {
    expect(() => calculateExitValue({ ebitda: 800_000_000, industry: 'services', growthRate: 0.1 })).toThrow(
      KpiNoCalculableError,
    );
  });
});

describe('ratios-kpis-27 — ROI probabilístico', () => {
  const r = calculateRoiProbabilistic({
    projects: [
      { name: 'A', expectedReturn: 0.25, probability: 0.8, investment: 1_500_000_000 },
      { name: 'B', expectedReturn: 0.1, probability: 0.9, investment: 500_000_000 },
    ],
    failureReturn: -0.2,
    marketRisk: 0.25,
    marketRiskSource: 'acta del comité',
  });

  it('porcentajes con coma decimal e inversión en «mil M»', () => {
    for (const t of textos(r)) expect(t).not.toMatch(ANGLO);
    expect(r.formatted).toMatch(/^\d+,\d%$/);
    expect(fila(r, 'Inversión total')).toBe('$2 mil M');
    expect(fila(r, 'Factor de ajuste por riesgo')).toBe('0,75');
  });

  it('sin retorno en caso de fracaso sigue N/D (valoracion-25)', () => {
    expect(() =>
      calculateRoiProbabilistic({ projects: [{ name: 'A', expectedReturn: 0.25, probability: 0.8, investment: 1 }] }),
    ).toThrow(KpiNoCalculableError);
  });
});

describe('ratios-kpis-27 — TEF', () => {
  const r = calculateTef({
    revenue: 5_000_000_000,
    taxableIncomeBaseline: 1_000_000_000,
    taxableIncomeOptimized: 800_000_000,
  });

  it('TEF y montos es-CO, sin K/B ni punto decimal', () => {
    expect(r.value).toBe(20);
    expect(r.formatted).toBe('20,0%');
    for (const t of textos(r)) expect(t).not.toMatch(ANGLO);
    expect(fila(r, 'Impuesto baseline')).toBe('$350 M');
    expect(fila(r, 'Tasa efectiva baseline')).toBe('7,00%');
  });

  it('base de referencia ≤ 0 sigue N/D, no TEF 0 % (valoracion-25)', () => {
    expect(() =>
      calculateTef({ revenue: 1, taxableIncomeBaseline: 0, taxableIncomeOptimized: 0 }),
    ).toThrow(KpiNoCalculableError);
  });
});

describe('helpers de formato de KPI', () => {
  it('no finito ⇒ N/D (nunca $0 ni 0%)', () => {
    expect(formatKpiCop(Number.NaN)).toBe('N/D');
    expect(formatKpiPercentPoints(Number.NaN)).toBe('N/D');
    expect(formatKpiCop(12_500)).toBe('$12,5 mil');
    expect(formatKpiPercentPoints(-4.06)).toBe('-4,1%');
  });
});

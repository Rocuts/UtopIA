// valoracion-25 — KPI exit-value / roi-probabilistic / tax-efficiency.
//   Hoy sin consumidores productivos (live.ts devuelve N/D), pero sus fórmulas
//   convertían N/D en 0: EBITDA o deuda neta ausentes ⇒ 0 (patrimonio = EV),
//   base fiscal ausente ⇒ TEF 0 %, retorno 0 % en caso de fracaso implícito,
//   «riesgo de mercado CO 25 %» fijo sin fuente que además ACHICABA las
//   pérdidas, múltiplo × (1 + g) y confianza «high» para cualquier override.
//   Ahora: entradas ausentes ⇒ KpiNoCalculableError con motivo (N/D); los
//   supuestos se declaran o no se aplican.
import { describe, expect, it } from 'vitest';
import { calculateExitValue } from '../exit-value';
import { calculateRoiProbabilistic } from '../roi-probabilistic';
import { calculateTef } from '../tax-efficiency';
import { KpiNoCalculableError } from '../no-calculable';

function motivo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(KpiNoCalculableError);
    return (e as KpiNoCalculableError).motivo;
  }
  throw new Error('se esperaba KpiNoCalculableError');
}

describe('exit-value', () => {
  it('EBITDA ausente o no finito ⇒ N/D, no 0', () => {
    expect(
      motivo(() => calculateExitValue({ ebitda: Number.NaN, industry: 'services', growthRate: 0.1, netDebt: 0 })),
    ).toMatch(/EBITDA/);
  });

  it('EBITDA ≤ 0 ⇒ N/D: el método por múltiplos de EBITDA no aplica', () => {
    expect(
      motivo(() => calculateExitValue({ ebitda: -50_000_000, industry: 'services', growthRate: 0.1, netDebt: 0 })),
    ).toMatch(/EBITDA/);
  });

  it('deuda neta no declarada ⇒ N/D (el patrimonio no es el EV)', () => {
    expect(
      motivo(() => calculateExitValue({ ebitda: 800_000_000, industry: 'services', growthRate: 0.1 })),
    ).toMatch(/deuda neta/i);
  });

  it('el crecimiento no multiplica el múltiplo (g = 100 % no lo duplica)', () => {
    const a = calculateExitValue({ ebitda: 800_000_000, industry: 'services', growthRate: 0, netDebt: 0 });
    const b = calculateExitValue({ ebitda: 800_000_000, industry: 'services', growthRate: 1, netDebt: 0 });
    expect(a.value).toBe(800_000_000 * 7);
    expect(b.value).toBe(a.value);
  });

  it('confianza: tabla interna ⇒ low; override del usuario ⇒ medium (nunca high)', () => {
    const tabla = calculateExitValue({ ebitda: 800_000_000, industry: 'services', growthRate: 0.1, netDebt: 0 });
    const override = calculateExitValue({
      ebitda: 800_000_000, industry: 'services', growthRate: 0.1, netDebt: 0, comparableMultiplesOverride: 8,
    });
    expect(tabla.confidence).toBe('low');
    expect(override.confidence).toBe('medium');
    expect((tabla.assumptions ?? []).join(' | ')).toMatch(/sin fuente/i);
  });
});

describe('roi-probabilistic', () => {
  const proyectos = [
    { name: 'A', expectedReturn: 0.25, probability: 0.5, investment: 100 },
  ];

  it('sin retorno en caso de fracaso declarado ⇒ N/D', () => {
    expect(motivo(() => calculateRoiProbabilistic({ projects: proyectos }))).toMatch(/fracaso/);
  });

  it('pérdida total en el fracaso: E[r] = p·r + (1 − p)·f', () => {
    const r = calculateRoiProbabilistic({ projects: proyectos, failureReturn: -1 });
    // 0,5 × 25 % + 0,5 × (−100 %) = −37,5 %
    expect(r.value).toBe(-37.5);
  });

  it('sin riesgo de mercado declarado no se aplica el 25 % por defecto', () => {
    const r = calculateRoiProbabilistic({ projects: proyectos, failureReturn: 0 });
    expect(r.value).toBe(12.5);
    expect((r.assumptions ?? []).join(' | ')).toMatch(/no declarado/);
  });

  it('el ajuste por riesgo de mercado no achica una pérdida', () => {
    const r = calculateRoiProbabilistic({ projects: proyectos, failureReturn: -1, marketRisk: 0.25 });
    expect(r.value).toBe(-37.5);
  });

  it('riesgo de mercado declarado se rotula con su fuente', () => {
    const r = calculateRoiProbabilistic({
      projects: proyectos, failureReturn: 0, marketRisk: 0.2, marketRiskSource: 'comité de inversiones 2026-09',
    });
    expect(r.value).toBe(10);
    expect((r.assumptions ?? []).join(' | ')).toMatch(/comité de inversiones 2026-09/);
  });

  it('sin proyectos o sin inversión ⇒ N/D', () => {
    expect(motivo(() => calculateRoiProbabilistic({ projects: [], failureReturn: 0 }))).toMatch(/inversi/);
  });
});

describe('tax-efficiency', () => {
  it('base fiscal de referencia ausente o ≤ 0 ⇒ N/D, no TEF 0 %', () => {
    expect(
      motivo(() => calculateTef({ revenue: 1, taxableIncomeBaseline: 0, taxableIncomeOptimized: 0 })),
    ).toMatch(/base/i);
    expect(
      motivo(() =>
        calculateTef({ revenue: 1, taxableIncomeBaseline: 100, taxableIncomeOptimized: Number.NaN }),
      ),
    ).toMatch(/optimizad/i);
  });

  it('admite tarifas distintas antes y después (régimen preferencial)', () => {
    // 1.000M al 35 % = 350M; 1.000M al 20 % = 200M ⇒ ahorro 150M = 42,86 %.
    const r = calculateTef({
      revenue: 5_000_000_000,
      taxableIncomeBaseline: 1_000_000_000,
      taxableIncomeOptimized: 1_000_000_000,
      taxRate: 0.35,
      taxRateOptimized: 0.2,
    });
    expect(r.value).toBe(42.86);
  });

  it('sin tasas efectivas ni ingresos no publica una «tasa efectiva» igual a la nominal', () => {
    const r = calculateTef({ revenue: 0, taxableIncomeBaseline: 100, taxableIncomeOptimized: 80 });
    const labels = (r.breakdown ?? []).map((b) => b.label);
    expect(labels).not.toContain('Tasa efectiva baseline');
  });
});

describe('fixtures de KPI', () => {
  it('declaran los supuestos obligatorios (el módulo carga sin N/D)', async () => {
    const m = await import('../__fixtures__/mocks');
    for (const sev of ['good', 'neutral', 'warn', 'critical'] as const) {
      expect(Number.isFinite(m.generateMockKpiSet(sev).roi.value)).toBe(true);
    }
  });
});

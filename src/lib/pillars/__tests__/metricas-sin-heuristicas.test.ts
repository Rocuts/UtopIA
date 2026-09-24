// ratios-kpis-10 / -15 / -19 / -25 — una definición por indicador, sin
// métricas fiscales heurísticas y sin puntos por KPIs ausentes.
import { describe, it, expect } from 'vitest';

import { computeEscudoPillar } from '../escudo';
import { computeEscudoExecutiveCards } from '../escudo-cards';
import { computeFuturoPillar } from '../futuro';
import { computeFuturoExecutiveCards } from '../futuro-cards';
import { computeValorPillar } from '../valor';
import { computeVerdadPillar } from '../verdad';
import { kpiToScore, weightedScore } from '../health-score';
import { makeControlTotals, makePnlSnapshot, makeSnapshot } from './_fixtures';

const kpi = (m: { kpis: Array<{ key: string; value: number | null; score: number | null }> }, key: string) =>
  m.kpis.find((k) => k.key === key)!;

describe('ratios-kpis-10 — métricas fiscales heurísticas ⇒ N/D', () => {
  it('con pérdida la cobertura fiscal NO es 1 "healthy": es N/D y no puntúa', () => {
    const snap = makePnlSnapshot();
    snap.controlTotals.utilidadNeta = -50_000_000;
    const out = computeEscudoPillar({ snapshot: snap });
    const cob = kpi(out, 'cobertura_fiscal');
    expect(cob.value).toBeNull();
    expect(cob.score).toBeNull();
  });

  it('con utilidad tampoco se estima UN × 35 % contra el grupo 24 completo', () => {
    const snap = makePnlSnapshot();
    const out = computeEscudoPillar({ snapshot: snap });
    expect(kpi(out, 'cobertura_fiscal').value).toBeNull();
    expect(out.alerts.some((a) => a.code === 'SHIELD-TAX-GAP')).toBe(false);

    const cards = computeEscudoExecutiveCards({ snapshot: snap });
    expect(cards.reserva_fiscal.value).toBeNull();
    expect(cards.reserva_fiscal.descriptionEs).toMatch(/^N\/D/);

    const fut = computeFuturoExecutiveCards({ snapshot: snap });
    expect(fut.provision_tributaria.value).toBeNull();
    expect(fut.provision_tributaria.descriptionEs).toMatch(/^N\/D/);
  });
});

describe('ratios-kpis-19 — Capacidad de Inversión: un único cálculo', () => {
  it('pilar y tarjeta devuelven la misma cifra (N/D sin base fiscal verificada)', () => {
    const snap = makePnlSnapshot();
    const pillar = kpi(computeFuturoPillar({ snapshot: snap }), 'capex_capacity');
    const card = computeFuturoExecutiveCards({ snapshot: snap }).capacidad_inversion;
    expect(pillar.value).toBe(card.value);
    expect(card.value).toBeNull();
  });
});

describe('ratios-kpis-15 — liquidez con una sola definición', () => {
  it('días de autonomía del pilar = tarjeta (caja 11 / egresos diarios base 365)', () => {
    const snap = makePnlSnapshot();
    const pillar = kpi(computeEscudoPillar({ snapshot: snap }), 'dias_autonomia');
    const card = computeEscudoExecutiveCards({ snapshot: snap }).autonomia;
    const esperado = 400_000_000 / (1_775_000_000 / 365);
    expect(pillar.value).toBeCloseTo(esperado, 6);
    expect(card.value).toBeCloseTo(esperado, 6);
  });

  it('razón corriente (pilar) y prueba ácida (tarjeta) desde controlTotals', () => {
    const snap = makePnlSnapshot();
    const pillar = kpi(computeEscudoPillar({ snapshot: snap }), 'solvencia_real');
    expect(pillar.value).toBeCloseTo(900 / 465, 10);
    const card = computeEscudoExecutiveCards({ snapshot: snap }).cobertura_pasivos;
    expect(card.value).toBeCloseTo((900 - 200) / 465, 10);
    expect(card.labelEs).toBe('Prueba ácida');
  });

  it('sin pasivo corriente ⇒ null (no el centinela 999)', () => {
    const snap = makeSnapshot(
      makeControlTotals({ activoCorriente: 100_000_000, pasivoCorriente: 0, efectivoCuenta11: 1, gastos: 10 }),
      [],
    );
    expect(kpi(computeEscudoPillar({ snapshot: snap }), 'solvencia_real').value).toBeNull();
    expect(computeEscudoExecutiveCards({ snapshot: snap }).cobertura_pasivos.value).toBeNull();
  });

  it('sin egresos ⇒ autonomía null (no 365 inventados)', () => {
    const snap = makeSnapshot(makeControlTotals({ efectivoCuenta11: 50_000_000, gastos: 0 }), []);
    expect(kpi(computeEscudoPillar({ snapshot: snap }), 'dias_autonomia').value).toBeNull();
    expect(computeEscudoExecutiveCards({ snapshot: snap }).autonomia.value).toBeNull();
  });
});

describe('ratios-kpis-25 — KPIs ausentes no puntúan', () => {
  it('kpiToScore(null) = null y weightedScore lo ignora', () => {
    expect(kpiToScore(null, { healthy: 1, watch: 0.5, warning: 0.1 }, 'higher-better')).toBeNull();
    expect(weightedScore([{ score: 95, weight: 0.5 }, { score: null, weight: 0.5 }])).toBe(95);
  });

  it('Verdad sin conciliación: el health score = el de los KPIs medidos, con cobertura expuesta', () => {
    const snap = makeSnapshot(
      makeControlTotals({ activo: 1_000_000_000, pasivo: 600_000_000, patrimonio: 400_000_000 }),
      [],
    );
    const out = computeVerdadPillar({
      snapshot: snap,
      forensic: { score: 95, totalAnomalies: 0, bySeverity: { low: 0, medium: 0, high: 0 } },
    });
    // brecha 0 → 95 (0,5) + integridad 95 → 95 (0,3); conciliación null excluida.
    expect(out.healthScore).toBe(95);
    expect(out.kpiCoverage).toEqual({ available: 2, total: 3 });
  });

  it('sin análisis forense la integridad es N/D (no 100 − 20 × críticos)', () => {
    const snap = makeSnapshot(
      makeControlTotals({ activo: 1_000_000_000, pasivo: 600_000_000, patrimonio: 400_000_000 }),
      [],
    );
    const out = computeVerdadPillar({ snapshot: snap });
    const integ = kpi(out, 'score_integridad');
    expect(integ.value).toBeNull();
    expect(integ.score).toBeNull();
  });

  it('EVA sin costo de capital declarado ⇒ N/D; con capital empleado ≤ 0 ⇒ N/D', () => {
    const snap = makePnlSnapshot();
    expect(kpi(computeValorPillar({ snapshot: snap }), 'eva').value).toBeNull();

    const negCap = makePnlSnapshot();
    negCap.controlTotals.activo = 100_000_000;
    negCap.controlTotals.pasivoCorriente = 500_000_000;
    const eva = kpi(computeValorPillar({ snapshot: negCap, costoOportunidad: 0.12 }), 'eva');
    expect(eva.value).toBeNull();
  });

  it('EVA con costo declarado: NOPAT = EBIT × (1 − tasa efectiva contable) − capital × costo', () => {
    const snap = makePnlSnapshot();
    const ct = snap.controlTotals;
    ct.cents = {
      activo: BigInt(130_000_000_000), pasivo: BigInt(46_500_000_000), patrimonio: BigInt(83_500_000_000),
      ingresos: BigInt(228_000_000_000), gastos: BigInt(177_500_000_000),
      utilidadNeta: BigInt(34_500_000_000), utilidadAntesImpuestos: BigInt(44_000_000_000),
      impuestoCausado: BigInt(9_500_000_000), efectivoCuenta11: BigInt(40_000_000_000),
      saldoAFavorImpuesto: BigInt(0), totalDevoluciones: BigInt(8_000_000_000),
      ingresosNetos: BigInt(212_000_000_000),
    };
    const eva = kpi(computeValorPillar({ snapshot: snap, costoOportunidad: 0.12 }), 'eva');
    const t = 95 / 440; // impuesto causado / UAI
    const nopat = 270_000_000 * (1 - t);
    const capital = 1_300_000_000 - 465_000_000;
    expect(eva.value).toBeCloseTo(nopat - capital * 0.12, 2);
  });
});

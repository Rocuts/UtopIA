// W4-C (re-auditoría 2026-09-24) — una sola base de meses / anualización y un
// solo margen neto entre preprocesador, pilares, tarjetas, Sentinel y PDF.
//   NM-01: 'AAAA-Qn' y rangos se trataban como 12 meses fuera del preprocesador.
//   NM-02: el ROE del pilar Valor no se anualizaba ni respetaba el N/D.
//   NM-03: 'Margen Neto Real' restaba reclasificaciones R1 de balance.
//   NM-11: Sentinel medía días de inventario sólo con la clase 6.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/notifications/sentinel-insight', () => ({ sendInsightAlert: vi.fn() }));
vi.mock('@/lib/storage/conversation-history', () => ({ listReports: vi.fn(() => []) }));

import { aggregatePillars } from '../service';
import { mesesCubiertos, periodsComparable } from '../shared-metrics';
import { buildFuturoBarSeries } from '../futuro-bars';
import { deriveSentinelMetrics } from '@/lib/workflows/sentinel/orchestrator';
import { runT2 } from '@/lib/workflows/sentinel/triggers/r2-shield-liquidity';
import { runT3 } from '@/lib/workflows/sentinel/triggers/r3-value-anomaly';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react/compose';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { CSV_NM_ANUAL, csvNmConPeriodo, preNm, stubReportNm } from './_fixture-nm';

type KpiLike = { key: string; value: number | null; descriptionEs: string };
const kpi = (ks: KpiLike[], key: string) => ks.find((k) => k.key === key)!;

function todo(pp: PreprocessedBalance) {
  const pillars = aggregatePillars({ snapshot: pp.primary, comparative: pp.comparative ?? undefined });
  const pdf = composeEditorialReport({ report: stubReportNm(), preprocessed: pp, pillars, language: 'es' });
  const sentinel = deriveSentinelMetrics(pp.primary, pillars);
  return { pillars, pdf, sentinel, ct: pp.primary.controlTotals };
}

// 200 M de efectivo / (1.855 M de egresos / 182,5 días)
const AUTONOMIA_6M = 200_000_000 / (1_855_000_000 / 182.5);

describe('NM-01 — corte trimestral "2025-Q2": misma base de 6 meses que el preprocesador', () => {
  const pp = preNm(csvNmConPeriodo('2025-Q2'));
  const { pillars, pdf, sentinel, ct } = todo(pp);

  it('shared-metrics lee los meses del preprocesador', () => {
    expect(ct.mesesPeriodo).toBe(6);
    expect(mesesCubiertos(pp.primary)).toBe(6);
    expect(periodsComparable(pp.primary, pp.comparative!)).toBe(false);
  });

  it('días de autonomía 19,68 en pilar, tarjeta, Sentinel y PDF; T2 crítico (< 30)', () => {
    expect(kpi(pillars.escudo.kpis, 'dias_autonomia').value).toBeCloseTo(AUTONOMIA_6M, 6);
    expect(pillars.escudo.escudoCards!.autonomia.value).toBeCloseTo(AUTONOMIA_6M, 6);
    expect(sentinel.diasAutonomia).toBeCloseTo(AUTONOMIA_6M, 6);
    expect(runT2(sentinel, { workspaceId: 'ws' }).insight?.severity).toBe('critico');
    expect(pdf.kpiGrid.kpis.find((k) => k.label === 'Días Autonomía')?.value).toBe('20 días');
  });

  it('crecimiento de ingresos N/D (6 meses contra 12): ni tarjeta ni PDF publican 6,1 %', () => {
    expect(pillars.futuro.futuroCards!.cagr.value).toBeNull();
    expect(pdf.kpiGrid.kpis.find((k) => k.label === 'Crecimiento Ingresos')).toBeUndefined();
  });

  it('punto de inflexión igual al del mismo corte rotulado "2025-06"', () => {
    const mes = preNm(csvNmConPeriodo('2025-06'));
    const pMes = aggregatePillars({ snapshot: mes.primary, comparative: mes.comparative ?? undefined });
    expect(kpi(pMes.futuro.kpis, 'punto_inflexion').value).toBe(6);
    expect(kpi(pillars.futuro.kpis, 'punto_inflexion').value).toBe(6);
  });

  it('ROE del pilar = ct.roe (19,19 %) y Sentinel días de inventario = ct (35,1)', () => {
    expect(ct.roe).toBeCloseTo(19.188, 3);
    expect(kpi(pillars.valor.kpis, 'roe_dinamico').value).toBeCloseTo(ct.roe! / 100, 12);
    expect(ct.diasInventario).toBeCloseTo(35.096, 3);
    expect(sentinel.diasInventario).toBeCloseTo(ct.diasInventario!, 12);
  });
});

describe('NM-01 — rango incompleto "2025-01-01..2025-06-15": todo N/D con motivo, como el preprocesador', () => {
  const pp = preNm(csvNmConPeriodo('2025-01-01..2025-06-15'));
  const { pillars, sentinel, ct } = todo(pp);

  it('el preprocesador no deriva meses', () => {
    expect(ct.mesesPeriodo).toBeNull();
    expect(ct.roe).toBeNull();
    expect(mesesCubiertos(pp.primary)).toBeNull();
  });

  it('días de autonomía N/D con motivo (pilar, tarjeta, Sentinel) — no 39,35', () => {
    const dias = kpi(pillars.escudo.kpis, 'dias_autonomia');
    expect(dias.value).toBeNull();
    expect(dias.descriptionEs).toMatch(/^N\/D — periodo parcial no anualizado/);
    expect(pillars.escudo.escudoCards!.autonomia.value).toBeNull();
    expect(pillars.escudo.escudoCards!.audit.promedioEgresosMensuales).toBeNull();
    expect(sentinel.diasAutonomia).toBeNull();
    expect(sentinel.diasInventario).toBeNull();
  });

  it('ROE del pilar N/D con el motivo del preprocesador — no 9,59 %', () => {
    const roe = kpi(pillars.valor.kpis, 'roe_dinamico');
    expect(roe.value).toBeNull();
    expect(roe.descriptionEs).toBe(ct.kpiNdMotivos!.roe);
  });

  it('runway, punto de inflexión, quiebre y serie proyectada N/D (sin flujo mensual)', () => {
    expect(kpi(pillars.futuro.kpis, 'runway_caja').value).toBeNull();
    expect(kpi(pillars.futuro.kpis, 'punto_inflexion').value).toBeNull();
    expect(kpi(pillars.futuro.kpis, 'punto_inflexion').descriptionEs).toMatch(/^N\/D/);
    const cards = pillars.futuro.futuroCards!;
    expect(cards.punto_quiebre.value).toBeNull();
    expect(cards.punto_quiebre.status).toBe('watch');
    expect(cards.punto_quiebre.descriptionEs).toMatch(/^N\/D/);
    expect(cards.audit.reserva60Dias).toBeNull();
    expect(cards.audit.cajaProyectada36mBase).toBeNull();
    expect(buildFuturoBarSeries(pp)).toEqual([]);
  });
});

describe('NM-02 — ROE Dinámico = ct.roe (anualizado × 12/meses)', () => {
  it('corte "2025-06": 19,19 % en el pilar, igual que el preprocesador y el PDF', () => {
    const pp = preNm(csvNmConPeriodo('2025-06'));
    const { pillars, pdf, ct } = todo(pp);
    expect(kpi(pillars.valor.kpis, 'roe_dinamico').value).toBeCloseTo(0.19188, 5);
    expect(kpi(pillars.valor.kpis, 'roe_dinamico').value).toBeCloseTo(ct.roe! / 100, 12);
    expect(pdf.kpiGrid.kpis.find((k) => k.label === 'ROE')?.value).toBe('19,2%');
  });
});

describe('NM-03 — un solo margen neto: la reclasificación R1 no toca el P&G', () => {
  it('sobregiro reclasificado por R1 (30 M): pilar = ct.margenNeto 3,39 %; el PDF imprime 3,4 % en ambos sitios', () => {
    const pp = preNm(CSV_NM_ANUAL);
    const { pillars, pdf, ct } = todo(pp);
    expect(pp.primary.reclassifications?.find((r) => r.applied)?.amountCop).toBe(30_000_000);
    const margen = kpi(pillars.valor.kpis, 'margen_neto_real');
    expect(margen.value).toBeCloseTo(ct.margenNeto! / 100, 12);
    expect(margen.value).toBeCloseTo(65 / 1_920, 12);
    expect(pdf.kpiGrid.kpis.find((k) => k.label === 'Margen Neto')?.value).toBe('3,4%');
    expect(pdf.pillars?.satellites.find((s) => s.label === 'Valor')?.topKpi).toBe('Margen Neto 3,4%');
  });
});

describe('NM-11 — Sentinel días de inventario con costos 6 + 7 (KPI del preprocesador)', () => {
  it('cierre anual: 250 / 1.300 × 365 = 70,19 (no 76,04 con sólo la clase 6)', () => {
    const { sentinel, ct } = todo(preNm(CSV_NM_ANUAL));
    expect(ct.diasInventario).toBeCloseTo(70.1923, 3);
    expect(sentinel.diasInventario).toBeCloseTo(70.1923, 3);
  });

  it('manufacturera (inventario 400 M, clase 6 380 M, clase 7 100 M): 304 días y T3 no dispara', () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja,Auxiliar,1,100000000',
      '130505,Clientes,Auxiliar,1,100000000',
      '143005,Productos terminados,Auxiliar,1,400000000',
      '220505,Proveedores,Auxiliar,1,100000000',
      '310505,Capital,Auxiliar,1,480000000',
      '413550,Ventas,Auxiliar,1,600000000',
      '613550,Costo de ventas,Auxiliar,1,380000000',
      '720505,Mano de obra directa,Auxiliar,1,100000000',
    ].join('\n');
    const pp = preNm(csv);
    const m = deriveSentinelMetrics(pp.primary, aggregatePillars({ snapshot: pp.primary }));
    expect(m.diasInventario).toBeCloseTo(304.1667, 3);
    expect(runT3(m, { workspaceId: 'ws' }).fired).toBe(false);
  });
});

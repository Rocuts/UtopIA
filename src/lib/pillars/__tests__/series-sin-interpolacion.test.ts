// ratios-kpis-20 — Con un solo periodo se fabricaban 12 meses: Escudo dividía
// saldos de cierre (caja 400M ⇒ 33M "por mes"), Verdad inventaba una tendencia
// descendente de errores y Valor una estacionalidad senoidal ±5 %.
import { describe, it, expect } from 'vitest';

import { buildEscudoBarSeries } from '../escudo-bars';
import { buildValorBarSeries } from '../valor-bars';
import { buildVerdadBarSeries } from '../verdad-bars';
import { computeEbitda } from '../ebitda';
import { makePnlSnapshot } from './_fixtures';
import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

function balanceOf(...periods: PeriodSnapshot[]): PreprocessedBalance {
  return {
    periods,
    primary: periods[periods.length - 1],
    comparative: periods.length > 1 ? periods[periods.length - 2] : null,
    rawRows: [],
    auxiliaryCount: 0,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: periods.length < 2,
    reclasificacionesNoCompensacion: [],
  };
}

describe('series temporales sólo con periodos reales', () => {
  it('Escudo con un periodo: un único punto con el saldo real (no 12 meses de caja/12)', () => {
    const snap = makePnlSnapshot();
    const s = buildEscudoBarSeries(balanceOf(snap));
    expect(s).toHaveLength(1);
    expect(s[0].efectivo).toBe(400_000_000);
    expect(s[0].isInterpolated).toBe(false);
  });

  it('Verdad con un periodo: sin tendencia descendente fabricada', () => {
    const s = buildVerdadBarSeries(balanceOf(makePnlSnapshot()));
    expect(s).toHaveLength(1);
    expect(s.every((p) => !p.isInterpolated)).toBe(true);
  });

  it('Valor con un periodo: EBITDA real, sin estacionalidad senoidal', () => {
    const snap = makePnlSnapshot();
    const s = buildValorBarSeries(balanceOf(snap));
    expect(s).toHaveLength(1);
    expect(s[0].ebitda).toBe(computeEbitda(snap).ebitda);
    expect(s[0].isInterpolated).toBe(false);
  });

  it('con varios periodos: un punto por periodo real', () => {
    const s = buildEscudoBarSeries(balanceOf(makePnlSnapshot('2025'), makePnlSnapshot('2026')));
    expect(s.map((p) => p.period)).toEqual(['2025', '2026']);
  });
});

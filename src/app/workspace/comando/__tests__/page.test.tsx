// W5-1 — Centro de Mando: el runway de caja y el Monte Carlo dividen flujos
// del periodo por los MESES CUBIERTOS (`mesesCubiertos`, fuente única NM-01).
// Sin duración derivable (rango incompleto, saldo de apertura) no hay flujo
// mensual verificable: runway vacío y sin Monte Carlo, nunca 12 meses
// supuestos (`monthsCovered` deprecado).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import {
  CSV_NM_ANUAL,
  csvNmConPeriodo,
  preNm,
} from '@/lib/pillars/__tests__/_fixture-nm';

const state = vi.hoisted(() => ({ balance: null as unknown }));
const monteCarloSpy = vi.hoisted(() => vi.fn(() => ({ stub: 'monte-carlo' })));

vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: vi.fn(async () => ({ id: 'ws-1' })),
}));
vi.mock('@/lib/cache/preprocessed-balance', () => ({
  getLatestOpenPeriod: vi.fn(async () => ({ id: 'p-1' })),
  findComparativePeriod: vi.fn(async () => null),
  getCachedPreprocessedBalance: vi.fn(async () => ({ balance: state.balance })),
}));
vi.mock('@/lib/pillars/monte-carlo', () => ({ runMonteCarlo: monteCarloSpy }));
vi.mock('@/components/workspace/pillars/PillarsCommandCenter', () => ({
  PillarsCommandCenter: () => null,
}));

import ComandoPage from '../page';

interface PageProps {
  demo?: boolean;
  runway?: unknown[];
  monteCarlo?: unknown;
}

async function renderProps(): Promise<PageProps> {
  const el = (await ComandoPage()) as ReactElement<PageProps>;
  return el.props;
}

describe('W5-1 — Centro de Mando con meses cubiertos', () => {
  beforeEach(() => {
    monteCarloSpy.mockClear();
  });

  it('periodo sin duración derivable ⇒ runway vacío y sin Monte Carlo', async () => {
    const pp = preNm(csvNmConPeriodo('2025-01-01..2025-06-15'));
    expect(pp.primary.controlTotals.mesesPeriodo).toBeNull();
    state.balance = pp;

    const props = await renderProps();
    expect(props.demo).toBe(false);
    expect(props.runway).toEqual([]);
    expect(props.monteCarlo).toBeUndefined();
    expect(monteCarloSpy).not.toHaveBeenCalled();
  });

  it('corte acumulado 2025-Q2 ⇒ flujo mensual sobre 6 meses, no 12', async () => {
    const pp = preNm(csvNmConPeriodo('2025-Q2'));
    const ct = pp.primary.controlTotals;
    expect(ct.mesesPeriodo).toBe(6);
    state.balance = pp;

    const props = await renderProps();
    const runway = props.runway as Array<{ base: number }>;
    expect(runway).toHaveLength(36);
    const flujoMes = ((ct.ingresosNetos ?? ct.ingresos) - ct.gastos) / 6;
    expect(runway[0].base).toBe(ct.efectivoCuenta11);
    expect(runway[1].base - runway[0].base).toBeCloseTo(flujoMes, 2);
    expect(monteCarloSpy).toHaveBeenCalledTimes(1);
    expect(props.monteCarlo).toEqual({ stub: 'monte-carlo' });
  });

  it('cierre anual ⇒ 12 meses cubiertos y Monte Carlo disponible', async () => {
    const pp = preNm(CSV_NM_ANUAL);
    expect(pp.primary.controlTotals.mesesPeriodo).toBe(12);
    state.balance = pp;

    const props = await renderProps();
    expect(props.runway).toHaveLength(36);
    expect(monteCarloSpy).toHaveBeenCalledTimes(1);
  });
});

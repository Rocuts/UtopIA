// IW4 (ratios-kpis-04) — Sentinel calculaba el margen bruto como
// 1 − clase 6 / Σ clase 4: las devoluciones 4175 exportadas con el signo de
// las ventas y el grupo 42 inflaban el margen (y el disparador T3 > 90 %).
// Ahora usa la misma definición que el pilar Verdad: (41 − 4175 − clases 6 y
// 7) / (41 − 4175).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/notifications/sentinel-insight', () => ({ sendInsightAlert: vi.fn() }));

import { deriveSentinelMetrics } from '../orchestrator';
import { aggregatePillars } from '@/lib/pillars/service';
import { makePnlSnapshot } from '@/lib/pillars/__tests__/_fixtures';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

describe('Sentinel — métricas derivadas', () => {
  it('margen bruto sobre ingresos operacionales netos, no sobre la Σ de la clase 4', () => {
    const snap = makePnlSnapshot();
    const m = deriveSentinelMetrics(snap, aggregatePillars({ snapshot: snap }));
    // 41 − 4175 = 1.920M; clases 6 + 7 = 1.200M ⇒ 37,5 % (antes 1 − 1.100/2.280 = 51,8 %).
    expect(m.margenBruto).toBeCloseTo((1_920 - 1_200) / 1_920, 10);
  });

  // W4-C (NM-11): antes esta prueba fijaba el cálculo propio de Sentinel con
  // SÓLO la clase 6 sobre un snapshot armado a mano. La definición única es el
  // KPI del preprocesador (inventario / costos 6 + 7 anualizados × 365).
  it('días de inventario = KPI del preprocesador (costos 6 + 7, acumulado YYYY-MM anualizado)', () => {
    const pp = preprocessTrialBalance(
      parseTrialBalanceCSV(
        [
          'codigo,nombre,nivel,transaccional,Saldo [2026-06]',
          '110505,Caja,Auxiliar,1,100000000',
          '143505,Mercancias,Auxiliar,1,200000000',
          '310505,Capital,Auxiliar,1,300000000',
          '413505,Ventas,Auxiliar,1,2000000000',
          '613505,Costo de ventas,Auxiliar,1,1100000000',
          '720505,Mano de obra directa,Auxiliar,1,100000000',
          '510506,Sueldos,Auxiliar,1,500000000',
        ].join('\n'),
      ),
    );
    const snap = pp.primary;
    const m = deriveSentinelMetrics(snap, aggregatePillars({ snapshot: snap }));
    // Inventario 200M; costos 6 + 7 de 6 meses = 1.200M ⇒ 200M / (1.200M × 2) × 365.
    expect(snap.controlTotals.diasInventario).toBeCloseTo((200 / 2_400) * 365, 6);
    expect(m.diasInventario).toBeCloseTo(snap.controlTotals.diasInventario!, 12);
  });

  it('snapshot sin el KPI del preprocesador ⇒ días de inventario N/D (sin recálculo propio)', () => {
    const snap = makePnlSnapshot('2026-06');
    const m = deriveSentinelMetrics(snap, aggregatePillars({ snapshot: snap }));
    expect(m.diasInventario).toBeNull();
  });
});

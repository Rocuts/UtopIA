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

describe('Sentinel — métricas derivadas', () => {
  it('margen bruto sobre ingresos operacionales netos, no sobre la Σ de la clase 4', () => {
    const snap = makePnlSnapshot();
    const m = deriveSentinelMetrics(snap, aggregatePillars({ snapshot: snap }));
    // 41 − 4175 = 1.920M; clases 6 + 7 = 1.200M ⇒ 37,5 % (antes 1 − 1.100/2.280 = 51,8 %).
    expect(m.margenBruto).toBeCloseTo((1_920 - 1_200) / 1_920, 10);
  });

  it('días de inventario con los días que cubre el periodo (acumulado YYYY-MM)', () => {
    const snap = makePnlSnapshot('2026-06');
    const m = deriveSentinelMetrics(snap, aggregatePillars({ snapshot: snap }));
    // Inventario 200M; costo clase 6 de 6 meses = 1.100M ⇒ 1.100M / 182,5 días.
    expect(m.diasInventario).toBeCloseTo(200_000_000 / (1_100_000_000 / 182.5), 6);
  });
});

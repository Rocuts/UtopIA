// ratios-kpis-13 — Puente P&L del Centro de Mando sin doble conteo.
// ratios-kpis-06 — Con datos reales no se muestran segmentos DuPont ni series
// del mockup.
import { describe, it, expect } from 'vitest';

import { buildPnlBridge } from '../pnl-bridge';
import { makePnlSnapshot } from './_fixtures';
import { resolveCommandCenterData } from '@/components/workspace/pillars/PillarsCommandCenter';
import { MOCK_DUPONT_SEGMENTS, MOCK_PILLARS } from '@/components/workspace/pillars/mock-data';

describe('ratios-kpis-13 — puente P&L', () => {
  it('bloques disjuntos que cierran al centavo contra la utilidad neta', () => {
    const b = buildPnlBridge(makePnlSnapshot())!;
    expect(b).not.toBeNull();
    expect(b.ingresos).toBe(2_120_000_000); // netos de 4175, incluye 42
    expect(b.costos).toBe(1_200_000_000); // 6 + 7
    expect(b.gastosOperacionales).toBe(450_000_000); // 51 + 52
    expect(b.gastosFinancieros).toBe(30_000_000); // 53 una sola vez
    expect(b.impuestos).toBe(95_000_000); // grupo 54, no el saldo del pasivo 24 (135M)
    expect(
      b.ingresos - b.costos - b.gastosOperacionales - b.gastosFinancieros - b.impuestos,
    ).toBe(b.utilidadNeta);
    expect(b.utilidadNeta).toBe(345_000_000);
  });

  it('si los bloques no cierran contra la utilidad neta, no se pinta (null)', () => {
    const snap = makePnlSnapshot();
    snap.controlTotals.utilidadNeta = 400_000_000;
    expect(buildPnlBridge(snap)).toBeNull();
  });
});

describe('ratios-kpis-06 — Centro de Mando con datos reales', () => {
  it('demo=false sin segmentos ⇒ sin treemap DuPont ni series del mockup', () => {
    const d = resolveCommandCenterData({ pillars: MOCK_PILLARS, demo: false });
    expect(d.isDemo).toBe(false);
    expect(d.segments).toEqual([]);
    expect(d.pnlBridge).toBeUndefined();
    expect(d.inflectionSeries).toEqual([]);
    expect(d.runway).toEqual([]);
    expect(d.liquidity).toBeUndefined();
    expect(d.valorTrend).toEqual([]);
    expect(d.escudoTrend).toEqual([]);
    expect(d.verdadTrend).toEqual([]);
    expect(d.futuroTrend).toEqual([]);
    expect(JSON.stringify(d)).not.toContain('Línea Premium');
  });

  it('en modo demo (sin datos) sí usa las maquetas, rotuladas como Demo', () => {
    const d = resolveCommandCenterData({});
    expect(d.isDemo).toBe(true);
    expect(d.segments).toBe(MOCK_DUPONT_SEGMENTS);
  });
});

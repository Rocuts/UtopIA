// ---------------------------------------------------------------------------
// revenueBreakdown — prefiere el ancla del preprocesador (IW2, ratios-kpis-04)
// ---------------------------------------------------------------------------
// Desde WP04 `controlTotals.ingresosOperacionalesNetos` (41 − 4175) es un
// campo propio del preprocesador. Los entregables lo recomponían desde las
// hojas de la clase 4 con la misma fórmula; ahora leen el ancla, y sólo sin
// ella recomponen o caen a los renglones 41xx del ERI.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { revenueBreakdown } from '@/lib/export/revenue';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type ControlTotals,
} from '@/lib/preprocessing/trial-balance';

describe('revenueBreakdown — ingresos operacionales del preprocesador', () => {
  it('snapshot con clases: usa controlTotals.ingresosOperacionalesNetos', () => {
    const snap = preprocessTrialBalance(
      parseTrialBalanceCSV(
        [
          'codigo,nombre,nivel,transaccional,Saldo 2025',
          '110505,Caja,Auxiliar,1,1050000000',
          '311505,Aportes,Auxiliar,1,1050000000',
          '413505,Ventas,Auxiliar,1,1000000000',
          '417505,Devoluciones,Auxiliar,1,-50000000',
          '421005,Intereses,Auxiliar,1,100000000',
        ].join('\n'),
      ),
    ).primary;
    const r = revenueBreakdown(snap);
    expect(r.operacionalesNetos).toBe(snap.controlTotals.ingresosOperacionalesNetos);
    expect(r.operacionalesNetos).toBe(950_000_000);
    expect(r.noOperacionales).toBe(100_000_000);
    expect(r.source).toBe('control-totals');
  });

  it('snapshot sin clases (sólo anclas): el ancla basta, no queda N/D', () => {
    const controlTotals = {
      ingresosNetos: 1_050_000_000,
      ingresosOperacionalesNetos: 950_000_000,
    } as unknown as ControlTotals;
    const r = revenueBreakdown({ controlTotals });
    expect(r.operacionalesNetos).toBe(950_000_000);
    expect(r.netosTotales).toBe(1_050_000_000);
    expect(r.source).toBe('control-totals');
  });

  it('clase 4 vacía en el snapshot: no convierte el ancla 0 en "ingresos $0" (sigue N/D)', () => {
    const controlTotals = {
      ingresosNetos: 0,
      ingresosOperacionalesNetos: 0,
    } as unknown as ControlTotals;
    const r = revenueBreakdown({ controlTotals, classes: [] });
    expect(r.operacionalesNetos).toBeNull();
    expect(r.source).toBeNull();
  });
});

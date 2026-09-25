// W3-C (ratios-kpis-04, opcional de IW4) — el preprocesador expone los
// ingresos operacionales netos (41 − 4175) en centavos exactos
// (`controlTotals.cents.ingresosOperacionalesNetos`) y el puente P&G del
// Centro de Mando los usa en lugar de recomponer los centavos desde pesos.
import { describe, expect, it } from 'vitest';

import { preprocessTrialBalance, type RawAccountRow } from '@/lib/preprocessing/trial-balance';
import { buildPnlBridge } from '../pnl-bridge';
import { makePnlSnapshot } from './_fixtures';

const row = (code: string, balance: number): RawAccountRow => ({
  code,
  name: code,
  level: code.length >= 6 ? 'Subcuenta' : 'Cuenta',
  transactional: code.length >= 6,
  balancesByPeriod: { '2026': balance },
});

describe('cents.ingresosOperacionalesNetos', () => {
  it('el preprocesador lo publica exacto: 41 − 4175 (sin el grupo 42)', () => {
    const pp = preprocessTrialBalance([
      row('110505', 1_150_000.05),
      row('310505', 100_000),
      row('413505', 1_000_000.1),
      row('417505', 100_000.05),
      row('421005', 50_000),
      row('510506', 100_000),
    ]);
    const ct = pp.primary.controlTotals;
    expect(ct.cents?.ingresosOperacionalesNetos).toBe(BigInt(90_000_005));
    expect(Number(ct.cents!.ingresosOperacionalesNetos) / 100).toBe(ct.ingresosOperacionalesNetos);
  });

  it('el puente P&G toma la barra inicial de los centavos, no de pesos redondeados', () => {
    const base = makePnlSnapshot();
    const snap = {
      ...base,
      controlTotals: {
        ...base.controlTotals,
        // Ancla en pesos con deriva de coma flotante (no es un valor en centavos).
        ingresosOperacionalesNetos: 1_920_000_000.006,
        cents: {
          ...(base.controlTotals.cents ?? {}),
          ingresosNetos: BigInt(212_000_000_000),
          utilidadNeta: BigInt(34_500_000_000),
          ingresosOperacionalesNetos: BigInt(192_000_000_000),
        } as NonNullable<typeof base.controlTotals.cents>,
      },
    };
    const b = buildPnlBridge(snap)!;
    expect(b).not.toBeNull();
    expect(b.ingresos).toBe(1_920_000_000);
    expect(b.otrosIngresos).toBe(200_000_000);
  });

  it('sin el campo en centavos (constructores anteriores) sigue usando el ancla en pesos', () => {
    const b = buildPnlBridge(makePnlSnapshot())!;
    expect(b.ingresos).toBe(1_920_000_000);
    expect(b.otrosIngresos).toBe(200_000_000);
  });
});

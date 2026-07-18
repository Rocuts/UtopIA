// ---------------------------------------------------------------------------
// Regresión wave-8 P0: F01 debe ser UAI, NO utilidad neta.
//
// El fixture grupo-2tres tiene Clase 54 = $0, donde UAI === utilidadNeta y un
// bug de campo origen quedaría ENMASCARADO. Este test fija el contrato con
// impuesto causado ≠ 0, donde ambas magnitudes difieren:
//
//   UAI            = 4.000.000,00  (F01 — base Art. 26 + 240 E.T.)
//   impuesto (54)  = 1.500.000,00
//   utilidadNeta   = 2.500.000,00  (≠ F01 — la trampa)
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { deriveFiscalAnchorMetrics } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/calculator';
import type { FiscalRawBase } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/internal-types';

const UAI_CENTS = BigInt('400000000'); // $4.000.000,00
const IMPUESTO_CENTS = BigInt('150000000'); // $1.500.000,00 (Clase 54 ≠ 0)
const UTILIDAD_NETA_CENTS = UAI_CENTS - IMPUESTO_CENTS; // $2.500.000,00

const RAW: FiscalRawBase = {
  retencionesAFavorCents: BigInt('20000000'), // $200.000,00
  ivaPorPagarCents: BigInt(0),
  reteFuentePorPagarCents: BigInt(0),
  icaPorPagarCents: BigInt(0),
  totalPasivosFiscalesCents: BigInt(0),
};

describe('fiscal-anchor calculator — Clase 54 ≠ 0 (F01 = UAI, nunca utilidad neta)', () => {
  const metrics = deriveFiscalAnchorMetrics({
    uaiCents: UAI_CENTS,
    impuestoCausadoCents: IMPUESTO_CENTS,
    raw: RAW,
  });

  it('F01 es exactamente la UAI de entrada', () => {
    expect(metrics.f01Cents).toBe(UAI_CENTS);
  });

  it('F01 NO es la utilidad neta (la trampa que Clase 54 = 0 enmascara)', () => {
    expect(metrics.f01Cents).not.toBe(UTILIDAD_NETA_CENTS);
  });

  it('F02 = 35% de la UAI (Art. 240 E.T.), no 35% de la utilidad neta', () => {
    expect(metrics.f02Cents).toBe((UAI_CENTS * BigInt(35)) / BigInt(100)); // $1.400.000,00
    expect(metrics.f02Cents).not.toBe((UTILIDAD_NETA_CENTS * BigInt(35)) / BigInt(100));
  });

  it('F04 = F02 − retenciones a favor', () => {
    expect(metrics.f04Cents).toBe(metrics.f02Cents - RAW.retencionesAFavorCents);
  });

  it('F09 = impuestoCausado / UAI con 1 decimal (37,5%)', () => {
    // 1.500.000 / 4.000.000 = 37,5% — si F01 fuera utilidad neta daría 60,0%.
    expect(metrics.f09Pct).toBe(37.5);
  });

  it('F10 = retenciones / F02 con 1 decimal', () => {
    // 200.000 / 1.400.000 = 14,3%
    expect(metrics.f10Pct).toBe(14.3);
  });
});

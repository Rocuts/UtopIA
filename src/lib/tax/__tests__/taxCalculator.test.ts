import { describe, expect, it } from 'vitest';

import {
  RENTA_EXENTA_UVT,
  TOPE_SIMPLE_UVT,
  UMBRAL_NO_RESPONSABLE_IVA_UVT,
  UVT_2026,
  compare,
  computeOrdinario,
  computeRST,
  semaforoResponsabilidadIvaInc,
  semaforoTopeSimple,
  topeOrdinario,
  topeSimple,
  umbralNoResponsableIvaInc,
  uvt,
} from '@/lib/tax/taxCalculator';

describe('taxCalculator — constantes y conversiones', () => {
  it('tope del SIMPLE = 100.000 UVT = $5.237.400.000 (Art. 905 num. 2 E.T.)', () => {
    expect(topeSimple()).toBe(TOPE_SIMPLE_UVT * UVT_2026);
    expect(topeSimple()).toBe(5_237_400_000);
  });

  it('umbral de no-responsable de IVA/INC = 3.500 UVT = $183.309.000 (Art. 437 par. 3 E.T.)', () => {
    expect(umbralNoResponsableIvaInc()).toBe(UMBRAL_NO_RESPONSABLE_IVA_UVT * UVT_2026);
    expect(umbralNoResponsableIvaInc()).toBe(183_309_000);
  });

  it('umbral para declarar renta = 1.400 UVT = $73.323.600 (Art. 592 num. 1 E.T.)', () => {
    expect(topeOrdinario()).toBe(73_323_600);
  });

  it('uvt() convierte COP a UVT 2026', () => {
    expect(uvt(UVT_2026)).toBe(1);
    expect(uvt(UVT_2026 * 6000)).toBe(6000);
  });
});

describe('computeRST — tarifas por tramo UVT (Art. 908 E.T.)', () => {
  it('aplica la tarifa del primer tramo (≤6.000 UVT) para tiendas: 1,2%', () => {
    const sales = 100_000_000; // ≈ 1.909 UVT
    expect(computeRST(sales, 'tiendas')).toBeCloseTo(sales * 0.012, 6);
  });

  it('aplica 5,6% en el tramo 30.000–100.000 UVT para tiendas', () => {
    const sales = UVT_2026 * 40_000;
    expect(computeRST(sales, 'tiendas')).toBeCloseTo(sales * 0.056, 6);
  });

  it('el descuento por aportes a pensión NO puede llevar el impuesto a cero (Art. 903 par. 4 E.T.)', () => {
    const sales = 10_000_000;
    const bruto = sales * 0.012;
    // Sin el componente de ICA consolidado del municipio el descuento no se aplica.
    expect(computeRST(sales, 'tiendas', 50_000)).toBeCloseTo(bruto, 6);
    // Con el componente conocido, el piso es el ICA consolidado.
    expect(computeRST(sales, 'tiendas', 10_000_000, 0.004)).toBeCloseTo(sales * 0.004, 6);
  });

  it('servicios profesionales tributa más que tiendas a igual venta', () => {
    const sales = 80_000_000;
    expect(computeRST(sales, 'servicios')).toBeGreaterThan(computeRST(sales, 'tiendas'));
  });
});

describe('computeOrdinario — renta + ICA municipal (sin IVA)', () => {
  it('renta = 0 cuando la utilidad no supera la renta exenta (Art. 241 E.T.)', () => {
    const sales = (RENTA_EXENTA_UVT * UVT_2026) / 0.35 - 1_000_000;
    const r = computeOrdinario(sales, { icaRate: 0.0069 });
    expect(r.renta).toBe(0);
    expect(r.total).toBeCloseTo(r.ica ?? 0, 6);
  });

  it('desglosa total = ica + renta', () => {
    // $200M de ventas → utilidad 35% = $70M ≈ 1.336 UVT > 1.090 UVT exentas
    const r = computeOrdinario(200_000_000, { icaRate: 0.0069 });
    expect(r.total).toBeCloseTo((r.ica ?? 0) + r.renta, 6);
    expect(r.renta).toBeGreaterThan(0);
  });
});

describe('semáforos — dos umbrales normativos distintos', () => {
  it('pertenencia al SIMPLE: verde muy por debajo de 100.000 UVT', () => {
    expect(semaforoTopeSimple(98_000_000).level).toBe('verde');
    expect(semaforoTopeSimple(topeSimple() * 0.9).level).toBe('amarillo');
    expect(semaforoTopeSimple(topeSimple() * 1.01).level).toBe('rojo');
  });

  it('responsabilidad de IVA/INC: se mide contra 3.500 UVT', () => {
    expect(semaforoResponsabilidadIvaInc(98_000_000).level).toBe('verde');
    expect(semaforoResponsabilidadIvaInc(umbralNoResponsableIvaInc() * 0.9).level).toBe('amarillo');
    expect(semaforoResponsabilidadIvaInc(umbralNoResponsableIvaInc() * 1.01).level).toBe('rojo');
  });
});

describe('compare — SIMPLE vs Ordinario', () => {
  it('sin tarifa de ICA municipal no emite recomendación', () => {
    const r = compare(1_500_000 * 12, { group: 'tiendas' });
    expect(r.recommended).toBeNull();
    expect(r.comparable).toBe(false);
  });

  it('tendero ~$8,2M/mes con ICA municipal conocido', () => {
    const r = compare(97_992_000, { group: 'tiendas', icaRate: 0.0069 });
    expect(r.rst).toBeCloseTo(97_992_000 * 0.012, 6);
    expect(r.comparable).toBe(true);
    expect(r.semaforo.level).toBe('verde'); // lejos de las 100.000 UVT
    expect(r.semaforoIvaInc.level).toBe('verde'); // por debajo de 3.500 UVT
  });

  it('savings = |ordinario − rst| cuando la comparación es válida', () => {
    const r = compare(60_000_000, { group: 'servicios', icaRate: 0.0069 });
    expect(r.savings).toBeCloseTo(Math.abs(r.ordinario - r.rst), 6);
  });
});

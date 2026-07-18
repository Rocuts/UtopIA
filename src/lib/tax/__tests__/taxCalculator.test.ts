import { describe, expect, it } from 'vitest';

import {
  RENTA_EXENTA_UVT,
  TOPE_RST_UVT,
  UVT_2026,
  compare,
  computeOrdinario,
  computeRST,
  semaforo,
  topeOrdinario,
  topeRST,
  uvt,
} from '@/lib/tax/taxCalculator';

describe('taxCalculator — constantes y conversiones', () => {
  it('tope RST = 3.500 UVT = $183.309.000', () => {
    expect(topeRST()).toBe(TOPE_RST_UVT * UVT_2026);
    expect(topeRST()).toBe(183_309_000);
  });

  it('tope ordinario = 1.400 UVT = $73.323.600', () => {
    expect(topeOrdinario()).toBe(73_323_600);
  });

  it('uvt() convierte COP a UVT 2026', () => {
    expect(uvt(UVT_2026)).toBe(1);
    expect(uvt(UVT_2026 * 6000)).toBe(6000);
  });
});

describe('computeRST — tarifas por tramo UVT', () => {
  it('aplica la tarifa del primer tramo (≤6.000 UVT) para tiendas', () => {
    const sales = 100_000_000; // ≈ 1.909 UVT
    expect(computeRST(sales, 'tiendas')).toBeCloseTo(sales * 0.0188, 6);
  });

  it('aplica la tarifa del último tramo por encima de 30.000 UVT', () => {
    const sales = UVT_2026 * 40_000;
    expect(computeRST(sales, 'tiendas')).toBeCloseTo(sales * 0.034, 6);
  });

  it('descuenta aportes a pensión sin bajar de cero', () => {
    const sales = 10_000_000;
    const bruto = sales * 0.0188;
    expect(computeRST(sales, 'tiendas', 50_000)).toBeCloseTo(bruto - 50_000, 6);
    expect(computeRST(sales, 'tiendas', 10_000_000)).toBe(0);
  });

  it('servicios tributa más que tiendas a igual venta', () => {
    const sales = 80_000_000;
    expect(computeRST(sales, 'servicios')).toBeGreaterThan(computeRST(sales, 'tiendas'));
  });
});

describe('computeOrdinario — renta + ICA + IVA neto', () => {
  it('renta = 0 cuando la utilidad no supera la renta exenta (Art. 241)', () => {
    const sales = (RENTA_EXENTA_UVT * UVT_2026) / 0.35 - 1_000_000;
    const r = computeOrdinario(sales);
    expect(r.renta).toBe(0);
    expect(r.total).toBeCloseTo(r.ica + r.iva, 6);
  });

  it('desglosa total = ica + renta + iva', () => {
    // $200M de ventas → utilidad 35% = $70M ≈ 1.336 UVT > 1.090 UVT exentas
    const r = computeOrdinario(200_000_000);
    expect(r.total).toBeCloseTo(r.ica + r.renta + r.iva, 6);
    expect(r.renta).toBeGreaterThan(0);
  });
});

describe('semaforo — umbrales 80% / 100% del tope', () => {
  it('verde para $98M de $183M de tope', () => {
    expect(semaforo(98_000_000).level).toBe('verde');
  });

  it('amarillo entre el 80% y el 100% del tope', () => {
    expect(semaforo(topeRST() * 0.9).level).toBe('amarillo');
  });

  it('rojo por encima del tope', () => {
    expect(semaforo(topeRST() * 1.01).level).toBe('rojo');
  });
});

describe('compare — RST vs Ordinario', () => {
  it('RST conviene para tendero ~$1.5M/mes', () => {
    const r = compare(1_500_000 * 12, { group: 'tiendas' });
    expect(r.recommended).toBe('RST');
  });

  it('reproduce el ejemplo del handoff ($97.992.000/año)', () => {
    const r = compare(97_992_000, { group: 'tiendas' });
    expect(r.rst).toBeCloseTo(1_842_250, 0);
    expect(r.ordinario).toBeCloseTo(2_612_467, 0);
    expect(r.savings).toBeCloseTo(770_217, 0);
    expect(r.recommended).toBe('RST');
    expect(r.semaforo.level).toBe('verde');
  });

  it('savings = |ordinario − rst|', () => {
    const r = compare(60_000_000, { group: 'servicios' });
    expect(r.savings).toBeCloseTo(Math.abs(r.ordinario - r.rst), 6);
  });
});

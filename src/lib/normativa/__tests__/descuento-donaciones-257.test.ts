import { describe, expect, it } from 'vitest';
import { resolveRule } from '../rules-registry';
import {
  art257Params,
  computeCredito257,
  computeDescuentoAplicado257,
} from '../descuento-donaciones-257';

describe('art257Params', () => {
  it('extrae tasa y tope del rule 2023', () => {
    const rule = resolveRule('descuento_donaciones_257', '2026');
    expect(art257Params(rule)).toEqual({ tasaDescuentoPct: 25, limitePctImpuesto: 25 });
    expect(rule.version).toBe('2023');
  });
  it('lanza si falta un param numérico', () => {
    const bad = { ...resolveRule('descuento_donaciones_257', '2026'), params: { limitePctImpuesto: 25 } };
    expect(() => art257Params(bad)).toThrow(/tasaDescuentoPct/);
  });
});

describe('computeCredito257', () => {
  it('crédito = 25% del valor donado', () => {
    expect(computeCredito257('5000000000', 25)).toBe('1250000000'); // $50M → $12.5M
  });
});

describe('computeDescuentoAplicado257', () => {
  it('el tope NO limita cuando el crédito es menor', () => {
    // crédito 1.25e9 ; impuesto 10e9 → tope 25% = 2.5e9 ; descuento = min(1.25e9, 2.5e9) = 1.25e9
    expect(
      computeDescuentoAplicado257({ creditoCents: '1250000000', impuestoBaseCents: '10000000000', limitePctImpuesto: 25 }),
    ).toEqual({ limiteCents: '2500000000', descuentoCents: '1250000000', impuestoNetoCents: '8750000000' });
  });
  it('el tope LIMITA cuando el crédito excede 25% del impuesto', () => {
    // crédito 1.25e9 ; impuesto 4e9 → tope 25% = 1e9 ; descuento = min(1.25e9, 1e9) = 1e9
    expect(
      computeDescuentoAplicado257({ creditoCents: '1250000000', impuestoBaseCents: '4000000000', limitePctImpuesto: 25 }),
    ).toEqual({ limiteCents: '1000000000', descuentoCents: '1000000000', impuestoNetoCents: '3000000000' });
  });
});

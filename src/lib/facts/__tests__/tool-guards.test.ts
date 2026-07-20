import { describe, expect, it } from 'vitest';
import { assertFactInputValid } from '../tool-guards';
import type { RegistrarHechoInput } from '../contracts';

const donation = (fiscalPeriod: string | null): RegistrarHechoInput => ({
  kind: 'donation',
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
  fiscalPeriod,
});

const narrative = (fiscalPeriod: string | null): RegistrarHechoInput => ({
  kind: 'narrative',
  title: 'Reestructuración',
  body: 'Estamos reestructurando facturas.',
  structured: null,
  fiscalPeriod,
});

describe('assertFactInputValid', () => {
  it('acepta donation con fiscalPeriod', () => {
    expect(assertFactInputValid(donation('2026'))).toBeNull();
  });

  it('RECHAZA donation con fiscalPeriod nulo (kind material)', () => {
    const err = assertFactInputValid(donation(null));
    expect(err).toMatch(/fiscalPeriod/);
  });

  it('acepta narrative sin fiscalPeriod', () => {
    expect(assertFactInputValid(narrative(null))).toBeNull();
  });

  it('RECHAZA donation sin structured', () => {
    const bad = { ...donation('2026'), structured: null } as RegistrarHechoInput;
    expect(assertFactInputValid(bad)).toMatch(/structured/);
  });

  it('RECHAZA donation con monto cero', () => {
    const bad: RegistrarHechoInput = {
      ...donation('2026'),
      structured: { montoCentavos: '0', articulo: '257', fiscalYear: '2026' },
    };
    expect(assertFactInputValid(bad)).toMatch(/monto/);
  });

  it('RECHAZA donation con monto negativo', () => {
    const bad: RegistrarHechoInput = {
      ...donation('2026'),
      structured: { montoCentavos: '-100', articulo: '257', fiscalYear: '2026' },
    };
    expect(assertFactInputValid(bad)).toMatch(/monto/);
  });

  it('acepta donation con monto positivo', () => {
    expect(assertFactInputValid(donation('2026'))).toBeNull(); // '5000000000' > 0
  });
});

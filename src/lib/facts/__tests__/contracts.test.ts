import { describe, expect, it } from 'vitest';
import { registrarHechoInputSchema } from '../contracts';

describe('registrarHechoInputSchema', () => {
  it('acepta un hecho narrativo con structured null', () => {
    const parsed = registrarHechoInputSchema.parse({
      kind: 'narrative',
      title: 'Reestructuración de facturas',
      body: 'Estamos reestructurando facturas para donar a la fundación X.',
      structured: null,
      fiscalPeriod: '2026',
    });
    expect(parsed.kind).toBe('narrative');
    expect(parsed.structured).toBeNull();
  });

  it('acepta una donación con structured tipado y monto MoneyCop', () => {
    const parsed = registrarHechoInputSchema.parse({
      kind: 'donation',
      title: 'Donación fundación X',
      body: 'Donación de 50 millones a la fundación X.',
      structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
      fiscalPeriod: '2026',
    });
    expect(parsed.structured?.montoCentavos).toBe('5000000000');
  });

  it('rechaza montoCentavos no entero', () => {
    const r = registrarHechoInputSchema.safeParse({
      kind: 'donation',
      title: 'x',
      body: 'y',
      structured: { montoCentavos: '50.5', articulo: '257', fiscalYear: '2026' },
      fiscalPeriod: '2026',
    });
    expect(r.success).toBe(false);
  });
});

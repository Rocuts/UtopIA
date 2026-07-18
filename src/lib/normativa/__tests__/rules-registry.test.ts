// src/lib/normativa/__tests__/rules-registry.test.ts
import { describe, expect, it } from 'vitest';
import { resolveRule } from '../rules-registry';

describe('resolveRule', () => {
  it('resuelve la versión vigente de Art. 257 para 2026', () => {
    const r = resolveRule('descuento_donaciones_257', '2026');
    expect(r.params.limitePctImpuesto).toBe(25);
    expect(r.params.articulo).toBe('257 E.T.');
  });

  it('FAIL-LOUD: lanza para un período ANTERIOR a toda vigencia (pre-desde)', () => {
    expect(() => resolveRule('descuento_donaciones_257', '2020')).toThrow(
      /No hay regla vigente/,
    );
  });

  it('FAIL-LOUD: lanza para una ruleKey desconocida', () => {
    expect(() => resolveRule('regla_inexistente', '2026')).toThrow(/desconocida/);
  });

  it('SUPERSESSION: resuelve un año futuro con vigencia abierta (hasta null)', () => {
    // Con `hasta: null` la regla rige indefinidamente hasta que una versión más
    // nueva la sustituya. `revisadoPara` es metadata asesora, NO un techo de
    // resolución — por eso 2099 devuelve la regla en lugar de lanzar.
    const r = resolveRule('descuento_donaciones_257', '2099');
    expect(r.params.limitePctImpuesto).toBe(25);
    expect(r.params.articulo).toBe('257 E.T.');
  });
});

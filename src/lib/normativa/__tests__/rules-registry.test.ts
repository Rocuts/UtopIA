// src/lib/normativa/__tests__/rules-registry.test.ts
import { describe, expect, it } from 'vitest';
import { resolveRule, type NormativeRuleVersion } from '../rules-registry';

function version(desde: string, hasta: string | null, tag: string): NormativeRuleVersion {
  return { vigencia: { desde, hasta }, version: tag, params: { tag }, fuente: 'fixture', revisadoPara: '2026' };
}

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

  it('NEWEST-WINS: ante versiones solapadas gana la de mayor `desde` (indep. del orden)', () => {
    const vieja = version('2023-01-01', null, 'vieja');
    const nueva = version('2026-01-01', null, 'nueva');
    // Ambas vigentes en 2027 (hasta null). Debe ganar la de `desde` mayor.
    expect(resolveRule('k', '2027', { k: [vieja, nueva] }).params.tag).toBe('nueva');
    expect(resolveRule('k', '2027', { k: [nueva, vieja] }).params.tag).toBe('nueva');
  });

  it('VENTANA CERRADA: resuelve dentro de [desde,hasta] y falla-fuerte después', () => {
    const cerrada = version('2020-01-01', '2021-12-31', 'v2020');
    expect(resolveRule('k', '2021', { k: [cerrada] }).version).toBe('v2020');
    expect(() => resolveRule('k', '2022', { k: [cerrada] })).toThrow(/No hay regla vigente/);
  });
});

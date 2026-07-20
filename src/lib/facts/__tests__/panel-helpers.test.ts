import { describe, expect, it } from 'vitest';
import {
  pesosToCentavos,
  centavosToPesos,
  centavosToDisplay,
  donationSummary,
  buildRegistrarInput,
  factToFormState,
  versionHistoryFor,
  type FactFormState,
} from '../panel-helpers';
import type { FactDTO } from '../dto';

const dto = (over: Partial<FactDTO>): FactDTO => ({
  id: 'x', kind: 'donation', title: 't', body: 'b',
  structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
  fiscalPeriod: '2026', status: 'active', supersededById: null, source: 'manual',
  createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z', revokedAt: null,
  ...over,
});

describe('dinero MoneyCop', () => {
  it('pesos → centavos (×100, sin overflow)', () => {
    expect(pesosToCentavos('50000000')).toBe('5000000000');
    expect(pesosToCentavos('0')).toBe('0');
    expect(pesosToCentavos(' 1.234.567 ')).toBe('123456700'); // tolera separadores/espacios
  });
  it('centavos → pesos (parte entera)', () => {
    expect(centavosToPesos('5000000000')).toBe('50000000');
    expect(centavosToPesos('5000000050')).toBe('50000000'); // trunca centavos residuales
  });
  it('centavos → display COP con separador de miles y decimales', () => {
    expect(centavosToDisplay('5000000000')).toBe('$50.000.000,00');
    expect(centavosToDisplay('123456')).toBe('$1.234,56');
  });
});

describe('donationSummary', () => {
  it('describe la donación en ES', () => {
    const s = donationSummary({ montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' }, 'es');
    expect(s).toContain('$50.000.000,00');
    expect(s).toContain('257');
  });
  it('devuelve null sin structured', () => {
    expect(donationSummary(null, 'es')).toBeNull();
  });
});

describe('buildRegistrarInput', () => {
  const form: FactFormState = {
    kind: 'donation', title: 'Donación X', body: 'cuerpo',
    fiscalPeriod: '2026', montoPesos: '50000000', articulo: '257',
  };
  it('donation: arma structured (centavos) + fiscalYear = período', () => {
    const input = buildRegistrarInput(form);
    expect(input).toEqual({
      kind: 'donation', title: 'Donación X', body: 'cuerpo', fiscalPeriod: '2026',
      structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
    });
  });
  it('narrative: structured null + período null si vacío', () => {
    const input = buildRegistrarInput({ ...form, kind: 'narrative', fiscalPeriod: '' });
    expect(input.structured).toBeNull();
    expect(input.fiscalPeriod).toBeNull();
  });
});

describe('factToFormState (edit prefill)', () => {
  it('rehidrata pesos + artículo desde structured', () => {
    const f = factToFormState(dto({}));
    expect(f).toEqual({
      kind: 'donation', title: 't', body: 'b', fiscalPeriod: '2026',
      montoPesos: '50000000', articulo: '257',
    });
  });
  it('round-trip factToFormState → buildRegistrarInput preserva structured', () => {
    const input = buildRegistrarInput(factToFormState(dto({})));
    expect(input.structured).toEqual({ montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' });
  });
});

describe('versionHistoryFor', () => {
  it('devuelve predecesores (más reciente primero)', () => {
    const v1 = dto({ id: 'v1', status: 'revoked', supersededById: 'v2', createdAt: '2026-01-01T00:00:00.000Z' });
    const v2 = dto({ id: 'v2', status: 'revoked', supersededById: 'v3', createdAt: '2026-02-01T00:00:00.000Z' });
    const v3 = dto({ id: 'v3', status: 'active', supersededById: null, createdAt: '2026-03-01T00:00:00.000Z' });
    expect(versionHistoryFor(v3, [v1, v2, v3]).map((f) => f.id)).toEqual(['v2', 'v1']);
  });
  it('sin predecesores → []', () => {
    const only = dto({ id: 'a', supersededById: null });
    expect(versionHistoryFor(only, [only])).toEqual([]);
  });
});

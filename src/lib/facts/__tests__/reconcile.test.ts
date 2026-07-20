import { describe, expect, it } from 'vitest';
import { decideReconciliation, factContentEquals } from '../reconcile';

const donation = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos, articulo: '257', fiscalYear: '2026' },
});

const donationReorderedKeys = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { fiscalYear: '2026', articulo: '257', montoCentavos },
});

describe('decideReconciliation — estructurados (donation)', () => {
  it('ADD cuando no hay hechos activos equivalentes', () => {
    expect(decideReconciliation(donation('5000000000'), [], 'donation')).toEqual({ action: 'ADD' });
  });

  it('NOOP cuando el hecho ya existe idéntico', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('5000000000'), [existing], 'donation')).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE cuando existe uno del mismo tipo/período con datos distintos', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('4500000000'), [existing], 'donation')).toEqual({
      action: 'SUPERSEDE',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE contra el más reciente cuando (defensivo) hay más de un activo', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    const d = decideReconciliation(donation('4500000000'), [older, newer], 'donation');
    expect(d).toEqual({ action: 'SUPERSEDE', existingId: 'f2' });
  });

  it('NOOP cuando el candidato reordena las claves de structured (igualdad estable)', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donationReorderedKeys('5000000000'), [existing], 'donation')).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('NOOP gana sobre SUPERSEDE cuando hay >1 activo y el candidato iguala a uno', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    expect(decideReconciliation(donation('4800000000'), [older, newer], 'donation')).toEqual({
      action: 'NOOP',
      existingId: 'f2',
    });
  });
});

describe('decideReconciliation — narrativos coexisten (nunca SUPERSEDE)', () => {
  const narr = (body: string) => ({ title: 'Contexto', body, structured: null });

  it('ADD cuando hay un narrativo activo DISTINTO (no supersede al previo)', () => {
    const existing = { id: 'n1', ...narr('Somos una SaaS B2B.') };
    expect(decideReconciliation(narr('Tenemos 3 socios.'), [existing], 'narrative')).toEqual({
      action: 'ADD',
    });
  });

  it('NOOP cuando el narrativo es idéntico (idempotencia)', () => {
    const existing = { id: 'n1', ...narr('Somos una SaaS B2B.') };
    expect(decideReconciliation(narr('Somos una SaaS B2B.'), [existing], 'narrative')).toEqual({
      action: 'NOOP',
      existingId: 'n1',
    });
  });

  it('ADD aunque haya varios narrativos activos, si el candidato es nuevo', () => {
    const a = { id: 'n1', ...narr('Somos una SaaS B2B.') };
    const b = { id: 'n2', ...narr('Tenemos 3 socios.') };
    expect(decideReconciliation(narr('Levantamos ronda seed.'), [a, b], 'narrative')).toEqual({
      action: 'ADD',
    });
  });
});

describe('factContentEquals', () => {
  it('true con las mismas entradas de structured y distinto orden de claves', () => {
    expect(factContentEquals(donation('5000000000'), donationReorderedKeys('5000000000'))).toBe(true);
  });
});

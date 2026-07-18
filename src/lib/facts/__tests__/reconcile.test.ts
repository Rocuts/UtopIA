import { describe, expect, it } from 'vitest';
import { decideReconciliation } from '../reconcile';

const donation = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos, articulo: '257', fiscalYear: '2026' },
});

describe('decideReconciliation', () => {
  it('ADD cuando no hay hechos activos equivalentes', () => {
    expect(decideReconciliation(donation('5000000000'), [])).toEqual({ action: 'ADD' });
  });

  it('NOOP cuando el hecho ya existe idéntico', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('5000000000'), [existing])).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE cuando existe uno del mismo tipo/período con datos distintos', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('4500000000'), [existing])).toEqual({
      action: 'SUPERSEDE',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE contra el más reciente cuando (defensivo) hay más de un activo', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    const d = decideReconciliation(donation('4500000000'), [older, newer]);
    expect(d).toEqual({ action: 'SUPERSEDE', existingId: 'f2' });
  });
});

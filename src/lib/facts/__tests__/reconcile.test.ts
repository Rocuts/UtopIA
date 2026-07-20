import { describe, expect, it } from 'vitest';
import { decideReconciliation, factContentEquals } from '../reconcile';

const donation = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos, articulo: '257', fiscalYear: '2026' },
});

// Mismo contenido que donation(), pero con las claves de `structured` en orden
// inverso de inserción — para probar que la igualdad es estable ante el orden.
const donationReorderedKeys = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { fiscalYear: '2026', articulo: '257', montoCentavos },
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
    // Array en orden ASCENDENTE por createdAt (older primero) — igual que el
    // contrato del caller reconcileFact. El último (newer=f2) es el más reciente.
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    const d = decideReconciliation(donation('4500000000'), [older, newer]);
    expect(d).toEqual({ action: 'SUPERSEDE', existingId: 'f2' });
  });

  it('NOOP cuando el candidato reordena las claves de structured (igualdad estable)', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    // Mismo contenido, claves de `structured` en distinto orden → NOOP, no SUPERSEDE.
    // Fallaría si stableStringify usara JSON.stringify plano (orden de inserción).
    expect(decideReconciliation(donationReorderedKeys('5000000000'), [existing])).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('NOOP gana sobre SUPERSEDE cuando hay >1 activo y el candidato iguala a uno', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    // El candidato iguala a `newer`: el match del find gana antes del fallback SUPERSEDE.
    expect(decideReconciliation(donation('4800000000'), [older, newer])).toEqual({
      action: 'NOOP',
      existingId: 'f2',
    });
  });
});

describe('factContentEquals', () => {
  it('true con las mismas entradas de structured y distinto orden de claves', () => {
    // { montoCentavos, articulo, fiscalYear } vs { fiscalYear, articulo, montoCentavos }.
    // Fallaría si stableStringify usara JSON.stringify plano (orden de inserción).
    expect(factContentEquals(donation('5000000000'), donationReorderedKeys('5000000000'))).toBe(
      true,
    );
  });
});

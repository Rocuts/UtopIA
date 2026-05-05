// numeration-gaps.test.ts — Gaps en numeración correlativa de asientos.

import { describe, it, expect } from 'vitest';
import { detectGaps } from '../rules/numeration-gaps';

describe('detectGaps', () => {
  it('secuencia sin gaps → array vacío', () => {
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(detectGaps(nums)).toEqual([]);
  });

  it('1 gap de tamaño 1 → una entrada con size=1', () => {
    const nums = [1, 2, 3, 5, 6, 7];
    const gaps = detectGaps(nums);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ from: 4, to: 4, size: 1 });
  });

  it('gap de tamaño 3 → size=3', () => {
    const nums = [1, 2, 3, 7, 8, 9];
    const gaps = detectGaps(nums);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ from: 4, to: 6, size: 3 });
  });

  it('múltiples gaps → retorna todos', () => {
    const nums = [1, 2, 3, 5, 8, 9];
    const gaps = detectGaps(nums);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({ from: 4, to: 4, size: 1 });
    expect(gaps[1]).toEqual({ from: 6, to: 7, size: 2 });
  });

  it('menos de 2 elementos → sin gaps posibles', () => {
    expect(detectGaps([])).toEqual([]);
    expect(detectGaps([1])).toEqual([]);
  });

  it('secuencia desordenada → se analiza en orden como recibida', () => {
    // detectGaps recibe los números YA ordenados (el repository ordena por entry_number)
    const nums = [1, 2, 4, 5, 6];
    const gaps = detectGaps(nums);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].from).toBe(3);
  });
});

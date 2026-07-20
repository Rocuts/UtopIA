import { describe, expect, it } from 'vitest';
import { pctFloorMoneyCop, minMoneyCop } from '../money';

describe('pctFloorMoneyCop', () => {
  it('25% de 5.000.000.000 centavos = 1.250.000.000', () => {
    expect(pctFloorMoneyCop('5000000000', 25)).toBe('1250000000');
  });
  it('trunca hacia abajo (floor) — 25% de 101 = 25 (no 25.25)', () => {
    expect(pctFloorMoneyCop('101', 25)).toBe('25');
  });
  it('0% → 0 ; 100% → identidad', () => {
    expect(pctFloorMoneyCop('12345', 0)).toBe('0');
    expect(pctFloorMoneyCop('12345', 100)).toBe('12345');
  });
});

describe('minMoneyCop', () => {
  it('devuelve el menor', () => {
    expect(minMoneyCop('1250000000', '3000000000')).toBe('1250000000');
    expect(minMoneyCop('3000000000', '1250000000')).toBe('1250000000');
  });
  it('iguales → devuelve a', () => {
    expect(minMoneyCop('100', '100')).toBe('100');
  });
});

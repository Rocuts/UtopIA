// W3-C — el saldo acumulado del mayor se calcula en centavos exactos (BigInt),
// no con Number() sobre strings NUMERIC (MoneyCop).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));

import { centsToNumeric, numericToCents } from '../ledger';

describe('numericToCents / centsToNumeric', () => {
  it('parsea NUMERIC con signo y redondea a 2 decimales por truncamiento de texto', () => {
    expect(numericToCents('1234.56')).toBe(BigInt(123456));
    expect(numericToCents('-0.07')).toBe(BigInt(-7));
    expect(numericToCents('12')).toBe(BigInt(1200));
    expect(numericToCents('5.5')).toBe(BigInt(550));
    expect(numericToCents(null)).toBe(BigInt(0));
  });

  it('no pierde centavos por encima de 2^53', () => {
    const big = '98765432109876543.21';
    expect(centsToNumeric(numericToCents(big))).toBe(big);
    expect(centsToNumeric(numericToCents(big) - numericToCents('0.22'))).toBe('98765432109876542.99');
  });

  it('formatea negativos y ceros', () => {
    expect(centsToNumeric(BigInt(-50000010))).toBe('-500000.10');
    expect(centsToNumeric(BigInt(0))).toBe('0.00');
  });

  it('rechaza texto no numérico', () => {
    expect(() => numericToCents('1e5')).toThrow();
  });
});

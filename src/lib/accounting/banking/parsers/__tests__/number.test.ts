// number.test.ts — Regresión del parseo de importes de extractos bancarios.
//
// Bug corregido: `parseNumber` (csv.ts) leía el punto de miles colombiano como
// separador decimal cuando el monto venía sin centavos: "1.234.567" → 1.23.
// Los extractos de Bancolombia/Davivienda casi nunca traen centavos, así que
// el libro auxiliar de bancos entraba dividido por ~1.000.000 y en silencio.

import { describe, it, expect } from 'vitest';
import { parseMoneyAmount } from '../number';

describe('parseMoneyAmount — miles con punto (ES-CO, sin centavos)', () => {
  // Estos son EXACTAMENTE los casos que devolvían 1.23 / -2.50 / 3.45 / 12.50.
  it.each([
    ['1.234.567', 1_234_567],
    ['-2.500.000', -2_500_000],
    ['$3.450.000', 3_450_000],
    ['12.500', 12_500],
    ['1.234', 1_234],
    ['123.456', 123_456],
    ["1'234.567", 1_234_567],
  ])('%s → %d', (raw, expected) => {
    expect(parseMoneyAmount(raw)).toBe(expected);
  });
});

describe('parseMoneyAmount — formatos que ya funcionaban (no romper)', () => {
  it.each([
    ['1.234.567,89', 1_234_567.89],
    ['-1.234.567,89', -1_234_567.89],
    ['1,234,567.89', 1_234_567.89],
    ['1234567', 1_234_567],
    ['1234567.89', 1_234_567.89],
    ['$ 500000', 500_000],
    ['0', 0],
    ['-500000', -500_000],
    ['1,50', 1.5], // coma decimal ES-CO con 2 dígitos
    ['1.50', 1.5], // punto decimal EN-US con 2 dígitos
  ])('%s → %d', (raw, expected) => {
    expect(parseMoneyAmount(raw)).toBe(expected);
  });
});

describe('parseMoneyAmount — signos y ruido', () => {
  it('paréntesis contables significan negativo', () => {
    expect(parseMoneyAmount('(1.234.567)')).toBe(-1_234_567);
  });

  it('signo sufijo (exportes AS400/SAP) significa negativo', () => {
    expect(parseMoneyAmount('1.234.567-')).toBe(-1_234_567);
  });

  it('código de moneda y NBSP no estorban', () => {
    expect(parseMoneyAmount('COP 3.450.000')).toBe(3_450_000);
  });
});

describe('parseMoneyAmount — ilegible devuelve null, nunca 0', () => {
  it.each(['', '   ', 'N/A', 'saldo', '1O00', '1.234.5', '1,23,45'])(
    '%s → null',
    (raw) => {
      expect(parseMoneyAmount(raw)).toBeNull();
    },
  );

  it('null/undefined → null', () => {
    expect(parseMoneyAmount(null)).toBeNull();
    expect(parseMoneyAmount(undefined)).toBeNull();
  });
});

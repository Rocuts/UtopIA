// Tests del helper MoneyCop (Fase 1.1) — contracts/money.ts.
// El sistema cambia cifras de `number` (pérdida de precisión > 2^53) a string
// en centavos parseable a BigInt. Estos tests blindan ese contrato.

import { describe, it, expect } from 'vitest';
import {
  parseMoneyCop,
  serializeMoneyCop,
  formatCopFromCents,
  sumMoneyCop,
  subMoneyCop,
  moneyCopEquals,
} from '../contracts/money';

describe('contracts/money — MoneyCop helpers', () => {
  describe('parseMoneyCop', () => {
    it('parses "0" → 0n', () => {
      expect(parseMoneyCop('0')).toBe(BigInt(0));
    });
    it('parses positive integer', () => {
      expect(parseMoneyCop('1500000')).toBe(BigInt(1500000));
    });
    it('parses negative integer', () => {
      expect(parseMoneyCop('-12345')).toBe(BigInt(-12345));
    });
    it('preserves precision beyond 2^53', () => {
      const huge = '900000000000000000000'; // 9 × 10^20, way beyond Number.MAX_SAFE_INTEGER
      expect(parseMoneyCop(huge).toString()).toBe(huge);
    });
    it('throws on non-integer string', () => {
      expect(() => parseMoneyCop('1.5')).toThrow();
      expect(() => parseMoneyCop('abc')).toThrow();
      expect(() => parseMoneyCop('')).toThrow();
    });
  });

  describe('serializeMoneyCop', () => {
    it('round-trips through parseMoneyCop', () => {
      const cents = BigInt(987654321);
      expect(parseMoneyCop(serializeMoneyCop(cents))).toBe(cents);
    });
  });

  describe('formatCopFromCents', () => {
    it('formats 0 as "$0,00"', () => {
      expect(formatCopFromCents(BigInt(0), true)).toBe('$0,00');
    });
    it('formats 1500000 (= $15.000,00) with dot-thousand', () => {
      expect(formatCopFromCents(BigInt(1500000), true)).toBe('$15.000,00');
    });
    it('formats 123456789 as "$1.234.567,89"', () => {
      expect(formatCopFromCents(BigInt(123456789), true)).toBe('$1.234.567,89');
    });
    it('uses parentheses for negatives when not absolute', () => {
      expect(formatCopFromCents(BigInt(-1500000), false)).toBe('($15.000,00)');
    });
    it('forces absolute (no parentheses) when absolute=true', () => {
      expect(formatCopFromCents(BigInt(-1500000), true)).toBe('$15.000,00');
    });
  });

  describe('arithmetic helpers', () => {
    it('sumMoneyCop adds collection', () => {
      expect(sumMoneyCop(['100', '200', '300'])).toBe('600');
    });
    it('subMoneyCop subtracts', () => {
      expect(subMoneyCop('1000', '300')).toBe('700');
    });
    it('moneyCopEquals tolerance default 0', () => {
      expect(moneyCopEquals('100', '100')).toBe(true);
      expect(moneyCopEquals('100', '101')).toBe(false);
    });
    it('moneyCopEquals respects tolerance', () => {
      expect(moneyCopEquals('100', '105', BigInt(5))).toBe(true);
      expect(moneyCopEquals('100', '106', BigInt(5))).toBe(false);
    });
  });
});

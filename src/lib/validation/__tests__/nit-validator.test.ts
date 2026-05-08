import { describe, expect, it } from 'vitest';

import {
  computeNITCheckDigit,
  extractNITBody,
  validateNITCheckDigit,
} from '../nit-validator';

describe('NIT DV — algoritmo DIAN', () => {
  describe('computeNITCheckDigit', () => {
    it('Grupo Empresarial 2 Tres SAS — body 901714014 → DV 6', () => {
      expect(computeNITCheckDigit('901714014')).toBe(6);
    });

    it('NIT inventado (213092082) → DV NO es 1', () => {
      // El cuerpo 213092082 calcula DV 0; "213092082-1" es por tanto un NIT
      // fabricado. El test garantiza que el verificador NO acepta el DV 1.
      expect(computeNITCheckDigit('213092082')).not.toBe(1);
    });

    it('NIT 805001157 → DV 2 (vector de pesos primos DIAN)', () => {
      // 7*3 + 5*7 + 1*13 + 1*17 + 0*19 + 0*23 + 5*29 + 0*37 + 8*41 = 559
      // 559 mod 11 = 9, mod >= 2 ⇒ DV = 11 - 9 = 2.
      expect(computeNITCheckDigit('805001157')).toBe(2);
    });

    it('NIT corto (4 dígitos) calcula DV correctamente', () => {
      // body=1000 → reverse [0,0,0,1], pesos [3,7,13,17], suma=17, mod=6, DV=11-6=5
      expect(computeNITCheckDigit('1000')).toBe(5);
    });

    it('lanza si body vacío', () => {
      expect(() => computeNITCheckDigit('')).toThrow(RangeError);
    });

    it('lanza si body contiene caracteres no numéricos', () => {
      expect(() => computeNITCheckDigit('900a23456')).toThrow(RangeError);
    });

    it('lanza si body excede 15 caracteres', () => {
      expect(() => computeNITCheckDigit('1234567890123456')).toThrow(RangeError);
    });
  });

  describe('validateNITCheckDigit', () => {
    it('"901714014-6" verifica como NIT válido', () => {
      expect(validateNITCheckDigit('901714014-6')).toBe(true);
    });

    it('"901.714.014-6" (con puntos) verifica', () => {
      expect(validateNITCheckDigit('901.714.014-6')).toBe(true);
    });

    it('"213.092.082-1" (NIT fabricado) NO verifica', () => {
      expect(validateNITCheckDigit('213.092.082-1')).toBe(false);
    });

    it('"213092082-1" sin formato tampoco verifica', () => {
      expect(validateNITCheckDigit('213092082-1')).toBe(false);
    });

    it('NIT sin guión-DV (último dígito como DV) — válido si concuerda', () => {
      // body=901714014, DV=6 → "9017140146" debería validar
      expect(validateNITCheckDigit('9017140146')).toBe(true);
    });

    it('null / undefined / vacío → false', () => {
      expect(validateNITCheckDigit(null)).toBe(false);
      expect(validateNITCheckDigit(undefined)).toBe(false);
      expect(validateNITCheckDigit('')).toBe(false);
    });

    it('contenido no numérico → false', () => {
      expect(validateNITCheckDigit('NIT123-X')).toBe(false);
      expect(validateNITCheckDigit('abc-1')).toBe(false);
    });

    it('demasiado corto → false', () => {
      expect(validateNITCheckDigit('12-3')).toBe(false);
    });
  });

  describe('extractNITBody', () => {
    it('extrae body de NIT con formato canónico', () => {
      expect(extractNITBody('901.714.014-6')).toBe('901714014');
    });

    it('sin guión, último dígito es DV', () => {
      expect(extractNITBody('9017140146')).toBe('901714014');
    });

    it('null devuelve null', () => {
      expect(extractNITBody(null)).toBeNull();
    });
  });
});

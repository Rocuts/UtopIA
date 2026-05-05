// weekend-postings.test.ts — Asientos en fin de semana / festivos colombianos.

import { describe, it, expect } from 'vitest';
import { isNonWorkday, toISODateLocal } from '../rules/weekend-postings';

// Festivos 2026 para tests
const HOLIDAYS_2026_TEST: Set<string> = new Set([
  '2026-01-01', // Año nuevo
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  '2026-05-01', // Día del Trabajo
  '2026-07-20', // Independencia de Colombia
  '2026-12-25', // Navidad
]);

describe('toISODateLocal', () => {
  it('convierte Date UTC a string YYYY-MM-DD', () => {
    expect(toISODateLocal(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01-15');
    expect(toISODateLocal(new Date('2026-12-25T10:00:00Z'))).toBe('2026-12-25');
  });
});

describe('isNonWorkday', () => {
  it('lunes a viernes → día hábil (false)', () => {
    // 2026-01-05 es lunes
    expect(isNonWorkday(new Date('2026-01-05T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(false);
    // 2026-01-09 es viernes
    expect(isNonWorkday(new Date('2026-01-09T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(false);
    // 2026-03-17 es martes
    expect(isNonWorkday(new Date('2026-03-17T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(false);
  });

  it('sábado → no hábil (true)', () => {
    // 2026-01-10 es sábado
    expect(isNonWorkday(new Date('2026-01-10T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
    // 2026-03-14 es sábado
    expect(isNonWorkday(new Date('2026-03-14T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
  });

  it('domingo → no hábil (true)', () => {
    // 2026-01-11 es domingo
    expect(isNonWorkday(new Date('2026-01-11T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
  });

  it('festivos colombianos correctamente identificados (true)', () => {
    // Año Nuevo
    expect(isNonWorkday(new Date('2026-01-01T00:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
    // Jueves Santo
    expect(isNonWorkday(new Date('2026-04-02T10:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
    // Navidad (25 dic 2026 es viernes → es festivo Y viernes)
    expect(isNonWorkday(new Date('2026-12-25T10:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
    // Día del Trabajo
    expect(isNonWorkday(new Date('2026-05-01T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(true);
  });

  it('día hábil cerca de festivo no se confunde', () => {
    // 2026-01-02 es viernes (no festivo)
    expect(isNonWorkday(new Date('2026-01-02T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(false);
    // 2026-04-01 es miércoles (no festivo)
    expect(isNonWorkday(new Date('2026-04-01T08:00:00Z'), HOLIDAYS_2026_TEST)).toBe(false);
  });
});

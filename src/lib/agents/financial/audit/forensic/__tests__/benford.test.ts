// benford.test.ts — Ley de Benford: distribución del primer dígito.
// Todas las funciones son puras → tests < 10ms cada uno.

import { describe, it, expect } from 'vitest';
import {
  firstSignificantDigit,
  chiSquare,
  runBenfordOnAmounts,
} from '../rules/benford';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Genera N amounts que siguen Benford (dígito d con probabilidad log10(1+1/d)). */
function generateBenfordAmounts(n: number): string[] {
  const amounts: string[] = [];
  // Distribución sintética de Benford: ~30% empieza con 1, ~17% con 2, etc.
  const distribution = [
    { digit: 1, count: Math.round(n * 0.301) },
    { digit: 2, count: Math.round(n * 0.176) },
    { digit: 3, count: Math.round(n * 0.125) },
    { digit: 4, count: Math.round(n * 0.097) },
    { digit: 5, count: Math.round(n * 0.079) },
    { digit: 6, count: Math.round(n * 0.067) },
    { digit: 7, count: Math.round(n * 0.058) },
    { digit: 8, count: Math.round(n * 0.051) },
    { digit: 9, count: Math.round(n * 0.046) },
  ];
  for (const { digit, count } of distribution) {
    for (let i = 0; i < count; i++) {
      amounts.push(`${digit}${(Math.floor(Math.random() * 900) + 100).toString()}.00`);
    }
  }
  return amounts;
}

/** Genera N amounts con distribución uniforme de dígitos 1-9 (viola Benford). */
function generateUniformAmounts(n: number): string[] {
  const amounts: string[] = [];
  const countPerDigit = Math.floor(n / 9);
  for (let d = 1; d <= 9; d++) {
    for (let i = 0; i < countPerDigit; i++) {
      amounts.push(`${d}${(Math.floor(Math.random() * 900) + 100).toString()}.00`);
    }
  }
  return amounts;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('firstSignificantDigit', () => {
  it('extrae el primer dígito significativo correctamente', () => {
    expect(firstSignificantDigit('1234.00')).toBe(1);
    expect(firstSignificantDigit('987.50')).toBe(9);
    expect(firstSignificantDigit('0.00')).toBeNull();
    expect(firstSignificantDigit('000500.00')).toBe(5);
  });
});

describe('chiSquare', () => {
  it('distribución perfecta de Benford → chi ≈ 0', () => {
    const n = 1000;
    const benfordExpected = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (d) => Math.log10(1 + 1 / d) * n,
    );
    // Observed = expected exactamente
    const chi = chiSquare(benfordExpected.map(Math.round), n);
    // Pequeñas variaciones por redondeo
    expect(chi).toBeLessThan(2);
  });

  it('distribución uniforme viola Benford (chi alto)', () => {
    const n = 900;
    const observed = new Array(9).fill(100); // 100 de cada dígito
    const chi = chiSquare(observed, n);
    expect(chi).toBeGreaterThan(15);
  });
});

describe('runBenfordOnAmounts', () => {
  it('menos de 50 montos → n < 50 (skip debería activarse)', () => {
    const amounts = generateBenfordAmounts(30);
    const result = runBenfordOnAmounts(amounts);
    expect(result.n).toBeLessThan(50);
  });

  it('datos que siguen Benford → chi-square bajo (no anomalía)', () => {
    const amounts = generateBenfordAmounts(500);
    const result = runBenfordOnAmounts(amounts);
    expect(result.n).toBeGreaterThanOrEqual(400);
    // La distribución sintética sigue Benford → chi debe ser bajo
    expect(result.chiSquare).toBeLessThan(15.507);
  });

  it('distribución uniforme viola Benford → chi > umbral crítico', () => {
    const amounts = generateUniformAmounts(900);
    const result = runBenfordOnAmounts(amounts);
    expect(result.n).toBeGreaterThanOrEqual(800);
    expect(result.chiSquare).toBeGreaterThan(15.507);
  });

  it('montos = 0 o negativos se ignoran', () => {
    // 3 amounts no válidos + 9 válidos explícitos
    const validAmounts = ['100.00', '200.00', '300.00', '400.00', '500.00', '600.00', '700.00', '800.00', '900.00'];
    const amounts = ['0.00', '-500.00', '0', ...validAmounts];
    const result = runBenfordOnAmounts(amounts);
    // Solo los 9 positivos cuentan
    expect(result.n).toBe(9);
  });

  it('digitCounts tiene exactamente 9 elementos (índices dígito 1-9)', () => {
    const amounts = generateBenfordAmounts(100);
    const result = runBenfordOnAmounts(amounts);
    expect(result.digitCounts).toHaveLength(9);
    expect(result.benfordExpected).toHaveLength(9);
  });
});

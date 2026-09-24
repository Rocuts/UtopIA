import { describe, expect, it } from 'vitest';

import {
  formatBigCop,
  formatCop,
  formatDays,
  formatMonths,
  formatPct,
} from '@/lib/charts/format';

describe('formatCop', () => {
  it('formatea pesos sin decimales con separador es-CO', () => {
    expect(formatCop(1_234_567)).toBe('$1.234.567');
    expect(formatCop(0)).toBe('$0');
  });
  // reportes-export-19: misma convención de negativos que los estados
  // (formatCopFromCents) y el Excel: paréntesis, no "-$".
  it('negativos entre paréntesis (convención NIIF)', () => {
    expect(formatCop(-500_000)).toBe('($500.000)');
    expect(formatCop(-0.4)).toBe('$0');
  });
  it('retorna em-dash para null/undefined/NaN', () => {
    expect(formatCop(null)).toBe('—');
    expect(formatCop(undefined)).toBe('—');
    expect(formatCop(Number.NaN)).toBe('—');
    expect(formatCop(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

// ratios-kpis-27 / reportes-export-19: antes '$1.5K', '$2.5M', '$3.0B' y
// '$4.0T' (punto decimal y 'B', que en español se lee como billón = 10^12).
describe('formatBigCop — escalas es-CO', () => {
  it('coma decimal y sufijos mil / M / mil M', () => {
    expect(formatBigCop(1_500)).toBe('$1,5 mil');
    expect(formatBigCop(2_500_000)).toBe('$2,5 M');
    expect(formatBigCop(108_766_861)).toBe('$108,8 M');
    expect(formatBigCop(1_500_000_000)).toBe('$1,5 mil M');
    expect(formatBigCop(3_000_000_000)).toBe('$3 mil M');
  });
  it('nunca usa B ni T; por encima de 10^12 sigue en mil M con punto de miles', () => {
    expect(formatBigCop(4_000_000_000_000)).toBe('$4.000 mil M');
    for (const v of [1e3, 1e6, 1e9, 2.4e9, 6.44e9, 1e12, 5e13]) {
      expect(formatBigCop(v)).not.toMatch(/[BKT]\b|\d\.\d(?!\d\d)/);
    }
  });
  it('el redondeo en el borde promueve a la escala siguiente', () => {
    expect(formatBigCop(999_960)).toBe('$1 M');
    expect(formatBigCop(950_000)).toBe('$950 mil');
    expect(formatBigCop(999.6)).toBe('$1 mil');
  });
  it('valores chicos sin sufijo', () => {
    expect(formatBigCop(450)).toBe('$450');
    expect(formatBigCop(0)).toBe('$0');
  });
  it('negativos entre paréntesis', () => {
    expect(formatBigCop(-1_500_000)).toBe('($1,5 M)');
    expect(formatBigCop(-0.2)).toBe('$0');
  });
  it('em-dash para no finitos', () => {
    expect(formatBigCop(Number.NaN)).toBe('—');
    expect(formatBigCop(null)).toBe('—');
  });
});

describe('formatPct', () => {
  it('convierte decimal a % con coma decimal', () => {
    expect(formatPct(0.156)).toBe('15,6%');
    expect(formatPct(0.05, 2)).toBe('5,00%');
    expect(formatPct(12.345)).toBe('1.234,5%');
  });
  it('negativos con signo; sin "-0,0%"', () => {
    expect(formatPct(-0.041)).toBe('-4,1%');
    expect(formatPct(-0.00001)).toBe('0,0%');
  });
  it('em-dash para nulos', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
  });
});

describe('formatMonths / formatDays', () => {
  it('formatMonths singular y plural', () => {
    expect(formatMonths(1)).toBe('1 mes');
    expect(formatMonths(36)).toBe('36 meses');
    expect(formatMonths(8, 'short')).toBe('8 m');
  });
  it('formatDays', () => {
    expect(formatDays(1)).toBe('1 día');
    expect(formatDays(45)).toBe('45 días');
  });
});

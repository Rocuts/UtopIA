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
  it('respeta el signo negativo', () => {
    expect(formatCop(-500_000)).toBe('-$500.000');
  });
  it('retorna em-dash para null/undefined/NaN', () => {
    expect(formatCop(null)).toBe('—');
    expect(formatCop(undefined)).toBe('—');
    expect(formatCop(Number.NaN)).toBe('—');
    expect(formatCop(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatBigCop', () => {
  it('comprime miles, millones, billones, trillones', () => {
    expect(formatBigCop(1_500)).toBe('$1.5K');
    expect(formatBigCop(2_500_000)).toBe('$2.5M');
    expect(formatBigCop(3_000_000_000)).toBe('$3.0B');
    expect(formatBigCop(4_000_000_000_000)).toBe('$4.0T');
  });
  it('valores chicos sin sufijo', () => {
    expect(formatBigCop(450)).toBe('$450');
  });
  it('signo negativo', () => {
    expect(formatBigCop(-1_500_000)).toBe('-$1.5M');
  });
});

describe('formatPct', () => {
  it('convierte decimal a %', () => {
    expect(formatPct(0.156)).toBe('15.6%');
    expect(formatPct(0.05, 2)).toBe('5.00%');
  });
  it('em-dash para nulos', () => {
    expect(formatPct(null)).toBe('—');
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

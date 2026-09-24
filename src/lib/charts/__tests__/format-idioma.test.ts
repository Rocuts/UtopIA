// ratios-kpis-27 (parte UI) — formatos compactos según el idioma de la UI.
//
// P6 dejó `formatBigCop` / `formatPct` fijos en es-CO (`$2,4 mil M`, `15,6%`).
// Las tarjetas y gráficos de los pilares son bilingües: en inglés `mil M` no
// se entiende y la coma decimal se lee como separador de miles. El parámetro
// opcional `language` (default 'es') mantiene intactos a los llamadores
// existentes y en inglés usa en-US con `K / M / B / T` (`B` = 10^9 en inglés).
import { describe, expect, it } from 'vitest';

import { formatBigCop, formatDecimal, formatPct } from '@/lib/charts/format';

describe('formatBigCop — language', () => {
  it("default 'es' sin cambios", () => {
    expect(formatBigCop(2_400_000_000)).toBe('$2,4 mil M');
    expect(formatBigCop(2_400_000_000, 'es')).toBe('$2,4 mil M');
  });
  it("'en': punto decimal y K / M / B / T", () => {
    expect(formatBigCop(1_500, 'en')).toBe('$1.5K');
    expect(formatBigCop(108_766_861, 'en')).toBe('$108.8M');
    expect(formatBigCop(2_400_000_000, 'en')).toBe('$2.4B');
    expect(formatBigCop(4_000_000_000_000, 'en')).toBe('$4T');
    expect(formatBigCop(450, 'en')).toBe('$450');
    expect(formatBigCop(999_960, 'en')).toBe('$1M');
  });
  it("'en': negativos entre paréntesis y em-dash para no finitos", () => {
    expect(formatBigCop(-1_500_000, 'en')).toBe('($1.5M)');
    expect(formatBigCop(Number.NaN, 'en')).toBe('—');
  });
  it('un segundo argumento no reconocido cae a es (p. ej. índice de .map)', () => {
    expect(formatBigCop(1_500, 3 as unknown as 'es')).toBe('$1,5 mil');
  });
});

describe('formatPct / formatDecimal — language', () => {
  it("formatPct 'en' con punto decimal; default es-CO", () => {
    expect(formatPct(0.156)).toBe('15,6%');
    expect(formatPct(0.156, 1, 'en')).toBe('15.6%');
    expect(formatPct(-0.041, 1, 'en')).toBe('-4.1%');
    expect(formatPct(-0.00001, 1, 'en')).toBe('0.0%');
  });
  it('formatDecimal: coma en es, punto en en, sin "-0,00"', () => {
    expect(formatDecimal(1.254)).toBe('1,25');
    expect(formatDecimal(1.254, 2, 'en')).toBe('1.25');
    expect(formatDecimal(1234.5, 1)).toBe('1.234,5');
    expect(formatDecimal(-0.001)).toBe('0,00');
    expect(formatDecimal(-2.5, 1)).toBe('-2,5');
    expect(formatDecimal(null)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { pctFloorMoneyCop, minMoneyCop, pesosNumberToCents, formatCopFromPesos } from '../money';

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

// Auditoría 2026-09 (niif-contrato-22): casos borde del helper.
describe('niif-contrato-22 — casos borde de money.ts', () => {
  it('pctFloorMoneyCop es un floor real también con negativos (−101 × 50 % = −51)', () => {
    expect(pctFloorMoneyCop('-101', 50)).toBe('-51');
    expect(pctFloorMoneyCop('-100', 50)).toBe('-50');
    expect(pctFloorMoneyCop('101', 50)).toBe('50');
  });

  it('formatCopFromCents(number) rechaza no enteros, no finitos y enteros inseguros', async () => {
    const { formatCopFromCents } = await import('../money');
    expect(() => formatCopFromCents(-1.5)).toThrow(RangeError);
    expect(() => formatCopFromCents(Number.NaN)).toThrow(RangeError);
    expect(() => formatCopFromCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatCopFromCents(2 ** 53)).toThrow(RangeError);
    expect(formatCopFromCents(-150)).toBe('($1,50)');
    expect(formatCopFromCents(Number.MAX_SAFE_INTEGER)).toBe('$90.071.992.547.409,91');
    // bigint sin límite de magnitud.
    expect(formatCopFromCents(BigInt('9007199254740993'))).toBe('$90.071.992.547.409,93');
  });

  it("parseMoneyCop normaliza las formas no canónicas ('-0', ceros a la izquierda)", async () => {
    const { parseMoneyCop, serializeMoneyCop } = await import('../money');
    expect(parseMoneyCop('-0')).toBe(BigInt(0));
    expect(serializeMoneyCop(parseMoneyCop('-0'))).toBe('0');
    expect(serializeMoneyCop(parseMoneyCop('007'))).toBe('7');
  });
});

describe('pesosNumberToCents / formatCopFromPesos — pesos number → centavos exactos (integración I2)', () => {
  it('convierte por el texto decimal, también por encima de 2^53 centavos', () => {
    expect(pesosNumberToCents(1234.56)).toBe(BigInt(123456));
    expect(pesosNumberToCents(-0.004)).toBe(BigInt(0));
    expect(pesosNumberToCents(100_000_000_000_000)).toBe(BigInt('10000000000000000'));
    expect(formatCopFromPesos(100_000_000_000_000)).toBe('$100.000.000.000.000,00');
    expect(formatCopFromPesos(-1234.5)).toBe('($1.234,50)');
    expect(formatCopFromPesos(-1234.5, true)).toBe('$1.234,50');
  });

  it('no finito o sin notación decimal fija → null / N/D', () => {
    expect(pesosNumberToCents(Number.NaN)).toBeNull();
    expect(pesosNumberToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(pesosNumberToCents(1e21)).toBeNull();
    expect(formatCopFromPesos(1e21)).toBe('N/D');
  });
});

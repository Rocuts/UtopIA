// Regresión reportes-export-06 / ratios-kpis-23: parseCOP interpretaba el punto
// de miles colombiano como punto decimal JS ('850.000' → 850) y devolvía '0' en
// silencio ante '1.234.567' o '(1.234,56)'.
import { describe, expect, it } from 'vitest';
import {
  formatCOP,
  parseCOP,
  parseCOPStrict,
  parseCOPToCentavos,
  parseCOPToNumber,
  sumCOPStrings,
} from '../cop';

describe('parseCOPStrict — formato es-CO (punto de miles, coma decimal)', () => {
  it.each([
    ['850.000', '850000'],
    ['1.500', '1500'],
    ['1.234.567', '1234567'],
    ['1.500.000,00', '1500000.00'],
    ['1.234.567,89', '1234567.89'],
    ['1234567,89', '1234567.89'],
    ['$ 1.234.567,89 COP', '1234567.89'],
    ['1234567.89', '1234567.89'], // forma JS/NUMERIC del servidor (2 decimales)
    ['0,5', '0.5'],
    ['850000', '850000'],
    ['-1.234,56', '-1234.56'],
    ['(1.234,56)', '-1234.56'],
    ['($ 1.500.000)', '-1500000'],
  ])('%s → %s', (input, expected) => {
    expect(parseCOPStrict(input)).toBe(expected);
  });

  it('vacío es cero (celda sin diligenciar), no error', () => {
    expect(parseCOPStrict('')).toBe('0');
    expect(parseCOPStrict('   ')).toBe('0');
    expect(parseCOPStrict(null)).toBe('0');
    expect(parseCOPStrict(undefined)).toBe('0');
  });

  it.each([
    'abc',
    '1,234,567', // en-US: comas de miles
    '1,234.56', // en-US: coma de miles + punto decimal
    '1.23.4', // grupos mal formados
    '12.3456', // punto ambiguo, no son miles ni centavos
    '0.500', // primer grupo con cero a la izquierda: no son miles
    '1,005', // más de 2 decimales
    '1.2.3,4',
    '--5',
  ])('%s no es interpretable → null (nunca 0 en silencio)', (input) => {
    expect(parseCOPStrict(input)).toBeNull();
  });

  it('números nativos finitos pasan; no finitos son null', () => {
    expect(parseCOPStrict(1500.5)).toBe('1500.5');
    expect(parseCOPStrict(Number.NaN)).toBeNull();
    expect(parseCOPStrict(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('parseCOP (contrato legado string)', () => {
  it('interpreta los miles es-CO', () => {
    expect(parseCOP('850.000')).toBe('850000');
    expect(parseCOP('1.234.567')).toBe('1234567');
    expect(parseCOP('(1.234,56)')).toBe('-1234.56');
    expect(parseCOPToNumber('1.500')).toBe(1500);
  });

  it('un asiento 850.000 / 850.000 suma 850.000,00, no 850,00', () => {
    expect(sumCOPStrings(['850.000'])).toBe('850000.00');
  });
});

describe('parseCOPToCentavos — BigInt exacto', () => {
  it.each([
    ['850.000', '85000000'],
    ['1.234.567', '123456700'],
    ['1.500.000,00', '150000000'],
    ['1.500.000,50', '150000050'],
    ['1.500.000,5', '150000050'],
    ['100.000.000.000', '10000000000000'], // > 2^53 centavos: sin pasar por Number
    ['(1.234,56)', '-123456'],
    ['', '0'],
  ])('%s → %s centavos', (input, expected) => {
    expect(parseCOPToCentavos(input)).toBe(expected);
  });

  it('entrada no interpretable → null', () => {
    expect(parseCOPToCentavos('1,234,567')).toBeNull();
  });
});

// reportes-export-19: formatCOP imprimía el formato de Intl ('$ 1.234,56' con
// espacio y '-$ 1.234,56'), distinto de los estados, el Excel y los gráficos.
describe('formatCOP — misma convención que formatCopFromCents', () => {
  it('sin espacio tras el símbolo, punto de miles y coma decimal', () => {
    expect(formatCOP(1234567.89)).toBe('$1.234.567,89');
    expect(formatCOP('1500000.00')).toBe('$1.500.000,00');
    expect(formatCOP(0)).toBe('$0,00');
  });
  it('negativos entre paréntesis', () => {
    expect(formatCOP(-1234.56)).toBe('($1.234,56)');
    expect(formatCOP('-1234.5')).toBe('($1.234,50)');
  });
  it('strings NUMERIC por encima de 2^53 centavos sin pérdida', () => {
    expect(formatCOP('123456789012345678.91')).toBe('$123.456.789.012.345.678,91');
  });
  it('— para vacío o no numérico', () => {
    expect(formatCOP(null)).toBe('—');
    expect(formatCOP('')).toBe('—');
    expect(formatCOP('abc')).toBe('—');
    expect(formatCOP(Number.NaN)).toBe('—');
  });
});

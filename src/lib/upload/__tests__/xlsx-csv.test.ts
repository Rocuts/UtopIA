/**
 * XLSX → CSV (ingesta-05 + celdas numéricas de fórmulas).
 */
import { describe, it, expect } from 'vitest';
import {
  csvEscapeField,
  formatXlsxNumber,
  sanitizeSheetLabel,
  xlsxCellToText,
  xlsxRowToCsvLine,
} from '../xlsx-csv';
import { parseTrialBalanceCSV } from '@/lib/preprocessing/trial-balance';

describe('formatXlsxNumber', () => {
  it('enteros tal cual (códigos PUC numéricos no ganan decimales)', () => {
    expect(formatXlsxNumber(11050501)).toBe('11050501');
    expect(formatXlsxNumber(-0)).toBe('0');
    expect(formatXlsxNumber(1e21)).toBe('1000000000000000000000');
  });
  it('no enteros redondeados a centavos, sin ruido IEEE-754', () => {
    expect(formatXlsxNumber(100.1 + 200.2)).toBe('300.3');
    expect(formatXlsxNumber(1234.567)).toBe('1234.57');
    expect(formatXlsxNumber(-2.345)).toBe('-2.35');
    expect(formatXlsxNumber(5.999)).toBe('6');
    expect(formatXlsxNumber(Number.NaN)).toBe('');
  });
  it('P4-a: con la unidad confirmada en miles / millones conserva todos los decimales del valor almacenado', () => {
    // Dos decimales de "millones" son $10.000: 4232,848882125 millones salía
    // "4232.85" ($4.232.850.000) en vez de $4.232.848.882,13.
    expect(formatXlsxNumber(4232.848882125, 'full')).toBe('4232.848882125');
    expect(formatXlsxNumber(100.1 + 200.2, 'full')).toBe('300.3');
    expect(formatXlsxNumber(1.5e-7, 'full')).toBe('0.00000015');
    expect(formatXlsxNumber(11050501, 'full')).toBe('11050501');
    // Tres decimales exactos se leerían como separador de miles: cero final.
    expect(formatXlsxNumber(1.234, 'full')).toBe('1.2340');
    expect(formatXlsxNumber(-100.125, 'full')).toBe('-100.1250');
    expect(xlsxRowToCsvLine([undefined, '110505', 'Caja', 1.234], false, 'full')).toBe('110505,Caja,1.2340');
    // Sin la unidad confirmada, el redondeo al centavo de siempre.
    expect(formatXlsxNumber(4232.848882125)).toBe('4232.85');
  });
});

describe('xlsxCellToText', () => {
  it('fórmulas, rich text, hipervínculos, errores y fechas', () => {
    expect(xlsxCellToText({ formula: 'A1+A2', result: 100.1 + 200.2 })).toBe('300.3');
    expect(xlsxCellToText({ richText: [{ text: 'Caja ' }, { text: 'general' }] })).toBe('Caja general');
    expect(xlsxCellToText({ text: 'link', hyperlink: 'https://x' })).toBe('link');
    expect(xlsxCellToText({ error: '#DIV/0!' })).toBe('#DIV/0!');
    expect(xlsxCellToText(new Date('2025-12-31T00:00:00Z'))).toBe('2025-12-31');
    expect(xlsxCellToText({ foo: 1 })).toBe('');
  });
});

describe('csvEscapeField / xlsxRowToCsvLine', () => {
  it('RFC 4180: comas, comillas y punto y coma van entre comillas', () => {
    expect(csvEscapeField('Propiedades, planta y equipo')).toBe('"Propiedades, planta y equipo"');
    expect(csvEscapeField('Caja "menor"')).toBe('"Caja ""menor"""');
    expect(csvEscapeField('a;b')).toBe('"a;b"');
    expect(csvEscapeField('linea\nnueva\tcol')).toBe('linea nueva col');
  });

  it('el parser respeta las comillas: el saldo se lee de su columna', () => {
    const header = xlsxRowToCsvLine([undefined, 'codigo', 'nombre', 'debito', 'credito', 'saldo'], true);
    const row = xlsxRowToCsvLine([undefined, 15200101, 'Propiedades, planta y equipo', 20000, 0, 500000]);
    const row2 = xlsxRowToCsvLine([undefined, 13551501, 'Anticipo retención 2,5%', 0, 0, 100000]);
    const rows = parseTrialBalanceCSV([header, row, row2].join('\n'));
    expect(rows.map((r) => [r.code, r.balancesByPeriod])).toEqual([
      ['15200101', { current: 500000 }],
      ['13551501', { current: 100000 }],
    ]);
    expect(rows[0].name).toBe('Propiedades, planta y equipo');
  });

  it('celdas vacías (array sparse) producen campos vacíos en su posición', () => {
    const sparse: unknown[] = [];
    sparse[1] = '11050501';
    sparse[3] = 150000;
    expect(xlsxRowToCsvLine(sparse)).toBe('11050501,,150000');
  });

  it('en la primera línea un ";" de celda no cambia el separador detectado', () => {
    const header = xlsxRowToCsvLine([undefined, 'codigo', 'nombre; descripcion', 'saldo'], true);
    const rows = parseTrialBalanceCSV(`${header}\n11050501,Caja,150000`);
    expect(rows).toHaveLength(1);
    expect(rows[0].balancesByPeriod).toEqual({ current: 150000 });
  });
});

describe('sanitizeSheetLabel', () => {
  it('quita corchetes y saltos que romperían el bloque [period=…]', () => {
    expect(sanitizeSheetLabel('Balance [2025]')).toBe('Balance 2025');
    expect(sanitizeSheetLabel('  ')).toBe('Hoja');
  });
});

// csv-parser-co.test.ts — Regresiones del parser CSV con extractos colombianos
// reales: montos sin centavos, fechas ambiguas, celdas ilegibles, encabezados
// tildados y saldo de cierre en extractos descendentes.

import { describe, it, expect } from 'vitest';
import { csvParser } from '../parsers/csv';

function buildCsv(...rows: string[]): string {
  return rows.join('\n');
}

describe('csvParser — montos sin centavos (bug 1.234.567 → 1.23)', () => {
  it('extracto Bancolombia sin centavos conserva la magnitud real', async () => {
    const csv = buildCsv(
      'fecha;descripcion;debito;credito;saldo',
      '2026-01-10;Recaudo nomina;0;5.000.000;5.000.000',
      '2026-01-12;Pago proveedor;1.234.567;0;3.765.433',
      '2026-01-15;Consignacion;0;$3.450.000;7.215.433',
    );
    const result = await csvParser.parse('extracto.csv', csv);

    expect(result.transactions.map((t) => t.amountCop)).toEqual([
      '5000000.00',
      '-1234567.00',
      '3450000.00',
    ]);
    expect(result.transactions.map((t) => t.runningBalance)).toEqual([
      '5000000.00',
      '3765433.00',
      '7215433.00',
    ]);
    // `endingBalance` alimenta runReconciliation: antes valía '7.21'.
    expect(result.endingBalance).toBe('7215433.00');
    // Con los montos bien parseados el saldo cuadra → sin warnings.
    expect(result.warnings).toEqual([]);
  });

  it('columna "monto" signed sin centavos (-2.500.000)', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      '2026-03-01;Pago proveedor;-2.500.000',
      '2026-03-02;Cuota;12.500',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions[0].amountCop).toBe('-2500000.00');
    expect(result.transactions[1].amountCop).toBe('12500.00');
  });
});

describe('csvParser — defensa en profundidad: continuidad del saldo', () => {
  it('avisa cuando la variación del saldo no cuadra con el movimiento', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto;saldo',
      '2026-01-10;Apertura;1000000;1000000',
      '2026-01-11;Movimiento mal cuadrado;50000;9999999',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.warnings.some((w) => /saldo no cuadra/i.test(w))).toBe(true);
  });
});

describe('csvParser — celdas ilegibles no se degradan a 0', () => {
  it('monto ilegible omite la fila y deja warning (antes valía 0 en silencio)', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      '2026-01-10;Movimiento sano;1.000.000',
      '2026-01-11;Movimiento corrupto;N/A',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.warnings.some((w) => /monto ilegible/i.test(w))).toBe(true);
  });

  it('débito/crédito vacíos siguen valiendo 0 (no rompe el caso normal)', async () => {
    const csv = buildCsv(
      'fecha;descripcion;debito;credito',
      '2026-01-10;Solo credito;;5.000.000',
      '2026-01-11;Solo debito;250.000;',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions.map((t) => t.amountCop)).toEqual(['5000000.00', '-250000.00']);
    expect(result.warnings).toEqual([]);
  });
});

describe('csvParser — fechas', () => {
  it('DD/MM/AAAA se lee como día/mes (Colombia)', async () => {
    const csv = buildCsv('fecha;descripcion;monto', '03/04/2026;Pago;500.000');
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions[0].postedAt).toEqual(new Date('2026-04-03T00:00:00Z'));
  });

  it('MM/DD/AAAA imposible como DD/MM se reinterpreta y avisa (antes daba 2027-03-01)', async () => {
    const csv = buildCsv('fecha;descripcion;monto', '01/15/2026;Pago;500.000');
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions[0].postedAt).toEqual(new Date('2026-01-15T00:00:00Z'));
    expect(result.warnings.some((w) => /MM\/DD/.test(w))).toBe(true);
  });

  it('fecha imposible (31/02/2026) se omite con warning', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      '31/02/2026;Fantasma;1.000',
      '2026-02-28;Real;2.000',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Real');
  });
});

describe('csvParser — encabezados tildados', () => {
  it('acepta "Descripción" con tilde (antes lanzaba "no se encontró columna")', async () => {
    const csv = buildCsv(
      'Fecha;Descripción;Débito;Crédito',
      '2026-01-10;Pago servicios;150.000;0',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Pago servicios');
    expect(result.transactions[0].amountCop).toBe('-150000.00');
  });
});

describe('csvParser — extracto en orden descendente', () => {
  it('endingBalance es el saldo de la fecha más reciente, no el de la última fila', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto;saldo',
      '2026-01-15;Mas reciente;1.000.000;7.000.000',
      '2026-01-10;Mas antiguo;2.000.000;6.000.000',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.endingBalance).toBe('7000000.00');
  });
});

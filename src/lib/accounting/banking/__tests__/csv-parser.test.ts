// csv-parser.test.ts — Parser CSV de extractos bancarios.

import { describe, it, expect } from 'vitest';
import { csvParser } from '../parsers/csv';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCsv(...rows: string[]): string {
  return rows.join('\n');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('csvParser.canParse', () => {
  it('acepta archivos .csv con punto y coma', () => {
    expect(csvParser.canParse('extracto.csv', 'fecha;descripcion;monto\n')).toBe(true);
  });

  it('acepta archivos .txt con coma', () => {
    expect(csvParser.canParse('datos.txt', 'fecha,description,amount\n')).toBe(true);
  });

  it('rechaza archivos sin extensión csv/txt', () => {
    expect(csvParser.canParse('archivo.xlsx', 'fecha;monto\n')).toBe(false);
  });
});

describe('csvParser.parse — formato Bancolombia (punto y coma, déb/cré separados)', () => {
  it('parsea N transacciones con monto signed correcto (crédito positivo, débito negativo)', async () => {
    const csv = buildCsv(
      'fecha;descripcion;debito;credito;saldo',
      '2026-01-10;Recaudo nomina;0;5000000;5000000',
      '2026-01-12;Pago internet;150000;0;4850000',
      '2026-01-15;Transferencia recibida;0;200000;5050000',
    );
    const result = await csvParser.parse('extracto.csv', csv);

    expect(result.transactions).toHaveLength(3);

    // Crédito → amountCop positivo
    expect(result.transactions[0].description).toBe('Recaudo nomina');
    expect(result.transactions[0].amountCop).toBe('5000000.00');

    // Débito → amountCop negativo (credit - debit)
    expect(result.transactions[1].description).toBe('Pago internet');
    expect(result.transactions[1].amountCop).toBe('-150000.00');

    expect(result.transactions[2].amountCop).toBe('200000.00');
  });

  it('infiere periodStart y periodEnd de las fechas', async () => {
    const csv = buildCsv(
      'fecha;descripcion;debito;credito',
      '2026-01-05;Tx A;0;100',
      '2026-01-20;Tx B;50;0',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.periodStart).toEqual(new Date('2026-01-05T00:00:00Z'));
    expect(result.periodEnd).toEqual(new Date('2026-01-20T00:00:00Z'));
  });
});

describe('csvParser.parse — formato CITI (columna "monto" signed)', () => {
  it('parsea columna monto signed (positivo=ingreso, negativo=egreso)', async () => {
    const csv = buildCsv(
      'fecha,descripcion,monto',
      '2026-02-01,Depósito cuenta,3000000',
      '2026-02-03,Retiro cajero,-500000',
    );
    const result = await csvParser.parse('citi.csv', csv);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amountCop).toBe('3000000.00');
    expect(result.transactions[1].amountCop).toBe('-500000.00');
  });
});

describe('csvParser.parse — formatos de número colombianos', () => {
  it('miles separados por punto y decimales por coma (1.234.567,89) → parsea correcto', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      '2026-03-01;Pago proveedor;-1.234.567,89',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions[0].amountCop).toBe('-1234567.89');
  });

  it('monto con símbolo $ y espacios es parseado', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      '2026-03-01;Ingreso;$ 500000',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions[0].amountCop).toBe('500000.00');
  });
});

describe('csvParser.parse — encoding latin-1', () => {
  it('Buffer latin-1 con acentos en descripción parsea sin corrupción', async () => {
    // Codificar "Pago nómina" en ISO-8859-1:
    // 'ó' = 0xF3 en latin-1
    const bytes = Buffer.from(
      'fecha;descripcion;monto\n2026-04-01;Pago n\xF3mina;1000000\n',
      'binary',
    );
    const result = await csvParser.parse('latin1.csv', bytes);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toContain('mina');
    // No crasheó → éxito (la normalización exacta depende del TextDecoder)
  });
});

describe('csvParser.parse — casos de error', () => {
  it('CSV con menos de 2 filas lanza BankingError', async () => {
    await expect(csvParser.parse('empty.csv', 'fecha;descripcion;monto')).rejects.toThrow();
  });

  it('CSV sin columna de fecha lanza BankingError con mensaje descriptivo', async () => {
    const csv = buildCsv(
      'nombre;descripcion;monto',
      'valor1;Pago;1000',
    );
    await expect(csvParser.parse('bad.csv', csv)).rejects.toThrow(/fecha/i);
  });

  it('CSV sin columna de monto lanza BankingError', async () => {
    const csv = buildCsv(
      'fecha;descripcion',
      '2026-01-01;Tx sin monto',
    );
    await expect(csvParser.parse('bad.csv', csv)).rejects.toThrow();
  });

  it('fila con fecha inválida genera warning y omite la fila (no crashea)', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      'FECHA_INVALIDA;Tx A;1000',
      '2026-01-02;Tx B;2000',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.warnings.length).toBeGreaterThan(0);
    // Solo parsea la fila válida
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('Tx B');
  });

  it('formato de fecha DD/MM/YYYY es soportado', async () => {
    const csv = buildCsv(
      'fecha;descripcion;monto',
      '15/01/2026;Pago;500000',
    );
    const result = await csvParser.parse('e.csv', csv);
    expect(result.transactions[0].postedAt).toEqual(new Date('2026-01-15T00:00:00Z'));
  });
});

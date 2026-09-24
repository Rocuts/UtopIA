// ingesta-28: XLSX con varias hojas no duplica saldos.
// ingesta-29: naturaleza PUC de las clases 8 y 9 (y grupos "por contra").
import { describe, it, expect } from 'vitest';
import { Workbook } from 'exceljs';
import { isDebitNaturePuc, parseOpeningBalanceFile } from '../parser';

describe('parseOpeningBalanceFile — XLSX (ingesta-28)', () => {
  it('una copia de la hoja ("Balance (2)") no duplica las líneas; se advierte', async () => {
    const wb = new Workbook();
    for (const name of ['Balance', 'Balance (2)']) {
      const ws = wb.addWorksheet(name);
      ws.addRow(['codigo', 'nombre', 'saldo']);
      ws.addRow(['11050501', 'Caja', 1000]);
      ws.addRow(['31050501', 'Capital', 1000]);
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseOpeningBalanceFile(buf, 'apertura.xlsx');
    expect(r.lines.map((l) => l.accountCode)).toEqual(['11050501', '31050501']);
    expect(r.warnings.some((w) => /Balance \(2\)/.test(w) && /copia o comparativo/.test(w))).toBe(true);
  });
});

describe('naturaleza PUC por clase/grupo (ingesta-29)', () => {
  it('clase 9 es acreedora; 94-96 (por contra) deudoras', () => {
    expect(isDebitNaturePuc('93050501')).toBe(false);
    expect(isDebitNaturePuc('91')).toBe(false);
    expect(isDebitNaturePuc('9405')).toBe(true);
  });

  it('clase 8 es deudora; 84-86 (por contra) acreedoras', () => {
    expect(isDebitNaturePuc('83050501')).toBe(true);
    expect(isDebitNaturePuc('8605')).toBe(false);
  });

  it('clases 1-7 sin cambios', () => {
    expect(['1105', '5105', '6135', '7105'].map(isDebitNaturePuc)).toEqual([true, true, true, true]);
    expect(['2205', '3105', '4135'].map(isDebitNaturePuc)).toEqual([false, false, false]);
  });

  it('un saldo acreedor positivo de 9305 se enruta al crédito (antes al débito)', async () => {
    const csv = [
      'codigo,nombre,saldo',
      '11050501,Caja,1000',
      '31050501,Capital,1000',
      '83050501,Bienes recibidos en custodia,5000',
      '93050501,Acreedoras de control,5000',
    ].join('\n');
    const r = await parseOpeningBalanceFile(csv, 'apertura.csv');
    const l9 = r.lines.find((l) => l.accountCode.startsWith('9'));
    expect(l9).toMatchObject({ debitBalance: '0', creditBalance: '5000.00' });
    const l8 = r.lines.find((l) => l.accountCode.startsWith('8'));
    expect(l8).toMatchObject({ debitBalance: '5000.00', creditBalance: '0' });
  });
});

// ingesta-02 (IW2): el XLSX de apertura usa el MISMO serializador que /api/upload
// (src/lib/upload/xlsx-csv.ts) y los problemas de lectura bloquean.
describe('parseOpeningBalanceFile — serialización XLSX y problemas de lectura (ingesta-02)', () => {
  it('una celda no entera se redondea a centavos antes de serializar (no se lee como miles)', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Balance');
    ws.addRow(['codigo', 'nombre', 'saldo']);
    // Resultado de fórmula con tres decimales: String(234.567) = "234.567",
    // que el parser de texto lee como 234.567 pesos (punto de miles).
    ws.addRow(['11050501', 'Caja', 234.567]);
    ws.addRow(['31050501', 'Capital', 234.57]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseOpeningBalanceFile(buf, 'apertura.xlsx');
    expect(r.lines.find((l) => l.accountCode === '11050501')).toMatchObject({
      debitBalance: '234.57',
      creditBalance: '0',
    });
  });

  it('un ";" en una celda del encabezado no cambia el separador de la hoja', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Balance');
    ws.addRow(['codigo', 'nombre; descripción', 'saldo']);
    ws.addRow(['11050501', 'Caja; menor', 2500]);
    ws.addRow(['31050501', 'Capital', 2500]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseOpeningBalanceFile(buf, 'apertura.xlsx');
    expect(r.lines.map((l) => [l.accountCode, l.debitBalance, l.creditBalance])).toEqual([
      ['11050501', '2500.00', '0'],
      ['31050501', '0', '2500.00'],
    ]);
  });

  it('un saldo ilegible bloquea la importación con la cuenta en el mensaje (no queda en $0)', async () => {
    const csv = [
      'codigo,nombre,saldo',
      '11050501,Caja,#DIV/0!',
      '11100501,Bancos,1000',
      '31050501,Capital,1000',
    ].join('\n');
    await expect(parseOpeningBalanceFile(csv, 'apertura.csv')).rejects.toMatchObject({
      code: 'PARSE_FAILED',
      message: expect.stringContaining('11050501'),
    });
  });
});

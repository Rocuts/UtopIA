import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { generateFinancialExcel } from '../excel-export';

describe('Excel contains all four structured statements', () => {
  it('preserves cash-flow signs and each equity component', async () => {
    const report = makeExportableReport();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateFinancialExcel({ report }) as never);
    for (const name of ['Balance NIIF', 'Estado Resultados', 'Flujos de Efectivo', 'Cambios en Patrimonio']) {
      expect(wb.getWorksheet(name)).toBeDefined();
    }
    const cash = wb.getWorksheet('Flujos de Efectivo')!;
    const values: unknown[][] = [];
    cash.eachRow(row => values.push((row.values as unknown[]).slice(1)));
    expect(values).toContainEqual(['Efectivo al cierre', 1700]);
    expect(values).toContainEqual(['Flujo neto de Inversión', -500]);
    const equity = wb.getWorksheet('Cambios en Patrimonio')!;
    // Fila de cierre localizada por su rótulo: la cabecera ahora incluye la
    // línea de periodo/moneda (reportes-export-14), que desplaza las filas.
    // Auditoría 2026-09-24 (e2e-niif-09): el rótulo de apertura/cierre del ECP
    // es determinista; sin preprocesado no se afirma el 31 de diciembre.
    let closing: ExcelJS.Row | undefined;
    equity.eachRow((row) => { if (row.getCell(1).value === 'Saldo al cierre del periodo 2025') closing = row; });
    expect(closing).toBeDefined();
    expect(closing!.getCell(2).value).toBe(3000);
    expect(closing!.getCell(7).value).toBe(2000);
    expect(closing!.getCell(9).value).toBe(6000);
  });
});

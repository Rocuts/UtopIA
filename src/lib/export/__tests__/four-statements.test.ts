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
    expect(equity.getRow(5).getCell(2).value).toBe(3000);
    expect(equity.getRow(5).getCell(7).value).toBe(2000);
    expect(equity.getRow(5).getCell(9).value).toBe(6000);
  });
});

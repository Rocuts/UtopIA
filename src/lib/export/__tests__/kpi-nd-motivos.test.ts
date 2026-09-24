// ---------------------------------------------------------------------------
// ratios-kpis-07 — el ROE N/D se imprime con el MOTIVO del preprocesador
// ---------------------------------------------------------------------------
// Con patrimonio promedio ≤ 0 el preprocesador publica `controlTotals.roe =
// null` y `kpiNdMotivos.roe` con la causa. El PDF y el Excel ya no recalculan el
// ROE sobre el patrimonio de cierre (un null no cae al fallback), pero la celda
// decía "Patrimonio promedio nulo o anómalo" (PDF) o "△ Calculado sobre
// patrimonio de cierre" (Excel) — esta última describía un cálculo que no se
// hizo. Ambas superficies deben mostrar N/D con el mismo motivo publicado.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { generateFinancialExcel } from '../excel-export';
import { composeEditorialReport } from '../pdf-elite-react';

// Patrimonio 2024 = −$10M y 2025 = +$10M → patrimonio promedio 0 → ROE N/D.
const CSV = [
  'Codigo,Nombre,Nivel,Transaccional,Saldo 2024,Saldo 2025',
  '110505,Caja,Auxiliar,Si,50000000,80000000',
  '220505,Proveedores,Auxiliar,Si,60000000,70000000',
  '310505,Capital,Auxiliar,Si,10000000,10000000',
  '371005,Perdidas acumuladas,Auxiliar,Si,-20000000,-20000000',
  '413505,Ventas,Auxiliar,Si,0,100000000',
  '510506,Sueldos,Auxiliar,Si,0,80000000',
].join('\n');

describe('ratios-kpis-07 — ROE N/D con motivo en PDF y Excel', () => {
  const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
  const ct = pre.primary.controlTotals;
  const motivo = ct.kpiNdMotivos?.roe;

  it('precondición: el preprocesador publica ROE null con motivo', () => {
    expect(ct.roe).toBeNull();
    expect(motivo).toMatch(/patrimonio promedio ≤ 0/);
  });

  it('PDF: la tarjeta ROE es N/D y su nota es el motivo publicado', () => {
    const doc = composeEditorialReport({
      report: makeExportableReport(), preprocessed: pre, pillars: null, language: 'es',
    });
    const roe = doc.kpiGrid.kpis.find((k) => k.label === 'ROE');
    expect(roe?.value).toBe('N/D');
    expect(roe?.note).toBe(motivo);
  });

  it('Excel: la fila ROE es N/D y la nota es el motivo (no "△ calculado sobre cierre")', async () => {
    const buf = await generateFinancialExcel({ report: makeExportableReport(), preprocessed: pre });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('KPIs')!;
    let roeRow: ExcelJS.Row | undefined;
    ws.eachRow((r) => { if (!roeRow && r.getCell(1).value === 'ROE') roeRow = r; });
    expect(roeRow).toBeDefined();
    const values = (roeRow!.values as unknown[]).slice(1);
    // Columna del periodo actual (2025) = N/D; nunca un porcentaje recalculado.
    expect(roeRow!.getCell(3).value).toBe('N/D');
    expect(values).toContain(motivo);
    expect(values.some((v) => typeof v === 'string' && /cierre/.test(v))).toBe(false);
  });
});

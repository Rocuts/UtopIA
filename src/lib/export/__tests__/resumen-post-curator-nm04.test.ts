// ---------------------------------------------------------------------------
// NM-04 (re-auditoría normativa-metricas 2026-09-24): el Excel (KPIs, Resumen,
// Balance sin JSON) y el apéndice del PDF usaban el resumen previo al curator.
// Con un sobregiro reclasificado por R1 imprimían Total Activo 1.150 M junto a
// un balance de 1.180 M y un aviso de descuadre ya resuelto.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { generateFinancialExcel } from '../excel-export';
import { composeEditorialReport } from '../pdf-elite-react/compose';
import { aggregatePillars } from '@/lib/pillars/service';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { FinancialReport } from '@/lib/agents/financial/types';

async function hojas(report: FinancialReport, preprocessed: PreprocessedBalance) {
  const buf = await generateFinancialExcel({ report, preprocessed });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

describe('NM-04 — Excel y apéndice del PDF con el resumen posterior al curator', () => {
  // Sobregiro de −$30M en 1110: R1 lo reclasifica al pasivo. Activo 1.180 M,
  // pasivo 500 M (anclas, balance y PDF); el resumen previo decía 1.150 / 470.
  const CSV = [
    'codigo,nombre,nivel,transaccional,Saldo 2024,Saldo 2025',
    '110505,Caja general,Auxiliar,1,50000000,80000000',
    '111005,Bancos cuenta corriente,Auxiliar,1,150000000,120000000',
    '111010,Bancos cuenta sobregirada,Auxiliar,1,0,-30000000',
    '130505,Clientes nacionales,Auxiliar,1,300000000,360000000',
    '139905,Deterioro clientes,Auxiliar,1,-5000000,-10000000',
    '135515,Retencion en la fuente,Auxiliar,1,20000000,25000000',
    '135518,Impuesto de industria y comercio retenido,Auxiliar,1,0,5000000',
    '143505,Mercancias no fabricadas,Auxiliar,1,200000000,250000000',
    '152405,Maquinaria y equipo,Auxiliar,1,500000000,500000000',
    '159205,Depreciacion acumulada maquinaria,Auxiliar,1,-100000000,-150000000',
    '210505,Bancos nacionales,Auxiliar,1,200000000,180000000',
    '220505,Proveedores nacionales,Auxiliar,1,150000000,170000000',
    '240405,Impuesto de renta vigencia corriente,Auxiliar,1,40000000,60000000',
    '240805,IVA por pagar,Auxiliar,1,30000000,35000000',
    '250505,Salarios por pagar,Auxiliar,1,20000000,25000000',
    '310505,Capital suscrito y pagado,Auxiliar,1,300000000,300000000',
    '370505,Resultados de ejercicios anteriores,Auxiliar,1,180000000,315000000',
    '413550,Comercio al por mayor y menor,Auxiliar,1,1800000000,2000000000',
    '417505,Devoluciones en ventas,Auxiliar,1,0,100000000',
    '421005,Intereses financieros,Auxiliar,1,10000000,20000000',
    '510506,Sueldos administracion,Auxiliar,1,300000000,320000000',
    '516005,Depreciacion edificios admin,Auxiliar,1,30000000,30000000',
    '526005,Depreciacion ventas,Auxiliar,1,20000000,20000000',
    '529505,Comisiones ventas,Auxiliar,1,100000000,110000000',
    '530520,Intereses bancarios,Auxiliar,1,25000000,30000000',
    '531520,Gastos extraordinarios,Auxiliar,1,0,10000000',
    '540505,Impuesto de renta y complementarios,Auxiliar,1,40000000,35000000',
    '613550,Costo de venta de mercancias,Auxiliar,1,1100000000,1200000000',
    '720505,Mano de obra directa,Auxiliar,1,0,100000000',
  ].join('\n');
  const r1 = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
  const stub = (): FinancialReport => ({
    company: { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
    niifAnalysis: { balanceSheet: '', incomeStatement: '', cashFlowStatement: '', equityChangesStatement: '', technicalNotes: '', fullContent: '' },
    strategicAnalysis: { kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '', strategicRecommendations: '', fullContent: '' },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport: '',
    generatedAt: '2026-09-24T00:00:00.000Z',
  }) as FinancialReport;

  it('el escenario reclasifica: controlTotals 1.180 / 500 frente al resumen previo 1.150 / 470', () => {
    expect(r1.primary.controlTotals.activo).toBe(1_180_000_000);
    expect(r1.primary.controlTotals.pasivo).toBe(500_000_000);
    expect(r1.primary.summary.totalAssets).toBe(1_150_000_000);
  });

  it('KPIs y Resumen del Excel publican Total Activo 1.180 M y Total Pasivo 500 M', async () => {
    const wb = await hojas(stub(), r1);
    // reportes-export-20: periodo actual en la columna 2 (antes, la 3).
    const kpis: Record<string, unknown> = {};
    wb.getWorksheet('KPIs')!.eachRow((row) => {
      const label = row.getCell(1).value;
      if (typeof label === 'string') kpis[label] = row.getCell(2).value;
    });
    expect(kpis['Total Activo']).toBe(1_180_000_000);
    expect(kpis['Total Pasivo']).toBe(500_000_000);
    const resumen: Record<string, unknown> = {};
    wb.getWorksheet('Resumen')!.eachRow((row) => {
      const label = row.getCell(1).value;
      if (typeof label === 'string') resumen[label] = row.getCell(2).value;
    });
    expect(resumen['Total Activo']).toBe(1_180_000_000);
    expect(resumen['Total Pasivo']).toBe(500_000_000);
  });

  it('reportes-export-21: la hoja Validación dice que sus discrepancias son previas al Curator y da el estado posterior', async () => {
    expect(r1.primary.discrepancies.length).toBeGreaterThan(0);
    const wb = await hojas(stub(), r1);
    const text: string[] = [];
    wb.getWorksheet('Validacion')!.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string') text.push(v);
    });
    const i = text.findIndex((t) => t === 'DISCREPANCIAS DETECTADAS — 2025');
    expect(i).toBeGreaterThan(-1);
    expect(text[i + 1]).toMatch(/antes de los ajustes del Curator/);
    expect(text[i + 1]).toMatch(/ecuación patrimonial A = P \+ C cuadra/);
  });

  it('la hoja Balance sin JSON suma sus renglones al total impreso', async () => {
    const wb = await hojas(stub(), r1);
    let sec = '';
    let sumAct = 0;
    let sumPas = 0;
    let totAct: unknown = null;
    let totPas: unknown = null;
    wb.getWorksheet('Balance NIIF')!.eachRow((r) => {
      const b = String(r.getCell(2).value ?? '');
      if (b === 'ACTIVO' || b === 'PASIVO' || b === 'PATRIMONIO') sec = b;
      // reportes-export-20: periodo actual en la columna 3 (antes, la 4).
      if (b === 'TOTAL ACTIVO') totAct = r.getCell(3).value;
      if (b === 'TOTAL PASIVO') totPas = r.getCell(3).value;
      if (r.getCell(1).value && typeof r.getCell(3).value === 'number') {
        if (sec === 'ACTIVO') sumAct += r.getCell(3).value as number;
        if (sec === 'PASIVO') sumPas += r.getCell(3).value as number;
      }
    });
    expect(totAct).toBe(1_180_000_000);
    expect(sumAct).toBe(1_180_000_000);
    expect(totPas).toBe(500_000_000);
    expect(sumPas).toBe(500_000_000);
  });

  it('el apéndice del PDF no repite el descuadre previo al curator que ya se resolvió', () => {
    const pillars = aggregatePillars({ snapshot: r1.primary, comparative: r1.comparative ?? undefined });
    const pdf = composeEditorialReport({ report: stub(), preprocessed: r1, pillars, language: 'es' });
    const w = (pdf.appendix as { validationWarnings?: string[] }).validationWarnings ?? [];
    expect(w.join(' ')).not.toMatch(/ecuacion contable no cuadra/i);
    expect(w.join(' ')).not.toContain('1.150.000.000');
  });
});

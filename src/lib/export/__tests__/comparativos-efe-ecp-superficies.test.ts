// ---------------------------------------------------------------------------
// Comparativos del EFE y del ECP en las superficies (pendiente #3 de la
// auditoría integral 2026-09-24, NIIF para las PYMES 3.14)
// ---------------------------------------------------------------------------
// Con tres cortes el Markdown, el PDF Élite y el Excel imprimen la segunda
// columna del EFE (periodo actual | comparativo, el mismo orden en las tres
// superficies) y el ECP de los dos periodos apilado en orden cronológico. Con
// dos cortes imprimen la nota determinista de impracticabilidad en lugar de
// la leyenda genérica. Los prompts y TOTALES VINCULANTES dejan de pedir al
// modelo cifras comparativas del EFE.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  csvDosCortes,
  csvTresCortes,
  informeTresCortes,
  preprocesarTresCortes,
} from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';
import { informeExportable } from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import {
  renderCashFlowStatement,
  renderEquityChanges,
} from '@/lib/agents/financial/agents/renderer';
import { buildNiifAnalystPass2Prompt } from '@/lib/agents/financial/prompts/niif-analyst.prompt';
import { prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import type { CompanyInfo } from '@/lib/agents/financial/types';
import { generateFinancialExcel } from '../excel-export';
import {
  niifJsonToCashFlowTable,
  niifJsonToEquityTable,
} from '../pdf-elite-react/compose-statements-from-json';
import { summaryBandRows } from '../pdf-elite-react/pages/StatementsPages';
import { cashFlowMethodLabel } from '../statement-presentation';

const COMPANY: CompanyInfo = {
  name: 'Demo Tres Cortes SAS',
  nit: '900765432-6',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
};

const tres = () => informeTresCortes(preprocesarTresCortes());
const dos = () => informeTresCortes(preprocesarTresCortes(csvDosCortes()));

async function sheetRows(json: ReturnType<typeof tres>, name: string): Promise<unknown[][]> {
  const buf = await generateFinancialExcel({ report: informeExportable(json) });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(name)!;
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe('Markdown (agents/renderer.ts)', () => {
  it('tres cortes: el EFE tiene la columna 2024 y el ECP apila 2024 y 2025', () => {
    const json = tres();
    const efe = renderCashFlowStatement(json);
    expect(efe).toContain('| Rubro | 2025 | 2024 |');
    expect(efe).toMatch(/\*\*AUMENTO \(DISMINUCIÓN\) NETO EN EFECTIVO\*\* \| \*\*\(\$5\.000\.000,00\)\*\* \| \*\*\$15\.000\.000,00\*\*/);
    expect(efe).toMatch(/Efectivo al inicio del período \| \$35\.000\.000,00 \| \$20\.000\.000,00/);
    expect(efe).not.toMatch(/no presentada/);
    const ecp = renderEquityChanges(json);
    expect(ecp.indexOf('**Periodo 2024**')).toBeGreaterThan(-1);
    expect(ecp.indexOf('**Periodo 2024**')).toBeLessThan(ecp.indexOf('**Periodo 2025**'));
    expect(ecp).toContain('Traslado del resultado 2023 a resultados acumulados');
    expect(ecp).not.toMatch(/no presentada/);
  });

  it('dos cortes: una sola columna y la nota determinista de impracticabilidad', () => {
    const json = dos();
    const efe = renderCashFlowStatement(json);
    expect(efe).toContain('| Rubro | 2025 |');
    expect(efe).not.toContain('| Rubro | 2025 | 2024 |');
    expect(efe).toContain(`> ${json.cashFlow.comparativeNote}`);
    const ecp = renderEquityChanges(json);
    expect(ecp).toContain(`> ${json.equityChanges.comparativeNote}`);
    expect(ecp).not.toContain('**Periodo 2024**');
  });
});

describe('PDF Élite (compose-statements-from-json + StatementsPages)', () => {
  it('tres cortes: EFE en dos columnas (actual | comparativo) sin leyenda; ECP con los dos periodos', () => {
    const json = tres();
    const cf = niifJsonToCashFlowTable(json);
    expect(cf.headers).toEqual(['Concepto', '2025', '2024']);
    expect(cf.legends ?? []).toEqual([]);
    const closing = cf.rows.find((r) => r.account === 'EFECTIVO AL FINAL DEL PERÍODO')!;
    expect(closing.cells).toEqual(['$30.000.000,00', '$35.000.000,00']);
    expect(cf.rows.filter((r) => r.cells.length > 0).every((r) => r.cells.length === 2)).toBe(true);
    expect(cf.subtitle).toMatch(/2025 y 2024/);
    const ec = niifJsonToEquityTable(json);
    const headers = ec.rows.filter((r) => r.cells.length === 0).map((r) => r.account);
    expect(headers).toEqual(['PERIODO 2024', 'PERIODO 2025']);
    expect(ec.legends ?? []).toEqual([]);
  });

  it('dos cortes: una columna, la nota determinista como leyenda y el subtítulo sin el año comparativo', () => {
    const json = dos();
    const cf = niifJsonToCashFlowTable(json);
    expect(cf.headers).toEqual(['Concepto', '2025']);
    expect(cf.legends).toEqual([json.cashFlow.comparativeNote]);
    expect(cf.subtitle).not.toMatch(/2024/);
    const ec = niifJsonToEquityTable(json);
    expect(ec.legends).toEqual([json.equityChanges.comparativeNote]);
  });

  it('la banda inferior resume el periodo actual (no la columna comparativa ni el ECP 2024)', () => {
    const json = tres();
    const band = summaryBandRows(niifJsonToCashFlowTable(json), 'period');
    expect(band.find((b) => b.account === 'EFECTIVO AL FINAL DEL PERÍODO')?.value).toBe('$30.000.000,00');
    const eq = summaryBandRows(niifJsonToEquityTable(json), 'rowTotal');
    expect(eq.map((b) => b.account).join(' | ')).toMatch(/2025/);
    expect(eq.map((b) => b.account).join(' | ')).not.toMatch(/2024/);
    expect(eq[eq.length - 1].value).toBe('$111.000.000,00');
  });
});

describe('Excel (excel-export.ts)', () => {
  it('tres cortes: EFE con columnas 2025 | 2024 y el ECP con los dos periodos', async () => {
    const json = tres();
    const cash = await sheetRows(json, 'Flujos de Efectivo');
    expect(cash[0]).toEqual(['ESTADO DE FLUJOS DE EFECTIVO', '2025', '2024']);
    const cierre = cash.find((r) => r[0] === 'Efectivo al cierre')!;
    expect(cierre.slice(1)).toEqual([30_000_000, 35_000_000]);
    expect(cash.flat().some((c) => typeof c === 'string' && /no presentada/.test(c))).toBe(false);
    // reportes-export-21: el método no se imprime como el literal del enum.
    expect(cash.flat()).not.toContain('indirect');
    expect(cash[cash.length - 1][0]).toBe(cashFlowMethodLabel('indirect', null));
    const equity = await sheetRows(json, 'Cambios en Patrimonio');
    const firsts = equity.map((r) => r[0]);
    expect(firsts.indexOf('Periodo 2024')).toBeGreaterThan(-1);
    expect(firsts.indexOf('Periodo 2024')).toBeLessThan(firsts.indexOf('Periodo 2025'));
  });

  it('dos cortes: una columna y la nota determinista', async () => {
    const json = dos();
    const cash = await sheetRows(json, 'Flujos de Efectivo');
    expect(cash[0]).toEqual(['ESTADO DE FLUJOS DE EFECTIVO', '2025']);
    expect(cash.flat()).toContain(json.cashFlow.comparativeNote);
    const equity = await sheetRows(json, 'Cambios en Patrimonio');
    expect(equity.flat()).toContain(json.equityChanges.comparativeNote);
  });
});

describe('Prompt NIIF y TOTALES VINCULANTES', () => {
  it('el Pass-2 pide amountComparative = null en el EFE y ya no exige cifras comparativas', () => {
    const pp = preprocesarTresCortes();
    const prompt = buildNiifAnalystPass2Prompt(
      { ...COMPANY, comparativePeriod: '2024' },
      'es',
      'COMPARATIVO_COMPLETO',
      {
        totalAssetsPrimary: '1', totalLiabilitiesPrimary: '1', totalEquityPrimary: '1',
        grossProfitPrimary: '1', operatingProfitPrimary: '1', netIncomePrimary: '1',
        totalAssetsComparative: '1', totalLiabilitiesComparative: '1', totalEquityComparative: '1',
        grossProfitComparative: '1', operatingProfitComparative: '1', netIncomeComparative: '1',
        oriComparative: '0',
        curatorFlags: {
          equityConvergenceApplied: false, cashFlowClosureForced: false, negativeAssetReclassified: false,
          presumedCostWarning: false, reclassifiedAmountCop: '0',
        },
      } as Parameters<typeof buildNiifAnalystPass2Prompt>[3],
      pp,
    );
    expect(prompt).toMatch(/amountComparative = null en TODOS los renglones de cashFlow\.sections/);
    expect(prompt).not.toMatch(/amountComparative\\?`? en líneas del EFE y filas del ECP DEBE reflejar esa cifra/);
    expect(prompt).not.toMatch(/EFE y ECP presentan amountPrimary \(2025\) Y amountComparative/);
  });

  it('TOTALES VINCULANTES publica el EFE/ECP comparativo determinista o su nota', async () => {
    const ctx3 = await prepareFinancialContext({ rawData: csvTresCortes(), company: COMPANY, language: 'es' });
    expect(ctx3.bindingTotalsBlock).toContain('## EFE Y ECP DEL PERIODO COMPARATIVO 2024');
    expect(ctx3.bindingTotalsBlock).toMatch(/Variación neta de efectivo: \$15\.000\.000,00 COP/);
    const ctx2 = await prepareFinancialContext({ rawData: csvDosCortes(), company: COMPANY, language: 'es' });
    expect(ctx2.bindingTotalsBlock).toMatch(/- EFE: Estado de flujos de efectivo — información comparativa 2024 no presentada/);
  });
});

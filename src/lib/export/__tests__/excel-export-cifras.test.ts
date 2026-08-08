// excel-export-cifras.test.ts — Auditoría 2026-08, grupo "PDF Élite y Excel".
// ----------------------------------------------------------------------------
// Regresiones de CIFRAS del workbook que descarga el cliente. Defectos fijados:
//
//   1. Balance / P&L se construían desde `preprocessed` (la balanza por clase
//      PUC, PRE-analista) aunque existiera el JSON-strict validado del NIIF
//      Analyst — el mismo que alimentan el PDF y el HTML. Ante cualquier ajuste
//      del analista (reclasificaciones, convergencia patrimonial, cierre
//      virtual) el .xlsx y el HTML decían cifras distintas para el mismo rubro.
//   2. `Math.abs` sobre las cuentas de pasivo y patrimonio convertía un saldo
//      contrario en su opuesto (una pérdida acumulada aparecía como ganancia) y
//      rompía la suma contra el total firmado.
//   3. `UTILIDAD BRUTA` se recalculaba como `ingresos − costos` omitiendo el
//      costo de producción (clase 7).
//   4. La pestaña de KPIs recalculaba ROE sobre patrimonio de CIERRE mientras
//      HTML y PDF usan `controlTotals.roe` (patrimonio PROMEDIO).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';

import { generateFinancialExcel } from '../excel-export';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type {
  ControlTotals,
  PeriodSnapshot,
  PreprocessedBalance,
  PUCClass,
} from '@/lib/preprocessing/trial-balance';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function pucClass(
  code: number,
  name: string,
  accounts: Array<[string, string, number]>,
): PUCClass {
  const total = accounts.reduce((acc, [, , bal]) => acc + bal, 0);
  return {
    code,
    name,
    auxiliaryTotal: total,
    reportedTotal: total,
    discrepancy: 0,
    accounts: accounts.map(([c, n, balance]) => ({
      code: c,
      name: n,
      level: 'auxiliar',
      balance,
      isLeaf: true,
    })),
  };
}

function stubControlTotals(overrides: Partial<ControlTotals> = {}): ControlTotals {
  return {
    activo: 1_000_000_000,
    activoCorriente: 600_000_000,
    activoNoCorriente: 400_000_000,
    pasivo: 400_000_000,
    pasivoCorriente: 300_000_000,
    pasivoNoCorriente: 100_000_000,
    patrimonio: 600_000_000,
    ingresos: 1_500_000_000,
    gastos: 1_300_000_000,
    utilidadNeta: 200_000_000,
    efectivoCuenta11: 150_000_000,
    deudoresCuenta13: 250_000_000,
    cuentasPorPagar23: 80_000_000,
    impuestosCuenta24: 70_000_000,
    obligacionesLaborales25: 30_000_000,
    ...overrides,
  };
}

/**
 * Preprocesado deliberadamente DISTINTO del JSON validado: así un assert sobre
 * la cifra del JSON prueba de qué fuente salió realmente la celda.
 */
function stubPreprocessed(opts: {
  controlTotals?: ControlTotals;
  equityAccounts?: Array<[string, string, number]>;
  totalEquity?: number;
  totalProduction?: number;
} = {}): PreprocessedBalance {
  const equityAccounts = opts.equityAccounts ?? [['3115', 'Capital social', 600_000_000]];
  const totalEquity = opts.totalEquity ?? equityAccounts.reduce((a, [, , b]) => a + b, 0);
  const totalProduction = opts.totalProduction ?? 0;

  const snap: PeriodSnapshot = {
    period: '2026',
    classes: [
      pucClass(1, 'Activo', [['1105', 'Caja', 111_111_111]]),
      pucClass(2, 'Pasivo', [['2205', 'Proveedores', 222_222_222]]),
      pucClass(3, 'Patrimonio', equityAccounts),
      pucClass(4, 'Ingresos', [['4135', 'Comercio', 1_500_000_000]]),
      pucClass(5, 'Gastos', [['5105', 'Personal', 500_000_000]]),
      pucClass(6, 'Costos', [['6135', 'Costo de ventas', 700_000_000]]),
      pucClass(7, 'Producción', [['7105', 'Materia prima', 100_000_000]]),
    ],
    controlTotals: opts.controlTotals ?? stubControlTotals(),
    equityBreakdown: {},
    summary: {
      totalAssets: 111_111_111,
      totalLiabilities: 222_222_222,
      totalEquity,
      totalRevenue: 1_500_000_000,
      totalExpenses: 500_000_000,
      totalCosts: 700_000_000,
      totalProduction,
      netIncome: 1_500_000_000 - 500_000_000 - 700_000_000 - totalProduction,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
  };

  return {
    periods: [snap],
    primary: snap,
    comparative: null,
    rawRows: [],
    auxiliaryCount: 0,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: false,
    reclasificacionesNoCompensacion: [],
  };
}

/** JSON-strict validado — cifras en CENTAVOS. */
function stubNiifJson(): NiifReportJson {
  return {
    company: {
      name: 'Demo SAS',
      nit: '900123456',
      entityType: null,
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2026',
      comparativePeriod: null,
      city: null,
      signatories: null,
    },
    balanceSheet: {
      assets: [
        {
          account: '11', label: 'Efectivo y equivalentes',
          amountPrimary: '15000000000', amountComparative: null,
          level: 2, isAbsolute: true, confidence: null, anomalyFlag: null,
        },
      ],
      liabilities: [
        {
          account: '22', label: 'Proveedores',
          amountPrimary: '40000000000', amountComparative: null,
          level: 2, isAbsolute: true, confidence: null, anomalyFlag: null,
        },
      ],
      equity: [
        {
          account: '31', label: 'Capital social',
          amountPrimary: '60000000000', amountComparative: null,
          level: 2, isAbsolute: true, confidence: null, anomalyFlag: null,
        },
      ],
      // $1.000.000.000,00 — distinto de summary.totalAssets del preprocesado.
      totalAssetsPrimary: '100000000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: '40000000000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: '60000000000',
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [
        {
          account: '41', label: 'Ingresos operacionales',
          amountPrimary: '150000000000', amountComparative: null,
          level: 2, isAbsolute: true, confidence: null, anomalyFlag: null,
        },
      ],
      // $555.000.000,00 — deliberadamente distinto de cualquier recálculo local.
      grossProfitPrimary: '55500000000',
      grossProfitComparative: null,
      operatingProfitPrimary: '30000000000',
      operatingProfitComparative: null,
      netIncomePrimary: '20000000000',
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: [
        { section: 'operating', lines: [], netFlow: '0' },
        { section: 'investing', lines: [], netFlow: '0' },
        { section: 'financing', lines: [], netFlow: '0' },
      ],
      netChange: '0',
      cashOpening: '0',
      cashClosing: '0',
      methodNote: 'indirect',
      degeneracyFlag: null,
    },
    equityChanges: { rows: [], notes: [] },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
    reportMode: null,
  };
}

function stubReport(json?: NiifReportJson): FinancialReport {
  return {
    company: { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', fiscalPeriod: '2026' },
    niifAnalysis: {
      balanceSheet: '',
      incomeStatement: '',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: '',
      ...(json ? { json } : {}),
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '',
      fullContent: '',
    },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport: '',
    generatedAt: '2026-08-07T12:00:00.000Z',
  };
}

// ─── Helpers de lectura del workbook ─────────────────────────────────────────

async function buildWorkbook(
  report: FinancialReport,
  preprocessed?: PreprocessedBalance,
): Promise<ExcelJS.Workbook> {
  const buf = await generateFinancialExcel({ report, preprocessed });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Busca en la hoja la primera fila cuya etiqueta (col 2) sea `label`. */
function findRowByLabel(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (found) return;
    const cell = row.getCell(2).value;
    if (typeof cell === 'string' && cell.trim().toUpperCase() === label.toUpperCase()) {
      found = row;
    }
  });
  return found;
}

/** Busca una fila por su etiqueta en la columna 1 (pestaña KPIs). */
function findKpiRow(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (found) return;
    const cell = row.getCell(1).value;
    if (typeof cell === 'string' && cell.trim() === label) found = row;
  });
  return found;
}

/** Busca una fila de cuenta por su código PUC (col 1). */
function findAccountRow(ws: ExcelJS.Worksheet, code: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (found) return;
    if (String(row.getCell(1).value ?? '').trim() === code) found = row;
  });
  return found;
}

// ─── 1. Precedencia: JSON validado por encima de la balanza cruda ────────────

describe('Balance NIIF — se construye desde el JSON validado del NIIF Analyst', () => {
  it('TOTAL ACTIVO toma la cifra del JSON, no el agregado de la balanza', async () => {
    // El preprocesado dice $111.111.111; el JSON validado dice $1.000.000.000.
    const wb = await buildWorkbook(stubReport(stubNiifJson()), stubPreprocessed());
    const ws = wb.getWorksheet('Balance NIIF')!;
    const row = findRowByLabel(ws, 'TOTAL ACTIVO')!;
    expect(row).toBeDefined();
    expect(row.getCell(3).value).toBe(1_000_000_000);
    expect(row.getCell(3).value).not.toBe(111_111_111);
  });

  it('TOTAL PASIVO + PATRIMONIO cuadra contra el TOTAL ACTIVO del JSON', async () => {
    const wb = await buildWorkbook(stubReport(stubNiifJson()), stubPreprocessed());
    const ws = wb.getWorksheet('Balance NIIF')!;
    expect(findRowByLabel(ws, 'TOTAL PASIVO + PATRIMONIO')!.getCell(3).value).toBe(1_000_000_000);
    expect(findRowByLabel(ws, 'DIFERENCIA (debe ser $0,00)')!.getCell(3).value).toBe(0);
  });

  it('las líneas de detalle salen del JSON (Efectivo y equivalentes)', async () => {
    const wb = await buildWorkbook(stubReport(stubNiifJson()), stubPreprocessed());
    const ws = wb.getWorksheet('Balance NIIF')!;
    const row = findRowByLabel(ws, 'Efectivo y equivalentes')!;
    expect(row).toBeDefined();
    expect(row.getCell(3).value).toBe(150_000_000);
  });

  it('sin JSON validado sigue funcionando el render desde el preprocesado', async () => {
    const wb = await buildWorkbook(stubReport(), stubPreprocessed());
    const ws = wb.getWorksheet('Balance NIIF')!;
    expect(findRowByLabel(ws, 'TOTAL ACTIVO')!.getCell(3).value).toBe(111_111_111);
  });
});

describe('Estado Resultados — UTILIDAD BRUTA', () => {
  it('toma grossProfitPrimary del JSON validado, no un recálculo local', async () => {
    const wb = await buildWorkbook(stubReport(stubNiifJson()), stubPreprocessed());
    const ws = wb.getWorksheet('Estado Resultados')!;
    expect(findRowByLabel(ws, 'UTILIDAD BRUTA')!.getCell(3).value).toBe(555_000_000);
  });

  it('en el fallback del preprocesado resta también el costo de producción (clase 7)', async () => {
    const wb = await buildWorkbook(
      stubReport(),
      stubPreprocessed({ totalProduction: 100_000_000 }),
    );
    const ws = wb.getWorksheet('Estado Resultados')!;
    // 1.500M − 700M (clase 6) − 100M (clase 7) = 700M. Omitir la clase 7 daba 800M.
    expect(findRowByLabel(ws, 'UTILIDAD BRUTA')!.getCell(3).value).toBe(700_000_000);
  });
});

// ─── 2. Signo de pasivo y patrimonio ─────────────────────────────────────────

describe('Signo del patrimonio — Math.abs eliminado', () => {
  const equityAccounts: Array<[string, string, number]> = [
    ['3115', 'Capital social', 10_000_000],
    ['3705', 'Pérdidas acumuladas', -60_000_000],
  ];

  it('una cuenta patrimonial con saldo negativo NO se imprime en positivo', async () => {
    const wb = await buildWorkbook(stubReport(), stubPreprocessed({ equityAccounts }));
    const ws = wb.getWorksheet('Balance NIIF')!;
    const row = findAccountRow(ws, '3705')!;
    expect(row).toBeDefined();
    expect(row.getCell(3).value).toBe(-60_000_000);
  });

  it('las cuentas patrimoniales suman exactamente el TOTAL PATRIMONIO mostrado', async () => {
    const wb = await buildWorkbook(stubReport(), stubPreprocessed({ equityAccounts }));
    const ws = wb.getWorksheet('Balance NIIF')!;
    const lines =
      Number(findAccountRow(ws, '3115')!.getCell(3).value) +
      Number(findAccountRow(ws, '3705')!.getCell(3).value);
    expect(findRowByLabel(ws, 'TOTAL PATRIMONIO')!.getCell(3).value).toBe(lines);
    expect(lines).toBe(-50_000_000);
  });

  it('el formato de celda pinta los negativos entre paréntesis (convención NIIF)', async () => {
    const wb = await buildWorkbook(stubReport(), stubPreprocessed({ equityAccounts }));
    const ws = wb.getWorksheet('Balance NIIF')!;
    expect(findAccountRow(ws, '3705')!.getCell(3).numFmt).toContain('("$"#,##0.00)');
  });
});

// ─── 3. KPIs unificados con controlTotals ────────────────────────────────────

describe('Pestaña KPIs — ratios desde controlTotals (fuente única)', () => {
  it('ROE usa controlTotals.roe (patrimonio promedio), no netIncome/totalEquity', async () => {
    // roe pre-calculado = 15 %. El recálculo local sobre el patrimonio de cierre
    // del stub daría 300M/600M = 50 % — dos ROE distintos para el mismo informe.
    const wb = await buildWorkbook(
      stubReport(),
      stubPreprocessed({ controlTotals: stubControlTotals({ roe: 15 }) }),
    );
    const ws = wb.getWorksheet('KPIs')!;
    expect(Number(findKpiRow(ws, 'ROE')!.getCell(2).value)).toBeCloseTo(0.15, 9);
  });

  it('Endeudamiento y Margen Neto también salen de controlTotals', async () => {
    const wb = await buildWorkbook(
      stubReport(),
      stubPreprocessed({
        controlTotals: stubControlTotals({ endeudamientoTotal: 33.5, margenNeto: 12 }),
      }),
    );
    const ws = wb.getWorksheet('KPIs')!;
    expect(Number(findKpiRow(ws, 'Endeudamiento')!.getCell(2).value)).toBeCloseTo(0.335, 9);
    expect(Number(findKpiRow(ws, 'Margen Neto')!.getCell(2).value)).toBeCloseTo(0.12, 9);
  });

  it('sin campos pre-calculados cae al cálculo local (balances pre-F4)', async () => {
    const wb = await buildWorkbook(stubReport(), stubPreprocessed());
    const ws = wb.getWorksheet('KPIs')!;
    // netIncome 300M / totalEquity 600M = 0,5
    expect(Number(findKpiRow(ws, 'ROE')!.getCell(2).value)).toBeCloseTo(0.5, 9);
  });
});

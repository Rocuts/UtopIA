// ---------------------------------------------------------------------------
// Parte II — dashboard, variaciones y KPIs N/D (re-auditoría final fase 2:
// narrativa-14, narrativa-15)
// ---------------------------------------------------------------------------
// narrativa-14: las filas del dashboard "Ingresos operacionales" / "Ventas
//   netas" no tenían ancla (sólo "no verificable"): $999M con ingresos reales de
//   $100M salían con procedencia verificada, cuando la misma cifra en prosa sí
//   sellaba. Y la variación % de un rubro ("87,5" por 12,5) o la variación
//   interanual de un KPI anclado ("+999,0 pp" en el ROE) no se recalculaban.
// narrativa-15: un KPI publicado N/D (sin ancla) conservaba la cifra del modelo
//   en el comentario ejecutivo, los títulos y los diagnósticos de la Parte II
//   (Markdown, PDF, Excel); y R7 del HTML sólo cazaba la escritura exacta
//   junto al nombre exacto ("24 %" o "margen de EBITDA ajustado … 23,7 %"
//   pasaban).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

let nextJson: unknown = null;
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: structuredClone(nextJson), meta: {} })),
}));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import {
  applyKpiAnchors,
  discardedKpiFigures,
  reconcileStrategyAnchors,
  strategyAnchorSources,
} from '../validators/strategy-anchors';
import { reconcileBindingFigures } from '../agents/html-editor-validator';
import { StrategyReportSchema, type KpiJson, type StrategyReportJson } from '../contracts/strategy-report';
import type { NiifReportJson } from '../contracts/niif-report';
import type { CompanyInfo, NiifAnalysisResult } from '../types';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

/** Dos cortes: Activo 80M→100M, UN 10M→20M, ROE 20 %→33,3 %; ventas 105M − devoluciones 5M + intereses 2M. */
const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,40000000,60000000',
  '130505,Clientes,Auxiliar,1,40000000,40000000',
  '220505,Proveedores,Auxiliar,1,30000000,30000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,0,10000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,10000000,20000000',
  '413505,Ventas,Auxiliar,1,95000000,105000000',
  '417505,Devoluciones en ventas,Auxiliar,1,-5000000,-5000000',
  '421005,Intereses,Auxiliar,1,0,2000000',
  '510505,Sueldos,Auxiliar,1,50000000,52000000',
  '613505,Costo de ventas,Auxiliar,1,30000000,30000000',
].join('\n');
const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const sources = strategyAnchorSources(pp, null);
const cents = (pesos: number) => String(Math.round(pesos * 100));
const COMPANY: CompanyInfo = { name: 'X SAS', nit: '900123456', fiscalPeriod: '2025', entityType: 'SAS' };

function kpi(over: Partial<KpiJson>): KpiJson {
  return {
    category: 'profitability', name: 'ROE', formula: 'UN / Patrimonio', resultPrimary: '33,3', resultComparative: null,
    unit: 'percent', benchmarkBand: { description: '> 15 %', lowerBound: '15', upperBound: null }, diagnosis: 'Sano.',
    yoyVariation: null, confidence: null, anomalyFlag: null, presentationMode: null, baselineLabel: null, sparklinePoints: null,
    ...over,
  } as KpiJson;
}

function strategy(over: Partial<StrategyReportJson> = {}): StrategyReportJson {
  const ct = pp.primary.controlTotals;
  return {
    company: { name: 'X SAS', nit: '900123456', entityType: null, sector: null, niifGroup: 2, fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null },
    reportMode: 'COMPARATIVO_COMPLETO',
    confidence: null,
    executiveDashboard: {
      rows: [{ label: 'Total Activo', primary: cents(ct.activo), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' }],
      executiveCommentary: 'Cierre del ejercicio.',
    },
    technicalAlerts: [],
    kpis: [kpi({})],
    dupontAnalysis: null,
    trends: null,
    breakEven: { fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1', marginOfSafetyPct: '1', classificationNote: 'nota' },
    projectedCashFlow: {
      liquidityGate: {
        triggered: false, currentAssetsCop: cents(ct.activoCorriente), currentLiabilitiesCop: cents(ct.pasivoCorriente),
        gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))), message: null,
      },
      initialCashBalanceCop: cents(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0', scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 's',
    },
    recommendations: [1, 2, 3].map(() => ({
      title: 'Cobrar la cartera', diagnosis: 'Cartera alta.', action: 'Cobrar.', expectedImpact: 'Mejor caja.', priority: 'high', horizon: 'immediate', normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
    ...over,
  } as unknown as StrategyReportJson;
}

const row = (label: string, primary: string, comparative: string | null = null, variationPct: string | null = null) => ({
  label, primary, comparative,
  variation: comparative === null ? null : String(BigInt(primary) - BigInt(comparative)),
  variationPct, commentary: 'c',
});

describe('narrativa-14 — filas de ingresos del dashboard ancladas', () => {
  it('las anclas del caso: operacionales 100M, netos/brutos 102M', () => {
    expect(pp.primary.controlTotals.ingresosOperacionalesNetos).toBe(100_000_000);
  });

  it('"Ingresos operacionales" y "Ventas netas" de $999M (reales $100M) sellan la Parte II', () => {
    const j = strategy({
      executiveDashboard: {
        rows: [row('Ingresos operacionales', cents(999_000_000)), row('Ventas netas', cents(999_000_000))],
        executiveCommentary: 'Cierre.',
      },
    });
    const r = reconcileStrategyAnchors(j, sources);
    expect(r.deviations.filter((d) => /Dashboard — (Ingresos operacionales|Ventas netas)/.test(d))).toHaveLength(2);
    expect(r.unverifiable).not.toEqual(expect.arrayContaining(['Dashboard — Ingresos operacionales']));
  });

  it('las filas de ingresos honestas pasan con cualquiera de sus perímetros (41 − 4175, netos, Clase 4)', () => {
    const j = strategy({
      executiveDashboard: {
        rows: [
          row('Ingresos operacionales', cents(100_000_000), cents(90_000_000), '11,1'),
          row('Ingresos operacionales netos', cents(100_000_000)),
          row('Ventas netas', cents(100_000_000)),
          row('Ingresos netos', cents(102_000_000)),
          row('Total ingresos', cents(102_000_000)),
          row('Ingresos de actividades ordinarias', cents(100_000_000)),
        ],
        executiveCommentary: 'Cierre.',
      },
    });
    const r = reconcileStrategyAnchors(j, sources);
    expect(r.deviations).toEqual([]);
  });

  it('"Ventas" y "Ventas totales" sin "netas" (ventas antes de devoluciones, $105M) no sellan: no verificables (revisión F-html)', () => {
    const j = strategy({
      executiveDashboard: { rows: [row('Ventas', cents(105_000_000)), row('Ventas totales', cents(105_000_000))], executiveCommentary: 'Cierre.' },
    });
    const r = reconcileStrategyAnchors(j, sources);
    expect(r.deviations).toEqual([]);
    expect(r.unverifiable).toEqual(expect.arrayContaining(['Dashboard — Ventas', 'Dashboard — Ventas totales']));
  });

  it('"Ventas brutas" (41 antes de devoluciones) sigue sin ancla: no verificable, no sella', () => {
    const j = strategy({ executiveDashboard: { rows: [row('Ventas brutas', cents(105_000_000))], executiveCommentary: 'Cierre.' } });
    const r = reconcileStrategyAnchors(j, sources);
    expect(r.deviations).toEqual([]);
    expect(r.unverifiable).toContain('Dashboard — Ventas brutas');
  });
});

describe('narrativa-14 — variación % de los rubros y variación interanual de los KPIs anclados', () => {
  const ct = pp.primary.controlTotals;
  const cc = pp.comparative!.controlTotals;
  const activo = (pct: string | null) =>
    strategy({ executiveDashboard: { rows: [row('Total Activo', cents(ct.activo), cents(cc.activo), pct)], executiveCommentary: 'Cierre.' } });

  it('variationPct "87,5" de Total Activo (real 25,0) sella; "25,0", "+25", "25" pasan', () => {
    expect(((ct.activo - cc.activo) / cc.activo) * 100).toBeCloseTo(25, 5);
    expect(reconcileStrategyAnchors(activo('87,5'), sources).deviations.join('\n')).toMatch(/Dashboard — Total Activo: la variación % 87,5 no es \(actual − comparativo\) \/ \|comparativo\| \(25,0 %\)/);
    for (const ok of ['25,0', '+25,0', '25', '25,00']) {
      expect(reconcileStrategyAnchors(activo(ok), sources).deviations).toEqual([]);
    }
  });

  it('una disminución impresa sin signo pasa; con el signo contrario explícito sella', () => {
    const j = (pct: string) =>
      strategy({ executiveDashboard: { rows: [row('Total Pasivo', cents(20_000_000), cents(25_000_000), pct)], executiveCommentary: 'Cierre.' } });
    // Sin ancla que la contradiga, sólo se juzga la aritmética interna de la fila.
    const noAnchor = { niif: null };
    expect(reconcileStrategyAnchors(j('20,0'), noAnchor).deviations.filter((d) => /variación %/.test(d))).toEqual([]);
    expect(reconcileStrategyAnchors(j('-20,0'), noAnchor).deviations.filter((d) => /variación %/.test(d))).toEqual([]);
    expect(reconcileStrategyAnchors(j('+20,0'), noAnchor).deviations.filter((d) => /variación %/.test(d))).toHaveLength(1);
  });

  it('variación % con comparativo cero sella (no tiene base)', () => {
    const j = strategy({ executiveDashboard: { rows: [row('Otros ingresos', cents(2_000_000), '0', '100,0')], executiveCommentary: 'Cierre.' } });
    expect(reconcileStrategyAnchors(j, { niif: null }).deviations.join('\n')).toMatch(/Dashboard — Otros ingresos: la variación % 100,0 no tiene base \(comparativo cero\)/);
  });

  it('yoyVariation "+999,0 pp" del ROE anclado (real 33,3 − 20,0) sella; "+13,3 pp" y "+66,7 %" pasan', () => {
    expect(ct.roe).toBeCloseTo(33.333, 2);
    expect(cc.roe).toBeCloseTo(20, 5);
    const j = (yoy: string) => strategy({ kpis: [kpi({ resultComparative: '20,0', yoyVariation: yoy })] });
    expect(reconcileStrategyAnchors(j('+999,0 pp'), sources).deviations.join('\n')).toMatch(/KPI ROE: la variación interanual \+999,0 pp/);
    for (const ok of ['+13,3 pp', '13,3 p.p.', '+66,7 %', '66,7%', '+13,3']) {
      expect(reconcileStrategyAnchors(j(ok), sources).deviations).toEqual([]);
    }
  });

  it('yoyVariation de un KPI anclado cuyo comparativo es N/D sella; "N/D" pasa', () => {
    const ppNd = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    (ppNd.comparative!.controlTotals as unknown as Record<string, unknown>).roe = null;
    const s = strategyAnchorSources(ppNd, null);
    const j = (yoy: string) => strategy({ kpis: [kpi({ resultComparative: 'ND', yoyVariation: yoy })] });
    expect(reconcileStrategyAnchors(j('+13,3 pp'), s).deviations.join('\n')).toMatch(/KPI ROE: la variación interanual \+13,3 pp no tiene base/);
    expect(reconcileStrategyAnchors(j('N/D'), s).deviations).toEqual([]);
  });
});

describe('narrativa-15 — la cifra de un KPI publicado N/D no sobrevive en la prosa de la Parte II', () => {
  const kpiAjustado = kpi({
    name: 'Margen EBITDA ajustado', formula: '(23,7 M / 100 M) = 23,7', resultPrimary: '23,7',
    benchmarkBand: { description: '> 10 %', lowerBound: '10', upperBound: null }, diagnosis: 'Holgado.',
  });

  it('applyKpiAnchors: comentario, títulos, diagnósticos y acciones pierden "23,7 %" (N/D); la banda y otras cifras quedan', () => {
    const j = strategy({
      executiveDashboard: {
        rows: [row('Total Activo', cents(pp.primary.controlTotals.activo))],
        executiveCommentary: 'El margen EBITDA ajustado de 23,7 % (banda > 10 %) y un índice de solvencia de 4,8 veces muestran holgura.',
      },
      kpis: [kpi({}), kpiAjustado],
      recommendations: [
        { title: 'Sostener el margen EBITDA ajustado de 23,7 %', diagnosis: 'El margen de EBITDA ajustado es de 23,7 %.', action: 'Mantener el margen EBITDA ajustado en 24 %.', expectedImpact: 'Margen Ebitda Ajustado estable (23,70 %).', priority: 'high', horizon: 'immediate', normReference: null },
        { title: 'Cobrar', diagnosis: 'Cartera alta.', action: 'Cobrar.', expectedImpact: 'Caja.', priority: 'high', horizon: 'immediate', normReference: null },
        { title: 'Cobrar', diagnosis: 'Cartera alta.', action: 'Cobrar.', expectedImpact: 'Caja.', priority: 'high', horizon: 'immediate', normReference: null },
      ],
    } as Partial<StrategyReportJson>);
    const out = applyKpiAnchors(j, sources).json;
    const prose = JSON.stringify([out.executiveDashboard.executiveCommentary, out.recommendations[0], out.kpis[1]]);
    expect(prose).not.toMatch(/23[,.]7|\b24 %/);
    expect(out.executiveDashboard.executiveCommentary).toBe(
      'El margen EBITDA ajustado de N/D (banda > 10 %) y un índice de solvencia de 4,8 veces muestran holgura.',
    );
    expect(out.recommendations[0].title).toBe('Sostener el margen EBITDA ajustado de N/D');
    expect(out.recommendations[0].diagnosis).toBe('El margen de EBITDA ajustado es de N/D.');
    expect(out.recommendations[0].action).toBe('Mantener el margen EBITDA ajustado en N/D.');
    // Idempotente (los exportadores la re-aplican sobre el JSON persistido).
    expect(applyKpiAnchors(out, sources).json).toEqual(out);
  });

  it('una cifra con otra unidad o sin el nombre del KPI delante no se toca', () => {
    const j = strategy({
      executiveDashboard: {
        rows: [row('Total Activo', cents(pp.primary.controlTotals.activo))],
        executiveCommentary: 'El margen EBITDA ajustado y la rotación de cartera de 23,7 días explican la caja. La cartera creció 23,7 %.',
      },
      kpis: [kpi({}), kpiAjustado],
    } as Partial<StrategyReportJson>);
    const out = applyKpiAnchors(j, sources).json;
    expect(out.executiveDashboard.executiveCommentary).toBe(
      'El margen EBITDA ajustado y la rotación de cartera de 23,7 días explican la caja. La cartera creció 23,7 %.',
    );
  });

  it('KPI recalculado: la cifra del modelo en prosa se sustituye por la del sistema', () => {
    const j = strategy({
      executiveDashboard: { rows: [row('Total Activo', cents(pp.primary.controlTotals.activo))], executiveCommentary: 'El margen bruto de 64,5 % es holgado.' },
      kpis: [kpi({}), kpi({ name: 'Margen bruto', resultPrimary: '64,5', diagnosis: 'Holgado.' })],
    } as Partial<StrategyReportJson>);
    const out = applyKpiAnchors(j, sources).json;
    expect(pp.primary.controlTotals.margenBruto).toBe(70);
    expect(out.kpis[1].resultPrimary).toBe('70,0');
    expect(out.executiveDashboard.executiveCommentary).toBe('El margen bruto de 70,0 % es holgado.');
  });

  it('runStrategyPhase: el Markdown de la Parte II no conserva la cifra del KPI N/D en ningún texto', async () => {
    const ct = pp.primary.controlTotals;
    nextJson = strategy({
      executiveDashboard: {
        rows: [row('Total Activo', cents(ct.activo))],
        executiveCommentary: 'El margen EBITDA ajustado de 23,7 % y un índice de solvencia de 4,8 veces muestran holgura.',
      },
      kpis: [kpi({}), kpiAjustado],
      projectedCashFlow: {
        liquidityGate: { triggered: false, currentAssetsCop: cents(ct.activoCorriente), currentLiabilitiesCop: cents(ct.pasivoCorriente), gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))), message: null },
        initialCashBalanceCop: cents(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0', scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 's',
      },
      recommendations: [1, 2, 3].map(() => ({
        title: 'Sostener el margen EBITDA ajustado de 23,7 %', diagnosis: 'El margen EBITDA ajustado es de 23,7 %.', action: 'Cobrar.',
        expectedImpact: 'Mejor caja.', priority: 'high', horizon: 'immediate', normReference: null,
      })),
    } as unknown as Partial<StrategyReportJson>);
    expect(StrategyReportSchema.safeParse(nextJson).success).toBe(true);
    const out = await runStrategyPhase({
      niifResult: { fullContent: 'NIIF' } as NiifAnalysisResult, bindingTotals: 'T', preprocessed: pp, company: COMPANY, language: 'es',
    });
    expect(out.fullContent).toMatch(/\| Margen EBITDA ajustado \| [^|]*\| N\/D \|/);
    expect(out.fullContent).not.toMatch(/23,7/);
    expect(out.fullContent).toContain('> El margen EBITDA ajustado de N/D y un índice de solvencia de 4,8 veces');
    expect(out.fullContent).toContain('Sostener el margen EBITDA ajustado de N/D');
  });
});

describe('narrativa-15 — R7 del HTML: nombre plegado y cifra redondeada', () => {
  const C = (p: number) => String(BigInt(p) * BigInt(100));
  const NIIF = {
    company: { fiscalPeriod: '2025', comparativePeriod: null },
    balanceSheet: { totalAssetsPrimary: C(100_000_000), totalLiabilitiesPrimary: C(30_000_000), totalEquityPrimary: C(70_000_000) },
    incomeStatement: { grossProfitPrimary: C(70_000_000), operatingProfitPrimary: C(18_000_000), netIncomePrimary: C(20_000_000), oriPrimary: '0' },
    cashFlow: { cashOpening: C(0), cashClosing: C(60_000_000), netChange: C(60_000_000) },
    equityChanges: { rows: [{ kind: 'closing_balance', total: C(70_000_000) }] },
  } as unknown as NiifReportJson;
  const BASE =
    '<p>Total activos $100.000.000,00; total pasivos $30.000.000,00; total patrimonio $70.000.000,00; ' +
    'utilidad neta $20.000.000,00; utilidad bruta $70.000.000,00; utilidad operacional $18.000.000,00; efectivo al cierre $60.000.000,00.</p>';
  const strategyReport = strategy({
    kpis: [
      kpi({}),
      kpi({ name: 'Margen EBITDA ajustado', resultPrimary: '23,7', benchmarkBand: { description: '> 10 %', lowerBound: '10', upperBound: null } }),
      kpi({ name: 'Margen bruto', resultPrimary: '64,5' }),
    ],
  });
  const r7 = (p: string) =>
    reconcileBindingFigures(`<html><body>${BASE}${p}</body></html>`, { niifReport: NIIF, strategyReport, preprocessed: pp })
      .filter((f) => /KPI sin ancla/.test(f.rule))
      .map((f) => f.detail);

  it('las cifras descartadas del caso', () => {
    const anchored = applyKpiAnchors(strategyReport, strategyAnchorSources(pp, NIIF), { keepWhenNoSource: true }).json;
    expect(discardedKpiFigures(strategyReport, anchored).map((d) => [d.name, d.value, d.published])).toEqual([
      ['Margen EBITDA ajustado', '23,7', 'ND'],
      ['Margen bruto', '64,5', '70,0'],
    ]);
  });

  it('control: la escritura exacta bloquea; la banda sectorial y el N/D no', () => {
    expect(r7('<p>Margen EBITDA ajustado: 23,7 %.</p>')).toHaveLength(1);
    expect(r7('<p>Margen EBITDA ajustado: N/D (banda > 10 %).</p>')).toEqual([]);
  });

  it('"24 %" (redondeo) y "margen de EBITDA ajustado … 23,7 %" (nombre con "de") bloquean', () => {
    expect(r7('<p>Margen EBITDA ajustado: 24 %.</p>')).toHaveLength(1);
    expect(r7('<p>El margen de EBITDA ajustado se ubicó en 23,7 %.</p>')).toHaveLength(1);
    expect(r7('<table><tr><td>MARGEN EBITDA AJUSTADO</td><td>23,70%</td></tr></table>')).toHaveLength(1);
  });

  it('KPI recalculado: la cifra del sistema junto al nombre no bloquea; la del modelo sí', () => {
    expect(r7('<p>El margen bruto fue de 70,0 %.</p>')).toEqual([]);
    expect(r7('<p>El margen bruto fue de 70 %.</p>')).toEqual([]);
    expect(r7('<p>El margen bruto fue de 64,5 %.</p>')).toHaveLength(1);
    expect(r7('<p>El margen bruto fue de 65 %.</p>')).toHaveLength(1);
  });
});

// Revisión adversarial F-html: el modelo recibe los KPI redondeados en
// TOTALES VINCULANTES (1 decimal en %, enteros en días) y calcula la variación
// desde esos valores. Exigirla desde los valores exactos sellaba un informe
// honesto; y el saneamiento sustituía un entero redondeado sin unidad
// ("24 meses") que no es la cifra del KPI.
describe('revisión F-html — variación interanual desde los valores redondeados', () => {
  const withKpi = (field: 'roe' | 'diasCartera', cur: number, prev: number) => {
    const p = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    (p.primary.controlTotals as unknown as Record<string, number>)[field] = cur;
    (p.comparative!.controlTotals as unknown as Record<string, number>)[field] = prev;
    return strategyAnchorSources(p, null);
  };

  it('ROE 15,26 → 12,14 publicado 15,3 / 12,1: "+3,2 pp" y "+26,4 %" pasan; "+4,0 pp" sella', () => {
    const s = withKpi('roe', 15.26, 12.14);
    const j = (yoy: string) => strategy({ kpis: [kpi({ resultPrimary: '15,3', resultComparative: '12,1', yoyVariation: yoy })] });
    for (const ok of ['+3,2 pp', '+3,12 pp', '+26,4 %', '+25,7 %']) {
      expect(reconcileStrategyAnchors(j(ok), s).deviations).toEqual([]);
    }
    expect(reconcileStrategyAnchors(j('+4,0 pp'), s).deviations.join('\n')).toMatch(/KPI ROE: la variación interanual \+4,0 pp no es la del preprocesador \(3,12 puntos o 25,7 %\)/);
  });

  it('días de cartera 45,4 → 30,6 publicados 45 / 31: "+14" pasa; "+30" sella y el mensaje habla en días', () => {
    const s = withKpi('diasCartera', 45.4, 30.6);
    const j = (yoy: string) =>
      strategy({ kpis: [kpi({ name: 'Días de cartera', unit: 'days', resultPrimary: '45', resultComparative: '31', yoyVariation: yoy })] });
    expect(reconcileStrategyAnchors(j('+14'), s).deviations).toEqual([]);
    expect(reconcileStrategyAnchors(j('+30'), s).deviations.join('\n')).toMatch(/\+30 no es la del preprocesador \(14,8 días o 48,4 %\)/);
  });

  it('el saneamiento no toca un entero redondeado sin unidad ("24 meses") y sí "24 %"', () => {
    const j = strategy({
      executiveDashboard: {
        rows: [row('Total Activo', cents(pp.primary.controlTotals.activo))],
        executiveCommentary: 'El margen EBITDA ajustado se calculó sobre 24 meses de datos. El margen EBITDA ajustado de 24 % es holgado.',
      },
      kpis: [kpi({}), kpi({ name: 'Margen EBITDA ajustado', resultPrimary: '23,7' })],
    } as Partial<StrategyReportJson>);
    expect(applyKpiAnchors(j, sources).json.executiveDashboard.executiveCommentary).toBe(
      'El margen EBITDA ajustado se calculó sobre 24 meses de datos. El margen EBITDA ajustado de N/D es holgado.',
    );
  });
});

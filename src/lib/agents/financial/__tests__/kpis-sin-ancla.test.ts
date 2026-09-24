// ---------------------------------------------------------------------------
// Pendiente #2 de la auditoría integral 2026-09-24 — KPIs de la Parte II sin
// ancla determinista
// ---------------------------------------------------------------------------
// Un KPI sin ancla ("Margen EBITDA ajustado", "Índice de solvencia", o todos
// cuando no llegó el preprocesado) se imprimía con la cifra del modelo en el
// visor, el Excel y el HTML, rotulado "no verificable". Ahora se publica N/D
// con motivo, salvo que el preprocesador lo compute (margen bruto, ciclo de
// conversión del efectivo, capital de trabajo): entonces se sobrescribe.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

let nextJson: unknown = null;
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: structuredClone(nextJson), meta: {} })),
}));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import {
  applyKpiAnchors,
  reconcileStrategyAnchors,
  strategyAnchorSources,
} from '@/lib/agents/financial/validators/strategy-anchors';
import { buildHtmlEditorUserContent } from '@/lib/agents/financial/prompts/html-editor.prompt';
import { reconcileBindingFigures } from '@/lib/agents/financial/agents/html-editor-validator';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { makeCoherentNiifReport, makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { KpiJson, StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { NiifAnalysisResult } from '@/lib/agents/financial/types';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '143505,Mercancias,Auxiliar,1,10000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,50000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '413505,Ventas,Auxiliar,1,160000000',
  '510505,Sueldos,Auxiliar,1,80000000',
  '613505,Costo de ventas,Auxiliar,1,60000000',
].join('\n');

const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const ct = pp.primary.controlTotals;
const cents = (pesos: number) => String(Math.round(pesos * 100));
const pct1 = (n: number) => n.toFixed(1).replace('.', ',');

function kpi(over: Partial<KpiJson>): KpiJson {
  return {
    category: 'profitability', name: 'ROE', formula: 'UN / Patrimonio', resultPrimary: pct1(ct.roe!),
    resultComparative: null, unit: 'percent',
    benchmarkBand: { description: '> 15%', lowerBound: '15', upperBound: null },
    diagnosis: 'Alto.', yoyVariation: null, confidence: null, anomalyFlag: null,
    presentationMode: 'baseline_pill', baselineLabel: 'BASELINE 2025', sparklinePoints: null,
    ...over,
  } as KpiJson;
}

/** El modelo emite un KPI anclado, uno sin ancla y tres recomputables (uno con otra cifra). */
function strategy(): StrategyReportJson {
  return {
    company: {
      name: 'Empresa Prueba SAS', nit: '900123456', entityType: null, sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: [{ label: 'Total Activo', primary: cents(ct.activo), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' }],
      executiveCommentary: 'Primer cierre.',
    },
    technicalAlerts: [],
    kpis: [
      kpi({}),
      kpi({
        name: 'Margen EBITDA ajustado', formula: 'EBITDA ajustado / Ingresos = 23,7%', resultPrimary: '23,7',
        diagnosis: 'El margen EBITDA ajustado de 23,7 % supera al sector.',
        anomalyFlag: {
          severity: 'medium', message: 'Fuera de banda sectorial (observado 23,7%)', normaRef: null,
          benchmarkBand: { lowerBound: '10%', upperBound: '20%', observed: '23,7%' },
        },
      }),
      kpi({ name: 'Margen bruto', formula: 'UB / Ventas', resultPrimary: '99,0', diagnosis: 'Margen bruto de 99,0 %.' }),
      kpi({
        category: 'liquidity', name: 'Capital de trabajo neto', formula: 'AC − PC', unit: 'cop',
        resultPrimary: cents(ct.capitalTrabajo!), diagnosis: 'Holgura de caja.',
      }),
      kpi({ category: 'efficiency', name: 'Ciclo de conversión del efectivo', unit: 'days', resultPrimary: '10', diagnosis: 'Ciclo corto.' }),
    ],
    dupontAnalysis: null,
    trends: null,
    breakEven: {
      fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1',
      marginOfSafetyPct: '1', classificationNote: 'nota',
    },
    projectedCashFlow: {
      liquidityGate: {
        triggered: false,
        currentAssetsCop: cents(ct.activoCorriente),
        currentLiabilitiesCop: cents(ct.pasivoCorriente),
        gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))),
        message: null,
      },
      initialCashBalanceCop: cents(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    // El contrato exige 3-5 recomendaciones: el Excel sólo re-ancla JSON válidos.
    recommendations: [1, 2, 3].map((i) => ({
      title: `Acción ${i}`, diagnosis: 'Cartera.', action: 'Cobrar.', expectedImpact: 'Caja.',
      priority: 'medium' as const, horizon: 'short_term' as const, normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

const byName = (j: StrategyReportJson, name: string) => j.kpis.find((k) => k.name === name)!;

beforeEach(() => {
  nextJson = null;
});

describe('applyKpiAnchors', () => {
  it('las anclas del caso', () => {
    expect(ct.margenBruto).toBeCloseTo(62.5, 6);
    expect(ct.capitalTrabajo).toBe(70_000_000);
    expect(ct.cicloConversionEfectivo === null || typeof ct.cicloConversionEfectivo === 'number').toBe(true);
  });

  it('KPI sin ancla → N/D con motivo; sin la cifra, la fórmula con números ni el diagnóstico del modelo', () => {
    const out = applyKpiAnchors(strategy(), strategyAnchorSources(pp, null));
    const k = byName(out.json, 'Margen EBITDA ajustado');
    expect(k.resultPrimary).toBe('ND');
    expect(k.diagnosis).toMatch(/^N\/D — indicador sin ancla determinista/);
    expect(JSON.stringify(k)).not.toMatch(/23,7/);
    expect(k.anomalyFlag).toBeNull();
    expect(out.neutralized).toEqual(['Margen EBITDA ajustado']);
  });

  it('recomputables se sobrescriben con el preprocesador; el KPI anclado se conserva', () => {
    const out = applyKpiAnchors(strategy(), strategyAnchorSources(pp, null));
    expect(byName(out.json, 'ROE').resultPrimary).toBe(pct1(ct.roe!));
    const mb = byName(out.json, 'Margen bruto');
    expect(mb.resultPrimary).toBe('62,5');
    expect(mb.diagnosis).not.toMatch(/99,0/);
    const wc = byName(out.json, 'Capital de trabajo neto');
    expect(wc.resultPrimary).toBe(cents(70_000_000));
    expect(wc.diagnosis).toBe('Holgura de caja.'); // citaba el mismo valor
    const cce = byName(out.json, 'Ciclo de conversión del efectivo');
    expect(cce.resultPrimary).toBe(
      ct.cicloConversionEfectivo === null ? 'ND' : String(Math.round(ct.cicloConversionEfectivo!)),
    );
    expect(out.recomputed).toEqual(['Margen bruto', 'Capital de trabajo neto', 'Ciclo de conversión del efectivo']);
  });

  it('en la fase sin preprocesado todo KPI (y DuPont) es N/D; en exportación se conservan los anclados', () => {
    const j = strategy();
    j.dupontAnalysis = { roe: '40,0', netMargin: '12,5', assetTurnover: '1,6', financialLeverage: '2,0', drivingFactor: 'margen' };
    const phase = applyKpiAnchors(j, strategyAnchorSources(undefined, makeCoherentNiifReport()));
    expect(phase.json.kpis.every((k) => k.resultPrimary === 'ND')).toBe(true);
    expect(phase.json.dupontAnalysis?.roe).toBe('ND');
    const exported = applyKpiAnchors(j, {}, { keepWhenNoSource: true });
    expect(byName(exported.json, 'ROE').resultPrimary).toBe(pct1(ct.roe!));
    expect(byName(exported.json, 'Margen bruto').resultPrimary).toBe('99,0');
    expect(byName(exported.json, 'Margen EBITDA ajustado').resultPrimary).toBe('ND');
    expect(exported.json.dupontAnalysis?.roe).toBe('40,0');
  });

  it('es idempotente', () => {
    const once = applyKpiAnchors(strategy(), strategyAnchorSources(pp, null));
    const twice = applyKpiAnchors(once.json, strategyAnchorSources(pp, null));
    expect(twice.json).toEqual(once.json);
  });

  it('el validador cruza los recomputables: un margen bruto ajeno en un JSON persistido es desviación', () => {
    const r = reconcileStrategyAnchors(strategy(), strategyAnchorSources(pp, null));
    expect(r.deviations.join(' ')).toMatch(/KPI Margen bruto: el Director de Estrategia emitió 99,0%/);
    const clean = reconcileStrategyAnchors(
      applyKpiAnchors(strategy(), strategyAnchorSources(pp, null)).json,
      strategyAnchorSources(pp, null),
    );
    expect(clean.deviations).toEqual([]);
    expect(clean.unverifiable.join(' ')).not.toMatch(/KPI Margen EBITDA ajustado|KPI Margen bruto/);
  });
});

describe('superficies: fase, Excel y HTML', () => {
  it('runStrategyPhase publica N/D (JSON y Markdown) y recalcula los recomputables', async () => {
    nextJson = strategy();
    const out = await runStrategyPhase({
      niifResult: { fullContent: 'NIIF' } as NiifAnalysisResult,
      bindingTotals: 'TOTALES', preprocessed: pp,
      company: { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' }, language: 'es',
    });
    expect(out.strategyQualifications?.clean).toBe(true);
    expect(byName(out.json!, 'Margen EBITDA ajustado').resultPrimary).toBe('ND');
    expect(out.kpiDashboard).toMatch(/\| Margen EBITDA ajustado \| Margen EBITDA ajustado: sin fórmula determinista \| N\/D \|/);
    expect(out.kpiDashboard).toMatch(/\| Margen bruto \| .* \| 62,5% \|/);
    expect(out.kpiDashboard).toContain('Publicados N/D por no tener ancla determinista');
    expect(out.fullContent).not.toMatch(/23,7|99,0/);
  });

  it('el Excel re-ancla la tabla de KPIs de un informe persistido con la cifra del modelo', async () => {
    const report = makeExportableReport();
    const legacy = strategy();
    report.strategicAnalysis = {
      ...report.strategicAnalysis,
      json: legacy,
      fullContent: [
        '## 1. DASHBOARD EJECUTIVO',
        '',
        '## 2. KPIs FINANCIEROS',
        '',
        '| Categoría | KPI | Fórmula | Resultado | Comparativo | Banda | Variación YoY | Diagnóstico |',
        '|---|---|---|---:|---:|---|---|---|',
        '| profitability | Margen EBITDA ajustado | EBITDA ajustado / Ingresos = 23,7% | 23,7% | — | > 15% | — | El margen EBITDA ajustado de 23,7 % supera al sector. |',
        '',
        '## 3. ANÁLISIS DE TENDENCIAS',
      ].join('\n'),
    };
    const buf = await generateFinancialExcel({ report });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const vals: string[] = [];
    wb.getWorksheet('KPIs')!.eachRow((row) => row.eachCell((c) => {
      if (typeof c.value === 'string') vals.push(c.value);
    }));
    const all = vals.join('\n');
    expect(all).toMatch(/Margen EBITDA ajustado \| Margen EBITDA ajustado: sin fórmula determinista \| N\/D/);
    expect(all).not.toMatch(/23,7/);
    expect(all).toContain('3. ANÁLISIS DE TENDENCIAS');
  });

  it('el Editor Jefe HTML recibe el KPI sin ancla como ND y el recomputable con el valor del sistema', () => {
    const content = buildHtmlEditorUserContent({
      niifReport: makeCoherentNiifReport(),
      strategyReport: strategy(),
      governanceReport: {} as never,
      company: { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' } as never,
      metadata: {} as never,
      language: 'es',
      preprocessed: toJsonSafe(pp),
    });
    const block = content.slice(content.indexOf('<strategy_report>'), content.indexOf('</strategy_report>'));
    expect(block).not.toMatch(/23,7|99,0/);
    expect(block).toContain('"resultPrimary": "62,5"');
    expect(block).toContain('"resultPrimary": "ND"');
  });

  describe('R7 del validador HTML: la cifra descartada del modelo no reaparece', () => {
    const html = (rows: string, prose = '') =>
      `<html><body><p>${prose}</p><table>${rows}</table></body></html>`;
    const r7 = (h: string, preprocessed: typeof pp | null = pp) =>
      reconcileBindingFigures(h, {
        niifReport: makeCoherentNiifReport(),
        strategyReport: strategy(),
        governanceReport: {},
        preprocessed,
      }).filter((f) => /KPI sin ancla con la cifra del modelo/.test(f.rule));

    it('KPI N/D y recalculados impresos por el sistema: sin hallazgo', () => {
      const h = html(
        '<tr><td>Margen EBITDA ajustado</td><td>N/D</td><td>&gt; 15%</td></tr>' +
          '<tr><td>Margen bruto</td><td>62,5%</td><td>&gt; 15%</td></tr>' +
          `<tr><td>Capital de trabajo neto</td><td>$70.000.000,00</td><td>&gt; 15%</td></tr>`,
        'El margen EBITDA ajustado se publica N/D: no tiene ancla determinista.',
      );
      expect(r7(h)).toEqual([]);
    });

    it('la cifra del modelo de un KPI N/D en la tabla o en la prosa bloquea', () => {
      const tabla = r7(html('<tr><td>Margen EBITDA ajustado</td><td>23,7%</td><td>&gt; 15%</td></tr>'));
      expect(tabla).toHaveLength(1);
      expect(tabla[0].severity).toBe('block');
      expect(tabla[0].detail).toMatch(/"Margen EBITDA ajustado".*\(23,7\)/);
      const prosa = r7(html('', 'El margen EBITDA ajustado de 23.7 % supera al sector.'));
      expect(prosa).toHaveLength(1);
    });

    it('el valor del modelo de un KPI recalculado (margen bruto 99,0 frente a 62,5) bloquea', () => {
      const out = r7(html('<tr><td>Margen bruto</td><td>99,0%</td><td>&gt; 15%</td></tr>'));
      expect(out.map((f) => f.detail).join(' ')).toMatch(/Margen bruto/);
    });

    it('la cifra de otra frase no se atribuye al KPI N/D', () => {
      const out = r7(html('', 'El margen EBITDA ajustado se publica N/D. El margen operativo fue de 23,7 %.'));
      expect(out).toEqual([]);
    });

    it('la banda sectorial del KPI no se confunde con la cifra descartada', () => {
      const j = strategy();
      j.kpis[1] = { ...j.kpis[1], resultPrimary: '15', benchmarkBand: { description: '> 15%', lowerBound: '15', upperBound: null } };
      const out = reconcileBindingFigures(
        html('<tr><td>Margen EBITDA ajustado</td><td>N/D</td><td>&gt; 15%</td></tr>'),
        { niifReport: makeCoherentNiifReport(), strategyReport: j, governanceReport: {}, preprocessed: pp },
      ).filter((f) => /KPI sin ancla/.test(f.rule));
      expect(out).toEqual([]);
    });

    it('R2 ya no admite la cifra COP que el modelo dio a un KPI recalculado', () => {
      const j = strategy();
      j.kpis[3] = { ...j.kpis[3], resultPrimary: cents(55_555_555) };
      const warn = reconcileBindingFigures(
        html('<tr><td>Rubro</td><td>$55.555.555,00</td></tr>'),
        { niifReport: makeCoherentNiifReport(), strategyReport: j, governanceReport: {}, preprocessed: pp },
      ).filter((f) => /cifra no rastreable/.test(f.rule));
      expect(warn.map((f) => f.detail).join(' ')).toContain('$55.555.555,00');
    });
  });
});

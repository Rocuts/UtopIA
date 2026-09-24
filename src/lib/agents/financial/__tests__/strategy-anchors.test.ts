// ---------------------------------------------------------------------------
// pipeline-flujo-05 — validación determinista post-LLM del Director de Estrategia
// ---------------------------------------------------------------------------
// runStrategyPhase devolvía el JSON del Director de Estrategia sin ningún
// cruce: un dashboard ×10, un ROE que contradice DuPont, un comparativo
// inventado para un balance de un solo periodo y un gate de liquidez con AC/PC
// en cero salían con 0 warnings y llegaban al visor, Excel, PDF y HTML.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

let nextJson: unknown = null;
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: nextJson, meta: {} })),
}));
// runStrategyPhase consulta el servicio macro (valoracion-18): sin red en tests.
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import {
  deterministicTrends,
  fmtTrendPct,
  reconcileStrategyAnchors,
  readStrategyQualifications,
  strategyAnchorSources,
} from '@/lib/agents/financial/validators/strategy-anchors';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { NiifAnalysisResult } from '@/lib/agents/financial/types';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const ct = pp.primary.controlTotals;
const cents = (pesos: number) => String(Math.round(pesos * 100));
const pct1 = (n: number) => n.toFixed(1).replace('.', ',');
const ratio2 = (n: number) => n.toFixed(2).replace('.', ',');

/** Lo que el modelo produce cuando copia el bloque vinculante tal cual. */
function coherentStrategy(): StrategyReportJson {
  return {
    company: {
      name: 'X SAS', nit: '900123456', entityType: null, sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: cents(ct.activo), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        { label: 'Utilidad Neta', primary: cents(ct.utilidadNeta), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        // Desde W3-A el EBITDA (definición única computeEbitda) va en TOTALES
        // VINCULANTES: copiar el bloque es copiar el ancla (e2e-niif-14).
        { label: 'EBITDA', primary: cents(ct.ebitda!), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        { label: 'Capital de trabajo neto', primary: '123', comparative: null, variation: null, variationPct: null, commentary: 'Estimado.' },
      ],
      executiveCommentary: 'Primer cierre.',
    },
    technicalAlerts: [],
    kpis: [
      {
        category: 'profitability', name: 'ROE', formula: 'ROE = UtilidadNeta / Patrimonio × 100',
        resultPrimary: pct1(ct.roe!), resultComparative: null, unit: 'percent',
        benchmarkBand: { description: '> 15%', lowerBound: '15', upperBound: null },
        diagnosis: 'Alto.', yoyVariation: null, confidence: null, anomalyFlag: null,
        presentationMode: 'baseline_pill', baselineLabel: 'BASELINE 2025', sparklinePoints: null,
      },
      {
        category: 'liquidity', name: 'Razón Corriente', formula: 'AC / PC',
        resultPrimary: ratio2(ct.razonCorriente!), resultComparative: null, unit: 'ratio',
        benchmarkBand: { description: '> 1,5', lowerBound: '1,5', upperBound: null },
        diagnosis: 'Holgada.', yoyVariation: null, confidence: null, anomalyFlag: null,
        presentationMode: 'baseline_pill', baselineLabel: 'BASELINE 2025', sparklinePoints: null,
      },
    ],
    dupontAnalysis: {
      roe: pct1(ct.roe!),
      netMargin: pct1(ct.margenNeto!),
      assetTurnover: ratio2(ct.rotacionActivos!),
      financialLeverage: ratio2(ct.activoPromedio! / ct.patrimonioPromedio!),
      drivingFactor: 'margen',
    },
    trends: null,
    breakEven: {
      fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1',
      marginOfSafetyPct: '1', classificationNote: 'nota',
    },
    projectedCashFlow: {
      liquidityGate: {
        triggered: ct.activoCorriente < ct.pasivoCorriente,
        currentAssetsCop: cents(ct.activoCorriente),
        currentLiabilitiesCop: cents(ct.pasivoCorriente),
        gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))),
        message: null,
      },
      initialCashBalanceCop: cents(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [],
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

/** El caso del hallazgo: dashboard ×10, ROE ≠ DuPont, comparativo inventado, AC/PC en cero. */
function brokenStrategy(): StrategyReportJson {
  const j = coherentStrategy();
  j.executiveDashboard.rows[0] = {
    label: 'Total Activo',
    primary: String(BigInt(cents(ct.activo)) * BigInt(10)),
    comparative: '150000000000',
    variation: '50000000000',
    variationPct: '33,3',
    commentary: 'creció',
  };
  j.kpis[0] = { ...j.kpis[0], resultPrimary: '45,0', resultComparative: '30,0', yoyVariation: '+15 pp' };
  j.dupontAnalysis = { ...j.dupontAnalysis!, roe: '12,0' };
  j.projectedCashFlow.liquidityGate = {
    triggered: false, currentAssetsCop: '0', currentLiabilitiesCop: '0', gapCop: '0', message: null,
  };
  return j;
}

const NIIF: NiifAnalysisResult = {
  balanceSheet: '', incomeStatement: '', cashFlowStatement: '', equityChangesStatement: '',
  technicalNotes: '', fullContent: 'NIIF',
};

beforeEach(() => {
  nextJson = null;
});

describe('reconcileStrategyAnchors', () => {
  it('una Parte II que copia las anclas sale limpia; lo que no tiene ancla se declara no verificable', () => {
    const r = reconcileStrategyAnchors(coherentStrategy(), { primary: pp.primary, comparative: null });
    expect(r.deviations).toEqual([]);
    expect(r.verifiedCount).toBeGreaterThanOrEqual(8);
    expect(r.unverifiable.join(' ')).toMatch(/Capital de trabajo neto/);
    expect(r.unverifiable.join(' ')).not.toMatch(/EBITDA/);
    expect(r.unverifiable.join(' ')).toMatch(/Punto de equilibrio/);
  });

  it('detecta dashboard ×10, ROE sin ancla, comparativos sin periodo, DuPont ≠ KPI y AC/PC en cero', () => {
    const r = reconcileStrategyAnchors(brokenStrategy(), { primary: pp.primary, comparative: null });
    const all = r.deviations.join('\n');
    expect(all).toMatch(/Dashboard — Total Activo: el Director de Estrategia emitió/);
    expect(all).toMatch(/Total Activo: presenta cifra comparativa o variación sin periodo comparativo/);
    expect(all).toMatch(/KPI ROE: el Director de Estrategia emitió 45,0%/);
    expect(all).toMatch(/KPI ROE: presenta resultado comparativo/);
    expect(all).toMatch(/dos fórmulas de ROE/);
    expect(all).toMatch(/Gate de liquidez — Activo corriente/);
    expect(all).toMatch(/Gate de liquidez — Pasivo corriente/);
  });

  it('un KPI que el preprocesador marca N/D no puede salir con número', () => {
    const j = coherentStrategy();
    const ppSinPasivoCorriente = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    ppSinPasivoCorriente.primary.controlTotals.razonCorriente = null;
    const r = reconcileStrategyAnchors(j, { primary: ppSinPasivoCorriente.primary, comparative: null });
    expect(r.deviations.join(' ')).toMatch(/Razón Corriente: .* N\/D/);
  });

  it('comparativo impracticable cuenta como ausente: un resultado comparativo es desviación', () => {
    const TWO = [
      'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
      '110505,Caja,Auxiliar,1,50000000,50000000',
      '130505,Clientes,Auxiliar,1,40000000,40000000',
      '220505,Proveedores,Auxiliar,1,30000000,30000000',
      '311505,Capital,Auxiliar,1,40000000,40000000',
      '360505,Utilidad del ejercicio,Auxiliar,1,20000000,20000000',
      '410505,Ventas,Auxiliar,1,100000000,100000000',
      '510505,Sueldos,Auxiliar,1,80000000,80000000',
    ].join('\n');
    const pp2 = preprocessTrialBalance(parseTrialBalanceCSV(TWO));
    pp2.comparativos_impracticables = true;
    const sources = strategyAnchorSources(pp2, null);
    expect(sources.comparative).toBeNull();
    const j = coherentStrategy();
    j.kpis[1] = { ...j.kpis[1], resultComparative: '2,90' };
    const r = reconcileStrategyAnchors(j, sources);
    expect(r.deviations.join(' ')).toMatch(/Razón Corriente: presenta resultado comparativo/);
  });

  it('sin preprocesado usa los totales del JSON NIIF como ancla del dashboard', () => {
    const niif = makeCoherentNiifReport();
    const j = coherentStrategy();
    j.executiveDashboard.rows = [
      { label: 'Total Activo', primary: '1000001', comparative: null, variation: null, variationPct: null, commentary: 'x' },
    ];
    const r = reconcileStrategyAnchors(j, { niif });
    expect(r.deviations.join(' ')).toMatch(/Total Activo: el Director de Estrategia emitió/);
    // Sin preprocesado los KPI no son verificables (no se inventa referencia).
    expect(r.unverifiable.join(' ')).toMatch(/KPI ROE/);
  });
});

describe('runStrategyPhase — sella la Parte II ante desviaciones', () => {
  it('Estrategia con cifras sin ancla → strategyQualifications.clean=false, sello y warning', async () => {
    nextJson = brokenStrategy();
    const events: Array<{ type: string }> = [];
    const out = await runStrategyPhase(
      {
        niifResult: NIIF, bindingTotals: 'TOTALES', preprocessed: pp,
        company: { name: 'X SAS', nit: '900123456', fiscalPeriod: '2025' }, language: 'es',
      },
      { onProgress: (e) => events.push(e) },
    );
    expect(out.strategyQualifications?.clean).toBe(false);
    expect(out.kpiDashboard).toContain('ANÁLISIS ESTRATÉGICO CON SALVEDADES');
    expect(out.fullContent).toContain('ANÁLISIS ESTRATÉGICO CON SALVEDADES');
    expect(events.some((e) => e.type === 'warning')).toBe(true);
    // El veredicto sobrevive al viaje por JSON (cliente → /export).
    expect(readStrategyQualifications(JSON.parse(JSON.stringify(out)))?.clean).toBe(false);
  });

  it('Estrategia coherente → limpia, con nota de lo no verificable', async () => {
    nextJson = coherentStrategy();
    const out = await runStrategyPhase({
      niifResult: NIIF, bindingTotals: 'TOTALES', preprocessed: pp,
      company: { name: 'X SAS', nit: '900123456', fiscalPeriod: '2025' }, language: 'es',
    });
    expect(out.strategyQualifications?.clean).toBe(true);
    expect(out.fullContent).not.toContain('CON SALVEDADES');
    expect(out.fullContent).toContain('Verificación determinista de la Parte II');
  });
});

// ---------------------------------------------------------------------------
// e2e-niif-14 (re-auditoría 2026-09): rótulos y KPIs fuera de la regex y
// tendencias con comparativo se declaraban "no verificables" y se exportaban
// con signo o cifra falsos ("Utilidad neta 2025 | $40 M" con pérdida de $40M,
// "EBITDA $25 M" con EBITDA −$20M, "Rentabilidad del patrimonio 25,0 %",
// tendencia de la utilidad neta "+33,3 %" para −$30M → −$40M).
// ---------------------------------------------------------------------------

/** Pérdida en ambos años: UN −30M (2024) → −40M (2025); ingresos 100M → 80M. */
const LOSS_TWO = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '130505,Clientes nacionales,Auxiliar,1,20000000,15000000',
  '152405,Equipo de oficina,Auxiliar,1,50000000,50000000',
  '159205,Depreciacion acumulada equipo,Auxiliar,1,-10000000,-20000000',
  '210505,Bancos nacionales,Auxiliar,1,40000000,45000000',
  '220505,Proveedores nacionales,Auxiliar,1,30000000,25000000',
  '311505,Capital suscrito y pagado,Auxiliar,1,100000000,100000000',
  '360505,Perdida del ejercicio,Auxiliar,1,-30000000,-40000000',
  '370505,Perdidas acumuladas,Auxiliar,1,0,-30000000',
  '410505,Ventas,Auxiliar,1,100000000,80000000',
  '510506,Sueldos,Auxiliar,1,40000000,30000000',
  '516015,Depreciacion equipo,Auxiliar,1,0,10000000',
  '530505,Intereses bancarios,Auxiliar,1,10000000,10000000',
  '613505,Costo de ventas,Auxiliar,1,80000000,70000000',
].join('\n');

describe('reconcileStrategyAnchors — rótulos, KPIs y tendencias (e2e-niif-14)', () => {
  const ppLoss = preprocessTrialBalance(parseTrialBalanceCSV(LOSS_TWO));
  const ctLoss = ppLoss.primary.controlTotals;
  const sources = strategyAnchorSources(ppLoss, null);

  function lossStrategy(): StrategyReportJson {
    const j = coherentStrategy();
    j.company.comparativePeriod = '2024';
    j.reportMode = 'COMPARATIVO_COMPLETO';
    j.executiveDashboard.rows = [];
    j.kpis = [];
    j.dupontAnalysis = null;
    j.projectedCashFlow.liquidityGate = {
      triggered: ctLoss.activoCorriente < ctLoss.pasivoCorriente,
      currentAssetsCop: cents(ctLoss.activoCorriente),
      currentLiabilitiesCop: cents(ctLoss.pasivoCorriente),
      gapCop: String(BigInt(cents(ctLoss.activoCorriente)) - BigInt(cents(ctLoss.pasivoCorriente))),
      message: null,
    };
    return j;
  }

  it('las anclas del caso: UN −40M, EBITDA −20M', () => {
    expect(ctLoss.utilidadNeta).toBe(-40_000_000);
    expect(ctLoss.ebitda).toBe(-20_000_000);
  });

  it('"Utilidad neta 2025" y "EBITDA" con signo o cifra falsos son desviaciones', () => {
    const j = lossStrategy();
    j.executiveDashboard.rows = [
      { label: 'Utilidad neta 2025', primary: '4000000000', comparative: null, variation: null, variationPct: null, commentary: 'x' },
      { label: 'EBITDA', primary: '2500000000', comparative: null, variation: null, variationPct: null, commentary: 'x' },
      { label: 'Utilidad del ejercicio', primary: '-4000000000', comparative: null, variation: null, variationPct: null, commentary: 'x' },
    ];
    const r = reconcileStrategyAnchors(j, sources);
    const all = r.deviations.join('\n');
    expect(all).toMatch(/Dashboard — Utilidad neta 2025: el Director de Estrategia emitió \$40\.000\.000,00/);
    expect(all).toMatch(/Dashboard — EBITDA: el Director de Estrategia emitió \$25\.000\.000,00/);
    expect(all).not.toMatch(/Utilidad del ejercicio/);
    expect(r.unverifiable.join(' ')).not.toMatch(/Utilidad neta 2025|EBITDA/);
  });

  it('EBITDA impreso cuando el preprocesador lo publica N/D es desviación', () => {
    const pp2 = preprocessTrialBalance(parseTrialBalanceCSV(LOSS_TWO));
    pp2.primary.controlTotals.ebitda = null;
    const j = lossStrategy();
    j.executiveDashboard.rows = [
      { label: 'EBITDA', primary: '-2000000000', comparative: null, variation: null, variationPct: null, commentary: 'x' },
    ];
    const r = reconcileStrategyAnchors(j, strategyAnchorSources(pp2, null));
    expect(r.deviations.join(' ')).toMatch(/EBITDA: .* N\/D/);
  });

  it('"Rentabilidad del patrimonio" es el ROE y "Margen EBITDA" se ancla a EBITDA / ingresos operacionales netos', () => {
    const j = lossStrategy();
    const base = coherentStrategy().kpis[0];
    j.kpis = [
      { ...base, name: 'Rentabilidad del patrimonio', resultPrimary: '25,0', resultComparative: null },
      { ...base, name: 'Margen EBITDA', resultPrimary: '31,3', resultComparative: null },
    ];
    const r = reconcileStrategyAnchors(j, sources);
    const all = r.deviations.join('\n');
    expect(all).toMatch(/KPI Rentabilidad del patrimonio: el Director de Estrategia emitió 25,0%/);
    // −20M / 80M = −25,0 %.
    expect(all).toMatch(/KPI Margen EBITDA: el Director de Estrategia emitió 31,3% frente a -25%/);

    j.kpis = [{ ...base, name: 'Margen EBITDA', resultPrimary: '-25,0', resultComparative: null }];
    expect(reconcileStrategyAnchors(j, sources).deviations).toEqual([]);
  });

  it('tendencias con comparativo se recalculan: "+33,3 %" para −30M → −40M es desviación', () => {
    const j = lossStrategy();
    j.trends = {
      yoyRevenue: '+20,0%', yoyEbitda: '+15,0%', yoyNetIncome: '+33,3%', yoyEquity: '+10,0%',
      marginDeltaPp: '+5,0', qualitativeCommentary: 'Crecimiento sano.',
    };
    const all = reconcileStrategyAnchors(j, sources).deviations.join('\n');
    expect(all).toMatch(/Tendencias — Ingresos: el Director de Estrategia emitió \+20,0% frente a -20,0%/);
    expect(all).toMatch(/Tendencias — Utilidad neta: el Director de Estrategia emitió \+33,3% frente a -33,3%/);
    expect(all).toMatch(/Tendencias — Patrimonio/);
    expect(all).toMatch(/Tendencias — EBITDA/);
  });

  it('tendencias correctas (a la precisión impresa) no son desviación', () => {
    const t = deterministicTrends(sources);
    const j = lossStrategy();
    j.trends = {
      yoyRevenue: fmtTrendPct(t.revenue!), yoyEbitda: fmtTrendPct(t.ebitda!), yoyNetIncome: '-33,3%',
      yoyEquity: fmtTrendPct(t.equity!), marginDeltaPp: null, qualitativeCommentary: 'x',
    };
    expect(t.netIncome).toBeCloseTo(-33.333, 2);
    expect(reconcileStrategyAnchors(j, sources).deviations).toEqual([]);
  });

  it('comparativo de saldos de apertura: una tendencia del P&G no tiene base comparable', () => {
    const ppOpen = preprocessTrialBalance(parseTrialBalanceCSV(LOSS_TWO), { openingPeriods: ['2024'] });
    const t = deterministicTrends(strategyAnchorSources(ppOpen, null));
    expect(t.netIncome).toBeNull();
    expect(t.motivo).toMatch(/saldos de apertura/);
    const j = lossStrategy();
    j.trends = {
      yoyRevenue: null, yoyEbitda: null, yoyNetIncome: '-33,3%', yoyEquity: null,
      marginDeltaPp: null, qualitativeCommentary: 'x',
    };
    const r = reconcileStrategyAnchors(j, strategyAnchorSources(ppOpen, null));
    expect(r.deviations.join(' ')).toMatch(/Tendencias — Utilidad neta: .* no tiene base comparable/);
  });
});

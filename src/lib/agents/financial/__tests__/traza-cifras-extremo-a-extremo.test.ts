// ---------------------------------------------------------------------------
// pipeline-flujo-23 — traza de tres cifras de punta a punta
// ---------------------------------------------------------------------------
// Total Activo, Utilidad (pérdida) Neta y Efectivo al cierre recorren
// preprocesado → fase NIIF → Estrategia → Gobierno → HTML → exportación
// (gate, Excel y PDF). En cada salto se comprueba que la cifra que llega es la
// del ancla determinista (con su signo) y que una manipulación del modelo en
// ese salto se detecta: sello de la parte, bloqueo del HTML o del export.
//
// El LLM está mockeado en los tres agentes; el resto (preprocesador,
// validadores, renderers, gates y exportadores) corre en real sobre el
// escenario de pérdida con comparativo de la re-auditoría e2e-niif.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const queue: unknown[] = [];
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: structuredClone(queue.shift()), meta: {} })),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runGovernancePhase, runNiifPhase, runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import { reconcileBindingFigures } from '@/lib/agents/financial/agents/html-editor-validator';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import {
  CSV_PERDIDA_COMPARATIVO,
  clonar,
  informeExportable,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react/compose';
import {
  niifJsonToBalanceTable,
  niifJsonToCashFlowTable,
  niifJsonToIncomeTable,
} from '@/lib/export/pdf-elite-react/compose-statements-from-json';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type {
  CompanyInfo,
  FinancialReport,
  GovernanceResult,
  NiifAnalysisResult,
  StrategicAnalysisResult,
} from '@/lib/agents/financial/types';

const COMPANY: CompanyInfo = {
  name: 'Demo Perdidas SAS',
  nit: '900123456-8',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
};

const pp = preprocesarPerdidaComparativo();
const anchors = pp.primary.controlTotals.cents!;
const cop = (cents: bigint | string) => formatCopFromCents(BigInt(cents), false);

/** Las tres cifras trazadas, en centavos, tal como las fija el preprocesador. */
const TRAZA = {
  activo: anchors.activo as bigint,
  utilidadNeta: anchors.utilidadNeta as bigint,
  efectivo: anchors.efectivoCuenta11 as bigint,
};

function analista(json: NiifReportJson): NiifAnalysisResult {
  return {
    ...toNiifAnalysisResult(json),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  };
}

/** Parte II honesta: dashboard y prosa con las tres cifras. */
function estrategia(over: { utilidadNeta?: string; executive?: string } = {}): StrategyReportJson {
  const ct = pp.primary.controlTotals;
  const cents = (pesos: number) => String(Math.round(pesos * 100));
  return {
    company: {
      name: COMPANY.name, nit: COMPANY.nit, entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null,
    },
    reportMode: 'COMPARATIVO_COMPLETO',
    confidence: null,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: TRAZA.activo.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        { label: 'Utilidad Neta', primary: over.utilidadNeta ?? TRAZA.utilidadNeta.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Pérdida.' },
        { label: 'Efectivo', primary: TRAZA.efectivo.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Caja.' },
      ],
      executiveCommentary:
        over.executive ??
        `El total de activos cerró en ${cop(TRAZA.activo)}, la pérdida neta del ejercicio fue de ` +
          `${cop(-TRAZA.utilidadNeta)} y el efectivo al cierre fue de ${cop(TRAZA.efectivo)}.`,
    },
    technicalAlerts: [],
    kpis: [],
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
      initialCashBalanceCop: TRAZA.efectivo.toString(), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [1, 2, 3].map((i) => ({
      title: `Acción ${i}`, diagnosis: 'Cartera.', action: 'Cobrar.', expectedImpact: 'Caja.',
      priority: 'medium' as const, horizon: 'short_term' as const, normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

/** Parte III honesta: notas y acta con las tres cifras; destinación desde la aritmética. */
function gobierno(nota?: string): GovernanceReportJson {
  const acta = buildActaExpectedArithmetic(COMPANY, pp)!;
  return {
    company: {
      name: COMPANY.name, nit: COMPANY.nit, entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null,
    },
    reportMode: 'COMPARATIVO_COMPLETO',
    signatories: null,
    financialNotes: [
      {
        number: 1, title: 'Situación financiera',
        body:
          nota ??
          `El total de activos asciende a ${cop(TRAZA.activo)} y el efectivo al cierre fue de ${cop(TRAZA.efectivo)}.`,
        normReference: null, materiality: 'material' as const, confidence: null,
      },
    ],
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'Ley 1258 de 2008',
      city: null,
      meetingDate: null,
      convocationStatement: 'Se convocó según los estatutos.',
      quorumStatement: 'Se verificó el quorum deliberatorio.',
      agenda: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` })),
      developments: [
        { itemNumber: 1, body: `La pérdida neta del ejercicio fue de ${cop(-TRAZA.utilidadNeta)}; no hay utilidades por distribuir.` },
      ],
      resultDistribution: {
        netIncomeCop: acta.netIncomeCop,
        applies: acta.distributionApplies,
        lines: acta.lines.map((l) => ({ label: l.label, amountCop: l.amountCop, normReference: l.normReference })),
        neutralProposalText: 'La asamblea decide sobre el tratamiento de la pérdida.',
      },
      capitalizationProposal: {
        applies: acta.capitalizationApplies,
        retainedEarningsBaseCop: acta.capitalizationBaseCop,
        capitalizationAmountCop: acta.capitalizationAmountCop,
        legalReference: 'Art. 30 E.T.',
        body: 'No se propone capitalización.',
      },
      signatures: [
        { role: 'presidente_asamblea', name: null, identification: null },
        { role: 'secretario_asamblea', name: null, identification: null },
        { role: 'representante_legal', name: null, identification: null },
      ],
      fiscalReviewerOpinion: {
        applies: false, reviewerName: null, reviewerTp: null, opinionType: null, opinionBody: null,
        exemptionReason: 'No obligada.',
      },
      closingStatement: 'Se levanta la sesión.',
    },
    complianceChecklist: [],
    disclaimers: [],
    preparerNotes: [],
  } as unknown as GovernanceReportJson;
}

interface Corrida {
  niif: NiifAnalysisResult;
  bindingTotals: string;
  strategy: StrategicAnalysisResult & { strategyQualifications?: { clean: boolean; motivos: string[] } };
  governance: GovernanceResult;
}

async function correr(
  opts: { niif?: NiifReportJson; strategy?: StrategyReportJson; governance?: GovernanceReportJson } = {},
): Promise<Corrida> {
  vi.mocked(runNiifAnalyst).mockResolvedValue(analista(opts.niif ?? informeHonesto(pp)));
  const phase = await runNiifPhase(
    { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es' },
    { preprocessed: pp },
  );
  const handoff = {
    niifResult: phase.niif,
    bindingTotals: phase.context.bindingTotalsBlock,
    preprocessed: pp,
    company: COMPANY,
    language: 'es' as const,
  };
  queue.push(opts.strategy ?? estrategia());
  const strategy = await runStrategyPhase(handoff);
  queue.push(opts.governance ?? gobierno());
  const governance = await runGovernancePhase({ ...handoff, strategyResult: strategy });
  return { niif: phase.niif, bindingTotals: phase.context.bindingTotalsBlock, strategy, governance };
}

/** Informe exportable armado con las salidas reales de las tres fases. */
function informe(c: Corrida): FinancialReport {
  const base = informeExportable(c.niif.json!);
  return {
    ...base,
    niifAnalysis: c.niif,
    strategicAnalysis: c.strategy,
    governance: c.governance,
  };
}

/** HTML mínimo con cada cifra vinculante del JSON NIIF (lo que el Editor Jefe copia). */
function html(json: NiifReportJson, replace: Array<[string, string]> = []): string {
  const rows = [
    ['Total activo', cop(json.balanceSheet.totalAssetsPrimary)],
    ['Total activo 2024', cop(json.balanceSheet.totalAssetsComparative!)],
    ['Total pasivo', cop(json.balanceSheet.totalLiabilitiesPrimary)],
    ['Total pasivo 2024', cop(json.balanceSheet.totalLiabilitiesComparative!)],
    ['Total patrimonio', cop(json.balanceSheet.totalEquityPrimary)],
    ['Total patrimonio 2024', cop(json.balanceSheet.totalEquityComparative!)],
    ['Pérdida bruta', cop(json.incomeStatement.grossProfitPrimary)],
    ['Pérdida operacional', cop(json.incomeStatement.operatingProfitPrimary)],
    ['Pérdida neta del ejercicio', cop(json.incomeStatement.netIncomePrimary)],
    ['Pérdida neta 2024', cop(json.incomeStatement.netIncomeComparative!)],
    ['Efectivo al inicio del período', cop(json.cashFlow.cashOpening)],
    ['Disminución neta del efectivo', cop(json.cashFlow.netChange)],
    ['Efectivo al final del período', cop(json.cashFlow.cashClosing)],
    ['Patrimonio al cierre (ECP)', cop(json.equityChanges.rows.find((r) => r.kind === 'closing_balance')!.total)],
  ];
  let body = rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join('');
  for (const [from, to] of replace) body = body.split(from).join(to);
  return `<html><body><table>${body}</table></body></html>`;
}

const reconciliationBlocks = (h: string, c: Corrida) =>
  reconcileBindingFigures(h, {
    niifReport: c.niif.json!,
    strategyReport: c.strategy.json,
    governanceReport: c.governance.json,
    preprocessed: pp,
  }).filter((f) => f.severity === 'block' && f.rule.startsWith('§1.1'));

beforeEach(() => {
  queue.length = 0;
  vi.mocked(runNiifAnalyst).mockReset();
});

describe('pipeline-flujo-23 — traza de Total Activo, Utilidad Neta y Efectivo de punta a punta', () => {
  it('preprocesado: las tres anclas (A 100M, pérdida −40M, efectivo 5M)', () => {
    expect(TRAZA).toEqual({
      activo: BigInt(10_000_000_000),
      utilidadNeta: BigInt(-4_000_000_000),
      efectivo: BigInt(500_000_000),
    });
  });

  it('la corrida honesta lleva las mismas tres cifras, con signo, por todos los saltos y se exporta', async () => {
    const c = await correr();

    // NIIF: JSON anclado, Markdown determinista y bloque vinculante.
    const j = c.niif.json!;
    expect(c.niif.reconciliation?.clean).toBe(true);
    expect(BigInt(j.balanceSheet.totalAssetsPrimary)).toBe(TRAZA.activo);
    expect(BigInt(j.incomeStatement.netIncomePrimary)).toBe(TRAZA.utilidadNeta);
    expect(BigInt(j.cashFlow.cashClosing)).toBe(TRAZA.efectivo);
    expect(c.niif.fullContent).toContain('$100.000.000,00');
    expect(c.niif.fullContent).toContain('($40.000.000,00)');
    expect(c.niif.fullContent).toContain('$5.000.000,00');

    // Estrategia: dashboard abreviado con signo; Parte II limpia.
    expect(c.strategy.strategyQualifications?.clean).toBe(true);
    expect(c.strategy.kpiDashboard).toContain('| Total Activo | $100 M |');
    expect(c.strategy.kpiDashboard).toContain('| Utilidad Neta | $-40 M |');
    expect(c.strategy.kpiDashboard).toContain('| Efectivo | $5 M |');

    // Gobierno: la pérdida del acta es el ancla; notas y acta sin salvedades.
    expect(c.governance.json?.shareholderMinutes.resultDistribution.netIncomeCop).toBe(TRAZA.utilidadNeta.toString());
    expect(c.governance.actaQualifications?.clean ?? true).toBe(true);
    expect(c.governance.fullContent).not.toContain('CON SALVEDADES');

    // HTML: las cifras vinculantes presentes y con signo → sin bloqueos de reconciliación.
    expect(reconciliationBlocks(html(j), c)).toEqual([]);

    // Exportación: gate servidor sin bloqueos; Excel y PDF con las mismas cifras.
    const report = informe(c);
    expect(financialExportBlockers(report, pp)).toEqual([]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generateFinancialExcel({ report, preprocessed: pp })) as never);
    const rowValue = (sheet: string, label: RegExp): unknown[] => {
      const out: unknown[] = [];
      wb.getWorksheet(sheet)!.eachRow((row) => {
        const cells = (row.values as unknown[]).slice(1);
        if (cells.some((v) => typeof v === 'string' && label.test(v))) {
          out.push(...cells.filter((v) => typeof v === 'number'));
        }
      });
      return out;
    };
    expect(rowValue('Balance NIIF', /^TOTAL ACTIVOS?$/i)).toContain(100_000_000);
    expect(rowValue('Estado Resultados', /NETA DEL PER[IÍ]ODO/i)).toContain(-40_000_000);
    expect(rowValue('Flujos de Efectivo', /^Efectivo al (cierre|final)/i)).toContain(5_000_000);

    const cells = (t: { rows: Array<{ account: string; cells: string[] }> }, label: RegExp) =>
      t.rows.filter((r) => label.test(r.account)).map((r) => r.cells[0]);
    expect(cells(niifJsonToBalanceTable(j), /^TOTAL ACTIVOS?$/i)).toContain('$100.000.000,00');
    expect(cells(niifJsonToIncomeTable(j), /NETA DEL PER[IÍ]ODO/i)).toContain('($40.000.000,00)');
    expect(cells(niifJsonToCashFlowTable(j), /EFECTIVO AL FINAL/i)).toContain('$5.000.000,00');
    const pdf = composeEditorialReport({ report, preprocessed: pp, language: 'es' } as never);
    const kpi = (label: string) => pdf.kpiGrid.kpis.find((k) => k.label === label)?.value;
    expect(kpi('Activo Total')).toBe('$100.000.000,00');
    expect(kpi('Utilidad Neta')).toBe('($40.000.000,00)');
  });

  it('NIIF: un total del activo distinto del ancla sella la fase y bloquea la exportación', async () => {
    const j = clonar(informeHonesto(pp));
    j.balanceSheet.totalAssetsPrimary = (TRAZA.activo + BigInt(1_000_000_000)).toString();
    const c = await correr({ niif: j });
    expect(c.niif.reconciliation?.clean).toBe(false);
    expect(financialExportBlockers(informe(c), pp).length).toBeGreaterThan(0);
  });

  it('Estrategia: la pérdida presentada como utilidad en el dashboard sella la Parte II y bloquea el export', async () => {
    const c = await correr({ strategy: estrategia({ utilidadNeta: (-TRAZA.utilidadNeta).toString() }) });
    expect(c.strategy.strategyQualifications?.clean).toBe(false);
    expect(c.strategy.strategyQualifications?.motivos.join(' ')).toMatch(/Utilidad Neta/);
    expect(financialExportBlockers(informe(c), pp).length).toBeGreaterThan(0);
  });

  it('Gobierno: un total de activos falso en una nota sella la Parte III y bloquea el export', async () => {
    const c = await correr({
      governance: gobierno('El total de activos asciende a $110.000.000,00 al cierre.'),
    });
    expect(c.governance.actaQualifications?.clean).toBe(false);
    expect(c.governance.actaQualifications?.motivos.join(' ')).toMatch(/Total Activo/);
    expect(financialExportBlockers(informe(c), pp).length).toBeGreaterThan(0);
  });

  it('HTML: el activo cambiado o la pérdida sin signo bloquean la emisión', async () => {
    const c = await correr();
    const j = c.niif.json!;
    const activo = reconciliationBlocks(html(j, [['$100.000.000,00', '$110.000.000,00']]), c);
    expect(activo.map((f) => f.detail).join(' ')).toMatch(/Total Activo — período actual vale \$100\.000\.000,00/);
    const signo = reconciliationBlocks(html(j, [['($40.000.000,00)', '$40.000.000,00']]), c);
    expect(signo.length).toBeGreaterThan(0);
    const efectivo = reconciliationBlocks(html(j, [['<td>$5.000.000,00</td>', '<td>$50.000.000,00</td>']]), c);
    expect(efectivo.map((f) => f.detail).join(' ')).toMatch(/Efectivo al final del período vale \$5\.000\.000,00/);
  });
});

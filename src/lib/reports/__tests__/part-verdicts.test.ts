// ---------------------------------------------------------------------------
// Veredictos de las Partes II y III recalculados por el servidor (P1 × P3)
// ---------------------------------------------------------------------------
// `withServerPartVerdicts` corre al persistir la versión (/consolidate) y antes
// del gate de /export (con y sin referencia); `serverActaVerdict` en /html. Un
// sello bloquea el entregable, así que un falso positivo deja un informe
// honesto sin descarga: aquí se fija que la prosa honesta de los tres fixtures
// de referencia (el informe coherente, la traza de punta a punta sobre la
// pérdida con comparativo y el balance real de anclas-pyg-y-comparativo) no se
// acusa, y que las manipulaciones equivalentes sí.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  serverActaVerdict,
  serverStrategyVerdict,
  withServerActaVerdict,
  withServerPartVerdicts,
  withServerStrategyVerdict,
} from '../part-verdicts';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import {
  informeExportable,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { CompanyInfo, FinancialReport, GovernanceResult, StrategicAnalysisResult } from '@/lib/agents/financial/types';
import { PROVENANCE_COMPANY, PROVENANCE_CSV } from './provenance-fixture';
import { COMPLIANCE_CHECKLIST, withCoherentParts } from './coherent-parts';

const cop = (cents: bigint | string) => formatCopFromCents(BigInt(cents), false);
const centsOf = (pesos: number) => String(Math.round(pesos * 100));

/** Parte III: acta con la aritmética esperada y la prosa dada. */
function governanceJson(
  company: CompanyInfo,
  pp: PreprocessedBalance,
  prose: { notes?: string[]; developments?: string[] },
): GovernanceReportJson {
  const acta = buildActaExpectedArithmetic(company, pp)!;
  return {
    company: {
      name: company.name, nit: company.nit, entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: company.fiscalPeriod, comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    signatories: null,
    financialNotes: (prose.notes ?? []).map((body, i) => ({
      number: i + 1, title: `Nota ${i + 1}`, body, normReference: null, materiality: 'material' as const, confidence: null,
    })),
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'Ley 1258 de 2008',
      city: null,
      meetingDate: null,
      convocationStatement: 'Se convocó según los estatutos.',
      quorumStatement: 'Se verificó el quorum deliberatorio.',
      agenda: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` })),
      developments: (prose.developments ?? []).map((body, i) => ({ itemNumber: i + 1, body })),
      resultDistribution: {
        netIncomeCop: acta.netIncomeCop,
        applies: acta.distributionApplies,
        lines: acta.lines.map((l) => ({ label: l.label, amountCop: l.amountCop, normReference: l.normReference })),
        neutralProposalText: 'La asamblea decide sobre la destinación del resultado.',
      },
      capitalizationProposal: {
        applies: acta.capitalizationApplies,
        retainedEarningsBaseCop: acta.capitalizationBaseCop,
        capitalizationAmountCop: acta.capitalizationAmountCop,
        legalReference: 'Art. 30 E.T.',
        body: acta.capitalizationApplies
          ? `Se propone capitalizar ${cop(acta.capitalizationAmountCop)} con cargo al saldo distribuible.`
          : 'No se propone capitalización.',
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
    complianceChecklist: COMPLIANCE_CHECKLIST,
    disclaimers: [],
    preparerNotes: [],
  } as unknown as GovernanceReportJson;
}

/** Parte II válida para el esquema (≥1 KPI, ≥3 recomendaciones) con dashboard y prosa dados. */
function strategyJson(
  company: CompanyInfo,
  pp: PreprocessedBalance,
  o: { rows?: Array<{ label: string; primary: string }>; executive: string; comparativePeriod?: string | null },
): StrategyReportJson {
  const ct = pp.primary.controlTotals;
  return {
    company: {
      name: company.name, nit: company.nit, entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: company.fiscalPeriod, comparativePeriod: o.comparativePeriod ?? null, city: null, signatories: null,
    },
    reportMode: o.comparativePeriod ? 'COMPARATIVO_COMPLETO' : 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: (o.rows ?? []).map((r) => ({
        ...r, comparative: null, variation: null, variationPct: null, commentary: 'Cierre.',
      })),
      executiveCommentary: o.executive,
    },
    technicalAlerts: [],
    kpis: [
      {
        category: 'liquidity', name: 'Capital de trabajo', formula: 'AC − PC',
        resultPrimary: String(BigInt(centsOf(ct.activoCorriente)) - BigInt(centsOf(ct.pasivoCorriente))),
        resultComparative: null, unit: 'cop',
        benchmarkBand: { description: '> 0', lowerBound: '0', upperBound: null },
        diagnosis: 'Holgura de corto plazo.', yoyVariation: null, confidence: null, anomalyFlag: null,
        presentationMode: null, baselineLabel: null, sparklinePoints: null,
      },
    ],
    dupontAnalysis: null,
    trends: null,
    breakEven: {
      fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1',
      marginOfSafetyPct: '1', classificationNote: 'nota',
    },
    projectedCashFlow: {
      liquidityGate: {
        triggered: ct.activoCorriente < ct.pasivoCorriente,
        currentAssetsCop: centsOf(ct.activoCorriente),
        currentLiabilitiesCop: centsOf(ct.pasivoCorriente),
        gapCop: String(BigInt(centsOf(ct.activoCorriente)) - BigInt(centsOf(ct.pasivoCorriente))),
        message: ct.activoCorriente < ct.pasivoCorriente ? 'Brecha de liquidez de corto plazo.' : null,
      },
      initialCashBalanceCop: centsOf(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [1, 2, 3].map((i) => ({
      title: `Acción ${i}`, diagnosis: 'Cartera alta.', action: 'Cobrar.', expectedImpact: 'Mejor caja.',
      priority: 'medium' as const, horizon: 'short_term' as const, normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

// ---------------------------------------------------------------------------
// Traza de punta a punta (pérdida con comparativo, pipeline-flujo-23)
// ---------------------------------------------------------------------------

describe('traza pérdida con comparativo — la prosa honesta no se acusa', () => {
  const pp = preprocesarPerdidaComparativo();
  const company: CompanyInfo = { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 };
  const niif = informeHonesto(pp);
  const a = pp.primary.controlTotals.cents!;
  const activo = a.activo as bigint;
  const utilidad = a.utilidadNeta as bigint;
  const efectivo = a.efectivoCuenta11 as bigint;
  const sources = { company, preprocessed: pp, niifJson: niif };
  const honestGov = () =>
    governanceJson(company, pp, {
      notes: [`El total de activos asciende a ${cop(activo)} y el efectivo al cierre fue de ${cop(efectivo)}.`],
      developments: [`La pérdida neta del ejercicio fue de ${cop(-utilidad)}; no hay utilidades por distribuir.`],
    });
  const honestStrategy = (executive?: string, utilidadRow = utilidad.toString()) =>
    strategyJson(company, pp, {
      comparativePeriod: '2024',
      rows: [
        { label: 'Total Activo', primary: activo.toString() },
        { label: 'Utilidad Neta', primary: utilidadRow },
        { label: 'Efectivo', primary: efectivo.toString() },
      ],
      executive:
        executive ??
        `El total de activos cerró en ${cop(activo)}, la pérdida neta del ejercicio fue de ` +
          `${cop(-utilidad)} y el efectivo al cierre fue de ${cop(efectivo)}.`,
    });

  it('notas, acta y Parte II honestas: veredictos limpios y gate de exportación sin bloqueos', () => {
    expect(serverActaVerdict(honestGov(), sources)).toEqual({ clean: true, motivos: [] });
    expect(serverStrategyVerdict(honestStrategy(), sources)?.clean).toBe(true);

    const base = informeExportable(niif);
    const report: FinancialReport = {
      ...base,
      company,
      strategicAnalysis: { ...base.strategicAnalysis, json: honestStrategy() },
      governance: { ...base.governance, json: honestGov() },
    };
    const checked = withServerPartVerdicts(report, pp);
    expect(checked.governance.actaQualifications).toEqual({ clean: true, motivos: [] });
    expect(checked.strategicAnalysis.strategyQualifications?.clean).toBe(true);
    expect(checked.niifAnalysis.reconciliation?.clean).toBe(true);
    expect(financialExportBlockers(checked, pp)).toEqual([]);
  });

  it('un total de activos falso en una nota o la pérdida como utilidad en el dashboard sí se acusan', () => {
    const gov = honestGov();
    gov.financialNotes[0].body = 'El total de activos asciende a $110.000.000,00 al cierre.';
    const acta = serverActaVerdict(gov, sources);
    expect(acta?.clean).toBe(false);
    expect(acta?.motivos.join(' ')).toMatch(/Total Activo/);

    const strategy = serverStrategyVerdict(honestStrategy(undefined, (-utilidad).toString()), sources);
    expect(strategy?.clean).toBe(false);
    expect(strategy?.motivos.join(' ')).toMatch(/Utilidad Neta/);
  });
});

// ---------------------------------------------------------------------------
// Balance real (grupo-empresarial-2tres-sas, anclas-pyg-y-comparativo)
// ---------------------------------------------------------------------------

async function loadRealBalance(): Promise<PreprocessedBalance> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx'));
  const lines: string[] = [];
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  wb.worksheets[0].eachRow((row) => {
    lines.push(
      (row.values as unknown[])
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return cell(v);
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return cell(o.text ?? (o.result !== undefined ? String(o.result) : String(v)));
        })
        .join(','),
    );
  });
  return preprocessTrialBalance(parseTrialBalanceCSV(lines.slice(7).join('\n')));
}

describe('balance real (anclas-pyg-y-comparativo) — la prosa honesta no se acusa', () => {
  let real: PreprocessedBalance;
  beforeAll(async () => {
    real = await loadRealBalance();
  });

  it('notas, acta y Parte II con las anclas del balance real: veredictos limpios', () => {
    const company: CompanyInfo = {
      name: 'Grupo Empresarial 2 Tres SAS', nit: '901714014', fiscalPeriod: '2025', entityType: 'SAS', niifGroup: 2,
    };
    const c = real.primary.controlTotals.cents!;
    const net = c.utilidadNeta as bigint;
    const prose = [
      `Al 31 de diciembre de 2025 el total de activos asciende a ${cop(c.activo as bigint)} y el total pasivos a ${cop(c.pasivo as bigint)}.`,
      `El patrimonio asciende a ${cop(c.patrimonio as bigint)}.`,
      `La ${net < BigInt(0) ? 'pérdida' : 'utilidad'} neta del ejercicio fue de ${cop(net < BigInt(0) ? -net : net)}.`,
      `Los ingresos netos alcanzaron ${cop(c.ingresosNetos as bigint)}.`,
    ];
    const sources = { company, preprocessed: real };
    const acta = serverActaVerdict(governanceJson(company, real, { notes: [prose[1]], developments: prose }), sources);
    expect(acta).toEqual({ clean: true, motivos: [] });
    const strategy = serverStrategyVerdict(
      strategyJson(company, real, {
        comparativePeriod: real.comparative ? '2024' : null,
        rows: [{ label: 'Total Activo', primary: (c.activo as bigint).toString() }],
        executive: prose.join(' '),
      }),
      sources,
    );
    expect(strategy?.motivos).toEqual([]);
    expect(strategy?.clean).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Informe coherente (makeExportableReport) sobre su balance
// ---------------------------------------------------------------------------

describe('informe coherente — sin falsos positivos y reglas de endurecimiento', () => {
  const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
  if (read.kind !== 'ok') throw new Error('fixture sin balance');
  const pp = read.preprocessed;
  const company: CompanyInfo = { ...PROVENANCE_COMPANY, niifGroup: 2 };
  const honest = () =>
    governanceJson(company, pp, {
      notes: [
        'El efectivo y equivalentes al cierre asciende a $1.700,00.',
        'El total patrimonio es $6.000,00, con reserva legal de $500,00 y capital de $3.000,00.',
      ],
      developments: [
        'Total activos de $10.000,00 y total pasivos de $4.000,00. La utilidad neta del ejercicio fue de $2.000,00.',
      ],
    });

  /** Informe coherente con Parte II estructurada y la Parte III dada (sin JSON si `gov` es undefined). */
  function report(gov: GovernanceReportJson | undefined, extra: Partial<GovernanceResult> = {}): FinancialReport {
    const r = withCoherentParts({ ...makeExportableReport(), company }, pp);
    const governance = { ...r.governance, ...extra };
    if (gov) governance.json = gov;
    else delete governance.json;
    return { ...r, governance };
  }

  it('la prosa honesta deja la reconciliación limpia y el gate sin bloqueos', () => {
    const checked = withServerPartVerdicts(report(honest()), pp);
    expect(checked.governance.actaQualifications).toEqual({ clean: true, motivos: [] });
    expect(checked.niifAnalysis.reconciliation?.clean).toBe(true);
    expect(financialExportBlockers(checked, pp)).toEqual([]);
  });

  it('I3: una Parte III o II sin JSON estructurado válido se sella (antes conservaba el veredicto limpio del cliente)', () => {
    // El texto de esas Partes no tiene cifras estructuradas contra las cuales
    // verificarse ni puede re-renderizarse en el servidor: queda sellado y el
    // gate de exportación lo bloquea.
    const noGov = withServerPartVerdicts(report(undefined, { actaQualifications: { clean: true, motivos: [] } }), pp);
    expect(noGov.governance.actaQualifications?.clean).toBe(false);
    expect(noGov.governance.actaQualifications?.motivos.join(' ')).toMatch(/Parte III no trae cifras estructuradas/);
    expect(noGov.niifAnalysis.reconciliation?.clean).toBe(false);
    expect(financialExportBlockers(noGov, pp)).toContain('El informe contiene salvedades o validaciones bloqueantes.');

    const partial = withServerPartVerdicts(report({ shareholderMinutes: null } as unknown as GovernanceReportJson), pp);
    expect(partial.governance.actaQualifications?.clean).toBe(false);

    const r = report(honest());
    const noStrategy = withServerPartVerdicts(
      { ...r, strategicAnalysis: { ...r.strategicAnalysis, json: undefined, strategyQualifications: { clean: true, motivos: [], noVerificables: [] } } },
      pp,
    );
    expect(noStrategy.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(noStrategy.strategicAnalysis.strategyQualifications?.motivos.join(' ')).toMatch(/Parte II no trae cifras estructuradas/);
  });

  it('un `clean: true` del cliente no levanta el sello; un `clean: false` se conserva', () => {
    const lying = honest();
    lying.shareholderMinutes.developments[0].body = 'La utilidad neta del ejercicio fue de $9.000,00.';
    const tightened = withServerPartVerdicts(report(lying, { actaQualifications: { clean: true, motivos: [] } }), pp);
    expect(tightened.governance.actaQualifications?.clean).toBe(false);
    expect(tightened.niifAnalysis.reconciliation?.clean).toBe(false);

    const kept = withServerActaVerdict(
      { fullContent: 'G', financialNotes: '', shareholderMinutes: '', actaQualifications: { clean: false, motivos: ['m'] } },
      { clean: true, motivos: [] },
    );
    expect(kept.actaQualifications).toEqual({ clean: false, motivos: ['m'] });
    const strategic = withServerStrategyVerdict(
      { fullContent: 'S', strategyQualifications: { clean: false, motivos: ['d'], noVerificables: [] } } as unknown as StrategicAnalysisResult,
      { clean: true, motivos: [], noVerificables: [] },
    );
    expect(strategic.strategyQualifications?.clean).toBe(false);
  });

  it('una Parte III con estructura ilegible no se declara limpia', () => {
    const broken = { financialNotes: 5, shareholderMinutes: null } as unknown;
    const verdict = serverActaVerdict(broken, { company, preprocessed: pp });
    expect(verdict?.clean).toBe(false);
    expect(verdict?.motivos.join(' ')).toMatch(/no pudo cruzarse/);
  });
});

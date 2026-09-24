// ---------------------------------------------------------------------------
// Pendiente #2 de la auditoría integral 2026-09-24 — cifras en prosa
// ---------------------------------------------------------------------------
// Las notas y la prosa de Gobierno/Estrategia se rotulaban como narrativa IA
// no auditada y el HTML bloqueaba contradicciones con anclas (R6), pero los
// montos citados en el acta (desarrollo de los puntos, quorum, texto neutral),
// en las notas a los estados financieros de Gobierno y en la prosa de la
// Parte II no se cruzaban: "la utilidad neta del ejercicio fue de
// $4.000.000,00" (real $20M) o "se decreta un dividendo de $900.000.000,00"
// salían con el acta limpia y exportable.
// ---------------------------------------------------------------------------

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

let nextJson: unknown = null;
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: structuredClone(nextJson), meta: {} })),
}));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { runGovernancePhase, runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import {
  checkGovernanceNarrative,
  checkStrategyNarrative,
  narrativeSourcesFromPreprocessed,
} from '@/lib/agents/financial/validators/narrative-anchors';
import { reconcileStrategyAnchors, strategyAnchorSources } from '@/lib/agents/financial/validators/strategy-anchors';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { CompanyInfo, NiifAnalysisResult, StrategicAnalysisResult } from '@/lib/agents/financial/types';

/** S.A. con utilidad de $20.000.000: la reserva legal es obligatoria. */
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

const COMPANY: CompanyInfo = { name: 'X SA', nit: '900123456', fiscalPeriod: '2025', entityType: 'SA' };
const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const acta = buildActaExpectedArithmetic(COMPANY, pp)!;
const cop = (cents: string | bigint) => formatCopFromCents(BigInt(cents), false);

function govJson(over: {
  notes?: Array<{ number: number; title: string; body: string }>;
  developments?: string[];
  neutralProposalText?: string | null;
} = {}): GovernanceReportJson {
  return {
    company: {
      name: 'X SA', nit: '900123456', entityType: 'SA', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    signatories: null,
    financialNotes: (over.notes ?? [{ number: 1, title: 'Entidad', body: 'Sociedad anónima.' }]).map((n) => ({
      ...n, normReference: null, materiality: 'material' as const, confidence: null,
    })),
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'C.Co.',
      city: null,
      meetingDate: null,
      convocationStatement: 'Se convocó con quince días hábiles de antelación.',
      quorumStatement: 'Se verificó el quorum deliberatorio.',
      agenda: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` })),
      developments: (over.developments ?? []).map((body, i) => ({ itemNumber: i + 1, body })),
      resultDistribution: {
        netIncomeCop: acta.netIncomeCop,
        applies: acta.distributionApplies,
        lines: acta.lines.map((l) => ({ label: l.label, amountCop: l.amountCop, normReference: l.normReference })),
        neutralProposalText: over.neutralProposalText ?? null,
      },
      capitalizationProposal: {
        applies: acta.capitalizationApplies,
        retainedEarningsBaseCop: acta.capitalizationBaseCop,
        capitalizationAmountCop: acta.capitalizationAmountCop,
        legalReference: 'Art. 30 E.T.',
        body: `Se propone capitalizar ${cop(acta.capitalizationAmountCop)} con cargo al saldo distribuible.`,
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
  } as GovernanceReportJson;
}

/** Desarrollo honesto: cifras del balance y de la aritmética, completas, abreviadas y con variación. */
const HONEST_DEVELOPMENTS = [
  `Se aprobaron los estados financieros al 31 de diciembre de 2025: total de activos de $90.000.000,00, ` +
    `total pasivos de $30.000.000,00 y un patrimonio que asciende a $60.000.000,00.`,
  `La utilidad neta del ejercicio fue de $20.000.000,00 ($20 M). La reserva legal del ejercicio es ` +
    `${cop(acta.reservaLegalDelEjercicioCop)}, equivalente al 10 % (Art. 452 C.Co.).`,
  `El saldo distribuible a los accionistas asciende a ${cop(acta.distribuibleCop)}; el mínimo legal a repartir ` +
    `es ${cop(acta.minimoArt155Cop)}. Se propone capitalizar ${cop(acta.capitalizationAmountCop)}.`,
  'Frente al presupuesto, la utilidad neta aumentó $5.000.000,00. Para 2026 se proyecta una utilidad neta de $30.000.000,00.',
  'La sociedad, NIT 900.123.456-7, declara que el efectivo al cierre fue de $50.000.000,00.',
];

const govInput = (preprocessed: PreprocessedBalance | undefined) => ({
  niifResult: { fullContent: 'NIIF' } as NiifAnalysisResult,
  strategyResult: { fullContent: 'E' } as StrategicAnalysisResult,
  bindingTotals: 'TOTALES VINCULANTES',
  preprocessed,
  company: COMPANY,
  language: 'es' as const,
});

beforeEach(() => {
  nextJson = null;
});

describe('Parte III — cifras en prosa del acta y de las notas', () => {
  it('la aritmética del caso: utilidad $20M, reparto y capitalización aplican', () => {
    expect(acta.netIncomeCop).toBe('2000000000');
    expect(acta.distributionApplies).toBe(true);
    expect(acta.capitalizationApplies).toBe(true);
  });

  it('un acta honesta (completas, abreviadas, variaciones, proyecciones, NIT) no se sella', async () => {
    nextJson = govJson({ developments: HONEST_DEVELOPMENTS });
    const g = await runGovernancePhase(govInput(pp));
    expect(g.actaQualifications).toEqual({ clean: true, motivos: [] });
    expect(g.fullContent).not.toContain('CON SALVEDADES');
  });

  it('utilidad neta falsa en el desarrollo de un punto sella el acta', async () => {
    nextJson = govJson({
      developments: [...HONEST_DEVELOPMENTS, 'La utilidad neta del ejercicio fue de $4.000.000,00.'],
    });
    const events: Array<{ type: string; warnings?: string[] }> = [];
    const g = await runGovernancePhase(govInput(pp), { onProgress: (e) => events.push(e as never) });
    expect(g.actaQualifications?.clean).toBe(false);
    expect(g.actaQualifications?.motivos.join('\n')).toMatch(
      /Acta — punto 6 · Utilidad neta: la narrativa imprime \$4\.000\.000,00/,
    );
    expect(g.shareholderMinutes).toContain('PARTE III CON SALVEDADES — CIFRAS EN PROSA SIN RESPALDO');
    expect(g.financialNotes).not.toContain('CON SALVEDADES');
    expect(events.some((e) => e.type === 'warning' && /cifras en prosa/.test(e.warnings?.join(' ') ?? ''))).toBe(true);
  });

  it('un dividendo inventado en el acta sella el acta', async () => {
    nextJson = govJson({ developments: ['Se decreta un dividendo de $900.000.000,00 pagadero en efectivo.'] });
    const g = await runGovernancePhase(govInput(pp));
    expect(g.actaQualifications?.clean).toBe(false);
    expect(g.actaQualifications?.motivos.join(' ')).toMatch(/Dividendos: la narrativa imprime \$900\.000\.000,00/);
  });

  it('una reserva legal o capitalización con otra cifra sella el acta', async () => {
    nextJson = govJson({
      developments: [
        'Se apropia una reserva legal de $6.000.000,00.',
        'Se propone capitalizar $800.000,00 de la utilidad del ejercicio.',
      ],
    });
    const g = await runGovernancePhase(govInput(pp));
    const all = g.actaQualifications?.motivos.join('\n') ?? '';
    expect(all).toMatch(/Reserva legal: la narrativa imprime \$6\.000\.000,00/);
    expect(all).toMatch(/Monto a capitalizar: la narrativa imprime \$800\.000,00/);
  });

  it('un patrimonio falso en una nota sella la Parte III en las notas', async () => {
    nextJson = govJson({
      notes: [{ number: 11, title: 'Patrimonio', body: 'El patrimonio asciende a $77.777.777,00 al cierre.' }],
    });
    const g = await runGovernancePhase(govInput(pp));
    expect(g.actaQualifications?.clean).toBe(false);
    expect(g.actaQualifications?.motivos.join(' ')).toMatch(/Nota 11 — Patrimonio · Total Patrimonio/);
    expect(g.financialNotes).toContain('PARTE III CON SALVEDADES');
    expect(g.shareholderMinutes).not.toContain('PARTE III CON SALVEDADES');
  });

  it('una fecha de corte ajena en la prosa sella la Parte III', () => {
    const r = checkGovernanceNarrative(
      govJson({ developments: ['Se aprueban los estados financieros al 31 de diciembre de 2023.'] }),
      narrativeSourcesFromPreprocessed(pp, null, { acta }),
    );
    expect(r.motivos.join(' ')).toMatch(/corte al 31 de diciembre de 2023/);
  });

  it('sin aritmética del acta, un dividendo con monto en prosa carece de base', async () => {
    const j = govJson({ developments: ['Se decreta un dividendo de $12.000.000,00.'] });
    j.shareholderMinutes.resultDistribution = { netIncomeCop: '0', applies: false, lines: [], neutralProposalText: 'La asamblea decide.' };
    j.shareholderMinutes.capitalizationProposal.applies = false;
    nextJson = j;
    const g = await runGovernancePhase(govInput(undefined));
    expect(g.actaQualifications?.clean).toBe(false);
    expect(g.actaQualifications?.motivos.join(' ')).toMatch(/Dividendos: .*sin base verificable/);
  });

  it('sin menciones con cifra, un acta sin destinación sigue sin veredicto', async () => {
    const j = govJson();
    j.shareholderMinutes.resultDistribution = { netIncomeCop: '0', applies: false, lines: [], neutralProposalText: 'La asamblea decide.' };
    j.shareholderMinutes.capitalizationProposal.applies = false;
    j.shareholderMinutes.capitalizationProposal.capitalizationAmountCop = '0';
    nextJson = j;
    const g = await runGovernancePhase(govInput(undefined));
    expect(g.actaQualifications).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parte II
// ---------------------------------------------------------------------------

const ct = pp.primary.controlTotals;
const cents = (pesos: number) => String(Math.round(pesos * 100));

function strategy(prose: { executive?: string; diagnosis?: string; impact?: string } = {}): StrategyReportJson {
  return {
    company: {
      name: 'X SA', nit: '900123456', entityType: null, sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: cents(ct.activo), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
      ],
      executiveCommentary: prose.executive ?? 'Primer cierre.',
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
      initialCashBalanceCop: cents(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [
      {
        title: 'Optimizar cartera', diagnosis: prose.diagnosis ?? 'Cartera alta.', action: 'Cobrar.',
        expectedImpact: prose.impact ?? 'Mejor caja.', priority: 'high', horizon: 'immediate', normReference: null,
      },
    ],
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

describe('Parte II — cifras en prosa', () => {
  it('prosa honesta (anclas, abreviados, proyecciones, metas y sector) no genera desviaciones', () => {
    const j = strategy({
      executive:
        'El total de activos cerró en $90.000.000,00 y la utilidad neta del ejercicio fue de $20 M; ' +
        'los ingresos operacionales netos sumaron $100.000.000,00.',
      diagnosis: 'El ROE de 33,3 % supera la referencia sectorial de 15 %.',
      impact: 'Se proyectan ingresos operacionales de $150.000.000,00 para 2026 y una utilidad neta objetivo de $40.000.000,00.',
    });
    const r = reconcileStrategyAnchors(j, strategyAnchorSources(pp, null));
    expect(r.deviations).toEqual([]);
  });

  it('utilidad neta ×10 en el comentario ejecutivo o ROE falso en un diagnóstico son desviaciones', () => {
    const j = strategy({
      executive: 'La utilidad neta del ejercicio fue de $200.000.000,00.',
      diagnosis: 'El ROE de 45,0 % es alto.',
    });
    const r = reconcileStrategyAnchors(j, strategyAnchorSources(pp, null));
    const all = r.deviations.join('\n');
    expect(all).toMatch(/Prosa — Comentario ejecutivo · Utilidad neta: la narrativa imprime \$200\.000\.000,00/);
    expect(all).toMatch(/Prosa — Recomendación 1 · ROE: la narrativa imprime 45,0 %/);
  });

  it('runStrategyPhase sella la Parte II por una cifra falsa en prosa', async () => {
    nextJson = strategy({ executive: 'El patrimonio total es de $6.000.000,00.' });
    const out = await runStrategyPhase({
      niifResult: { fullContent: 'NIIF' } as NiifAnalysisResult,
      bindingTotals: 'TOTALES', preprocessed: pp, company: COMPANY, language: 'es',
    });
    expect(out.strategyQualifications?.clean).toBe(false);
    expect(out.strategyQualifications?.motivos.join(' ')).toMatch(/Total Patrimonio: la narrativa imprime \$6\.000\.000,00/);
    expect(out.fullContent).toContain('ANÁLISIS ESTRATÉGICO CON SALVEDADES');
  });
});

// ---------------------------------------------------------------------------
// Sin falsos positivos en los fixtures honestos
// ---------------------------------------------------------------------------

const FIXTURES = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__');

/** El export de ERP real del repo (mismo cargador que anclas-pyg-y-comparativo). */
async function loadRealBalance(): Promise<PreprocessedBalance> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(FIXTURES, 'grupo-empresarial-2tres-sas.xlsx'));
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    lines.push(
      values
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return csvCell(v);
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return csvCell(o.text ?? (o.result !== undefined ? String(o.result) : String(v)));
        })
        .join(','),
    );
  });
  return preprocessTrialBalance(parseTrialBalanceCSV(lines.slice(7).join('\n')));
}

/** Monto abreviado en millones con coma decimal ("$4.196,6 M"). */
function millions(cents: bigint): string {
  const m = Number(cents) / 100 / 1_000_000;
  const abs = Math.abs(m).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return m < 0 ? `($${abs} M)` : `$${abs} M`;
}

describe('sin falsos positivos: informe coherente y corrida real', () => {
  let real: PreprocessedBalance;
  beforeAll(async () => {
    real = await loadRealBalance();
  });

  it('informe coherente (makeCoherentNiifReport): notas y acta con sus cifras no se acusan', () => {
    const niif = makeCoherentNiifReport();
    const j = govJson({
      notes: [
        { number: 3, title: 'Efectivo', body: 'El efectivo y equivalentes al cierre asciende a $1.700,00; al inicio era $1.000,00.' },
        { number: 11, title: 'Patrimonio', body: 'El total patrimonio es $6.000,00, con reserva legal de $500,00 y capital de $3.000,00.' },
      ],
      developments: [
        'Total activos de $10.000,00 y total pasivos de $4.000,00. La utilidad neta del ejercicio fue de $2.000,00.',
      ],
    });
    // Sin aritmética del acta (el informe coherente no trae preprocesado).
    j.shareholderMinutes.capitalizationProposal.applies = false;
    const r = checkGovernanceNarrative(j, { niif });
    expect(r.motivos).toEqual([]);
    expect(r.checked).toBeGreaterThanOrEqual(6);
  });

  it('balance real (grupo-empresarial-2tres-sas): prosa con sus anclas en varios formatos no se acusa', () => {
    const c = real.primary.controlTotals.cents!;
    const company: CompanyInfo = { name: 'Grupo Empresarial 2 Tres SAS', nit: '901714014', fiscalPeriod: '2025', entityType: 'SAS' };
    const realActa = buildActaExpectedArithmetic(company, real);
    const roe = real.primary.controlTotals.roe;
    const prose = [
      `Al 31 de diciembre de 2025 el total de activos asciende a ${cop(c.activo)} (${millions(c.activo)}) y el total pasivos a ${cop(c.pasivo)}.`,
      `El patrimonio asciende a ${cop(c.patrimonio)}.`,
      `La ${c.utilidadNeta < BigInt(0) ? 'pérdida' : 'utilidad'} neta del ejercicio fue de ${cop(c.utilidadNeta)}.`,
      `El efectivo al cierre fue de ${millions(c.efectivoCuenta11)}.`,
      `Los ingresos netos alcanzaron ${cop(c.ingresosNetos)}.`,
      typeof roe === 'number' ? `El ROE fue de ${roe.toFixed(1).replace('.', ',')} %.` : 'El ROE es N/D.',
      'Frente a 2024 el total de activos aumentó $10.000.000,00.',
    ];
    const gov = govJson({ developments: prose });
    gov.shareholderMinutes.capitalizationProposal.body =
      `Se propone capitalizar ${cop(realActa!.capitalizationAmountCop)} con cargo al saldo distribuible.`;
    const g = checkGovernanceNarrative(
      gov,
      narrativeSourcesFromPreprocessed(real, null, { acta: realActa }),
    );
    expect(g.motivos).toEqual([]);
    expect(g.checked).toBeGreaterThanOrEqual(6);
    const s = checkStrategyNarrative(
      strategy({ executive: prose.join(' ') }),
      narrativeSourcesFromPreprocessed(real, null),
    );
    expect(s.motivos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Revisión adversarial P3: prosa honesta que no debe sellar la Parte II/III
// ---------------------------------------------------------------------------
// Un sello bloquea la exportación y el HTML, así que un falso positivo deja un
// informe honesto sin entregable. Estas redacciones son habituales en notas,
// actas y recomendaciones y no afirman nada contra las anclas: saldos de otras
// cuentas (dividendos por pagar), montos por acción, incisos entre paréntesis,
// componentes de un total y propuestas o impactos futuros. Las manipulaciones
// equivalentes siguen sellando.
// ---------------------------------------------------------------------------

describe('revisión adversarial — prosa honesta sin falsos positivos', () => {
  const sources = () => narrativeSourcesFromPreprocessed(pp, null, { acta });

  it('notas y acta: dividendos por pagar, por acción, incisos y componentes no se acusan', () => {
    const r = checkGovernanceNarrative(
      govJson({
        notes: [
          { number: 7, title: 'Cuentas por pagar', body: 'Incluyen dividendos por pagar de $3.000.000,00 y retenciones.' },
          { number: 12, title: 'Ingresos', body: 'Los ingresos por dividendos de $1.000.000,00 provienen de inversiones.' },
          { number: 13, title: 'Efectivo', body: 'El efectivo al cierre incluye $2.000.000,00 restringidos.' },
        ],
        developments: [
          'La reserva legal se calcula como el 10 % de la utilidad neta del ejercicio ($20.000.000,00).',
          `Se decreta un dividendo de $200,00 por acción, para un total de ${cop(acta.distribuibleCop)}.`,
          'La utilidad neta por acción fue de $500,00.',
        ],
      }),
      sources(),
    );
    expect(r.motivos).toEqual([]);
  });

  it('los dividendos pagados que presenta el EFE son ancla de una nota', () => {
    const base = makeCoherentNiifReport();
    const niif = {
      ...base,
      cashFlow: {
        ...base.cashFlow,
        sections: base.cashFlow.sections.map((s) =>
          s.section === 'financing'
            ? { ...s, lines: [{ ...s.lines[0], account: null, label: 'Dividendos pagados', amountPrimary: '-30000' }] }
            : s,
        ),
      },
    };
    // Sin aritmética del acta (el informe coherente no trae preprocesado).
    const note = (body: string) => {
      const j = govJson({ notes: [{ number: 14, title: 'Patrimonio', body }] });
      j.shareholderMinutes.capitalizationProposal.applies = false;
      return j;
    };
    expect(checkGovernanceNarrative(note('Durante el año se pagaron dividendos de $300,00.'), { niif }).motivos).toEqual([]);
    expect(checkGovernanceNarrative(note('Durante el año se pagaron dividendos de $900,00.'), { niif }).motivos.join(' '))
      .toMatch(/Dividendos: la narrativa imprime \$900,00/);
  });

  it('las mismas frases con otra cifra siguen sellando (inciso, por acción y presente)', () => {
    const r = checkGovernanceNarrative(
      govJson({
        developments: [
          'La utilidad neta del ejercicio ($4.000.000,00) se destina a reservas.',
          'La pérdida neta del ejercicio ($20.000.000,00) se enjuga con reservas.',
          'Se decreta un dividendo de $200,00 por acción, para un total de $9.000.000,00.',
          'La utilidad neta queda en $4.000.000,00.',
        ],
      }),
      sources(),
    );
    const all = r.motivos.join('\n');
    expect(all).toMatch(/punto 1 · Utilidad neta: la narrativa imprime \(\$4\.000\.000,00\)/);
    expect(all).toMatch(/punto 2 · Utilidad neta: es positiva .* la presenta como negativa/);
    expect(all).toMatch(/punto 3 · Dividendos: la narrativa imprime \$9\.000\.000,00/);
    expect(all).toMatch(/punto 4 · Utilidad neta: la narrativa imprime \$4\.000\.000,00/);
  });

  it('Parte II: acciones e impactos de las recomendaciones y el condicional no se juzgan', () => {
    const j = strategy({
      executive:
        'El total de activos se concentra en el efectivo, con $50.000.000,00. ' +
        'De mantenerse la tendencia, la utilidad neta subiría a $30.000.000,00.',
      impact: 'Elevar la utilidad neta a $30 M y el EBITDA en $12 M.',
    });
    j.recommendations[0].action = 'Llevar el ROE a 25 % y el efectivo al cierre de caja a $80 M.';
    const r = reconcileStrategyAnchors(j, strategyAnchorSources(pp, null));
    expect(r.deviations).toEqual([]);
  });

  it('Parte II: una cifra falsa del periodo en el diagnóstico sigue sellando', () => {
    const j = strategy({ diagnosis: 'La utilidad neta del ejercicio se elevó a $200.000.000,00.' });
    j.recommendations[0].action = 'Llevar el ROE a 25 %.';
    const r = reconcileStrategyAnchors(j, strategyAnchorSources(pp, null));
    expect(r.deviations.join('\n')).toMatch(/Recomendación 1 · Utilidad neta: la narrativa imprime \$200\.000\.000,00/);
  });
});

describe('revisión adversarial — cifras que escapaban al cruce', () => {
  it('"COP 4.000.000" o "4.000.000 de pesos" (sin "$") también son montos en prosa', () => {
    const r = checkGovernanceNarrative(
      govJson({
        developments: [
          'La utilidad neta del ejercicio fue de COP 4.000.000,00.',
          'El patrimonio asciende a 7.000.000 de pesos.',
          'La sociedad, NIT 900.123.456-7, aprobó los estados financieros.',
        ],
      }),
      narrativeSourcesFromPreprocessed(pp, null, { acta }),
    );
    const all = r.motivos.join('\n');
    expect(all).toMatch(/punto 1 · Utilidad neta: la narrativa imprime \$4\.000\.000,00/);
    expect(all).toMatch(/punto 2 · Total Patrimonio: la narrativa imprime \$7\.000\.000,00/);
    expect(all).not.toMatch(/punto 3/);
  });

  it('el orden del día se imprime en el acta: un dividendo inventado en un punto sella', () => {
    const j = govJson({ developments: HONEST_DEVELOPMENTS });
    j.shareholderMinutes.agenda[5] = { number: 6, topic: 'Distribución de dividendos por $900.000.000,00.' };
    const r = checkGovernanceNarrative(j, narrativeSourcesFromPreprocessed(pp, null, { acta }));
    expect(r.motivos.join('\n')).toMatch(/Acta — orden del día 6 · Dividendos: la narrativa imprime \$900\.000\.000,00/);
    // El orden del día canónico, sin cifras, no se acusa.
    expect(checkGovernanceNarrative(govJson({ developments: HONEST_DEVELOPMENTS }), narrativeSourcesFromPreprocessed(pp, null, { acta })).motivos).toEqual([]);
  });
});

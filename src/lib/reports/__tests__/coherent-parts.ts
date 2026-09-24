// ---------------------------------------------------------------------------
// Partes II y III coherentes con un JSON NIIF (fixtures de I3)
// ---------------------------------------------------------------------------
// Desde I3 el servidor re-renderiza el Markdown de las Partes desde su JSON y
// sella la Parte II/III que no trae un JSON válido. Los fixtures que sólo
// llevaban texto a mano ("Strategy", "Governance") o JSON parcial quedaban
// sellados; este módulo produce JSON que cumple el contrato
// (`StrategyReportSchema`, `GovernanceReportSchema`), coherente con las cifras
// del JSON NIIF y del balance, y cuyo render trae lo que exigen los gates de
// texto del consolidado: la TTD (V10) en la nota de impuestos y, si el
// preprocesado declara comparativos impracticables, la declaración §3.14/§10.21
// (V15) en una nota técnica de la Parte I. La prosa no cita cifras: el
// validador de prosa no tiene nada que acusar.
// ---------------------------------------------------------------------------

import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { CompanyInfo, FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

/** Nota de impuestos: aborda la TTD sin afirmar una cifra (V10). */
export const TTD_NOTE_BODY =
  'Impuesto de renta: la Tasa de Tributación Depurada (TTD, parágrafo 6 del art. 240 E.T.) se declara N/D ' +
  'sin impuesto depurado ni utilidad depurada verificados.';

/** Declaración de impracticabilidad de comparativos (V15). */
export const IMPRACTICABLE_NOTE_BODY =
  'Comparativos impracticables (NIIF para las PYMES §3.14 y §10.21): no se presentan cifras del periodo anterior.';

const cents = (pesos: number) => String(Math.round(pesos * 100));

function companyBlock(niif: NiifReportJson) {
  return {
    name: niif.company.name,
    nit: niif.company.nit,
    entityType: 'SAS',
    sector: null,
    niifGroup: 2 as const,
    fiscalPeriod: niif.company.fiscalPeriod,
    comparativePeriod: niif.company.comparativePeriod,
    city: null,
    signatories: null,
  };
}

/** Parte II válida: dashboard con el Total Activo del balance (o del JSON NIIF), KPI N/D, prosa sin cifras. */
export function coherentStrategyJson(
  niif: NiifReportJson,
  pp?: PreprocessedBalance | null,
): StrategyReportJson {
  const ct = pp?.primary?.controlTotals;
  const ac = ct ? cents(ct.activoCorriente) : niif.balanceSheet.totalAssetsPrimary;
  const pc = ct ? cents(ct.pasivoCorriente) : niif.balanceSheet.totalLiabilitiesPrimary;
  const gap = (BigInt(ac) - BigInt(pc)).toString();
  return {
    company: companyBlock(niif),
    reportMode: niif.company.comparativePeriod ? 'COMPARATIVO_COMPLETO' : 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: [
        {
          label: 'Total Activo',
          primary: ct?.cents?.activo !== undefined ? String(ct.cents.activo) : niif.balanceSheet.totalAssetsPrimary,
          comparative: null,
          variation: null,
          variationPct: null,
          commentary: 'Cierre del ejercicio.',
        },
      ],
      executiveCommentary: 'El cierre del ejercicio no muestra tensiones de liquidez.',
    },
    technicalAlerts: [],
    kpis: [
      {
        category: 'efficiency',
        name: 'Rotación de inventarios',
        formula: 'Rotación de inventarios: sin fórmula determinista',
        resultPrimary: 'ND',
        resultComparative: null,
        unit: 'days',
        benchmarkBand: { description: 'Sector', lowerBound: null, upperBound: null },
        diagnosis: 'N/D — indicador sin ancla determinista en el balance preprocesado.',
        yoyVariation: null,
        confidence: 'low',
        anomalyFlag: null,
        presentationMode: null,
        baselineLabel: null,
        sparklinePoints: null,
      },
    ],
    dupontAnalysis: null,
    trends: null,
    breakEven: {
      fixedCostsCop: '100',
      variableCostsCop: '100',
      revenueCop: '100',
      breakEvenPointCop: null,
      marginOfSafetyPct: 'ND',
      classificationNote: 'Clasificación de costos pendiente de auxiliares.',
    },
    projectedCashFlow: {
      liquidityGate: {
        triggered: BigInt(ac) < BigInt(pc),
        currentAssetsCop: ac,
        currentLiabilitiesCop: pc,
        gapCop: gap,
        message: null,
      },
      initialCashBalanceCop: ct ? cents(ct.efectivoCuenta11) : '0',
      dsoDays: '30',
      inflationIndexPct: '5,0',
      scenarios: [],
      solvencyNarrative: 'La entidad atiende sus obligaciones de corto plazo.',
      controlKpis: [],
      assumptionsNote: 'Supuestos conservadores.',
    },
    recommendations: [1, 2, 3].map((i) => ({
      title: `Fortalecer la gestión ${i}`,
      diagnosis: 'La cartera concentra el activo corriente.',
      action: 'Formalizar la política de cobro.',
      expectedImpact: 'Mejor conversión de cartera en caja.',
      priority: 'medium' as const,
      horizon: 'short_term' as const,
      normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

/** Checklist mínimo del contrato (≥ 8 ítems, Parte III §3 spec v2.0), sin cifras. */
export const COMPLIANCE_CHECKLIST = [
  ['Marco contable', 'Decreto 2420/2015'],
  ['Convocatoria', 'Ley 1258/2008 art. 20'],
  ['Quorum', 'Estatutos sociales'],
  ['Aprobación de estados financieros', 'C.Co. art. 187'],
  ['Destinación de resultados', 'C.Co. art. 187'],
  ['Reserva legal', 'C.Co. art. 452'],
  ['Libros de actas', 'C.Co. art. 189'],
  ['Impuesto de renta', 'E.T. art. 240'],
].map(([topic, norma]) => ({
  topic,
  norma,
  status: 'cumplido' as const,
  evidencia: 'Verificado con los soportes del ejercicio.',
  accionRequerida: null,
}));

/** Parte III válida: acta con la aritmética esperada, nota de impuestos con la TTD. */
export function coherentGovernanceJson(
  niif: NiifReportJson,
  company: CompanyInfo,
  pp?: PreprocessedBalance | null,
): GovernanceReportJson {
  const acta = pp ? buildActaExpectedArithmetic(company, pp) : null;
  return {
    company: companyBlock(niif),
    reportMode: niif.company.comparativePeriod ? 'COMPARATIVO_COMPLETO' : 'LINEA_BASE',
    signatories: null,
    financialNotes: [
      { number: 1, title: 'Entidad', body: 'Sociedad por acciones simplificada domiciliada en Colombia.', normReference: null, materiality: 'material', confidence: null },
      { number: 2, title: 'Impuestos', body: TTD_NOTE_BODY, normReference: 'Art. 240 E.T.', materiality: 'material', confidence: null },
    ],
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'Ley 1258 de 2008',
      city: null,
      meetingDate: null,
      convocationStatement: 'Se convocó según los estatutos.',
      quorumStatement: 'Se verificó el quorum deliberatorio.',
      agenda: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` })),
      developments: [{ itemNumber: 1, body: 'Se aprobaron los estados financieros del ejercicio.' }],
      resultDistribution: {
        netIncomeCop: acta ? acta.netIncomeCop : niif.incomeStatement.netIncomePrimary,
        applies: acta ? acta.distributionApplies : false,
        lines: acta ? acta.lines.map((l) => ({ label: l.label, amountCop: l.amountCop, normReference: l.normReference })) : [],
        neutralProposalText: 'La asamblea decide sobre la destinación del resultado.',
      },
      capitalizationProposal: {
        applies: acta ? acta.capitalizationApplies : false,
        retainedEarningsBaseCop: acta ? acta.capitalizationBaseCop : '0',
        capitalizationAmountCop: acta ? acta.capitalizationAmountCop : '0',
        legalReference: 'Ley 1258/2008',
        body: 'No se propone capitalización.',
      },
      signatures: [
        { role: 'presidente_asamblea', name: null, identification: null },
        { role: 'secretario_asamblea', name: null, identification: null },
        { role: 'representante_legal', name: null, identification: null },
      ],
      fiscalReviewerOpinion: {
        applies: false,
        reviewerName: null,
        reviewerTp: null,
        opinionType: null,
        opinionBody: null,
        exemptionReason: 'Entidad no obligada a Revisor Fiscal.',
      },
      closingStatement: 'Se levanta la sesión.',
    },
    complianceChecklist: COMPLIANCE_CHECKLIST,
    disclaimers: [],
    preparerNotes: [],
  } as unknown as GovernanceReportJson;
}

/** JSON NIIF con la nota técnica de impracticabilidad (V15), si no la trae. */
export function withImpracticableNote(niif: NiifReportJson): NiifReportJson {
  if (niif.technicalNotes.some((n) => n.body === IMPRACTICABLE_NOTE_BODY)) return niif;
  return {
    ...niif,
    technicalNotes: [...niif.technicalNotes, { ref: null, norma: 'NIIF para las PYMES 3.14', body: IMPRACTICABLE_NOTE_BODY }],
  };
}

/**
 * Informe con Partes II y III estructuradas y coherentes con su JSON NIIF.
 * `impracticable` añade la declaración §3.14/§10.21 a la Parte I.
 */
export function withCoherentParts(
  report: FinancialReport,
  pp?: PreprocessedBalance | null,
  opts: { impracticable?: boolean } = {},
): FinancialReport {
  const baseNiif = report.niifAnalysis.json as NiifReportJson;
  const niif = opts.impracticable ? withImpracticableNote(baseNiif) : baseNiif;
  // La MISMA empresa con la que el servidor calcula la aritmética del acta.
  const company: CompanyInfo = report.company;
  return {
    ...report,
    niifAnalysis: { ...report.niifAnalysis, json: niif },
    strategicAnalysis: { ...report.strategicAnalysis, json: coherentStrategyJson(niif, pp) },
    governance: { ...report.governance, json: coherentGovernanceJson(niif, company, pp) },
  };
}

/**
 * `reportParts` de /consolidate para una Parte I dada (la salida de /niif):
 * Partes II y III estructuradas y coherentes con `pp`. Los textos sueltos son
 * lo que "envía el navegador"; el servidor los re-renderiza desde el JSON.
 */
export function coherentReportParts(
  niifAnalysis: FinancialReport['niifAnalysis'],
  company: Omit<CompanyInfo, 'niifGroup'> & { niifGroup?: number },
  pp?: PreprocessedBalance | null,
  opts: { impracticable?: boolean } = {},
): Pick<FinancialReport, 'niifAnalysis' | 'strategicAnalysis' | 'governance'> {
  const r = withCoherentParts(
    {
      company: company as CompanyInfo,
      niifAnalysis,
      strategicAnalysis: {
        kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '', strategicRecommendations: '',
        fullContent: 'Análisis estratégico.',
      },
      governance: { financialNotes: '', shareholderMinutes: '', fullContent: 'Acta de asamblea ordinaria.' },
      consolidatedReport: '',
      generatedAt: '',
    },
    pp,
    opts,
  );
  return { niifAnalysis: r.niifAnalysis, strategicAnalysis: r.strategicAnalysis, governance: r.governance };
}

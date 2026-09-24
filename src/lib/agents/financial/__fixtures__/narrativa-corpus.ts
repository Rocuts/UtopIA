// ---------------------------------------------------------------------------
// Fixtures del validador de prosa (re-auditoría 2 de la fase 2, 2026-09-24)
// ---------------------------------------------------------------------------
// Balances pequeños con anclas conocidas y constructores mínimos de los JSON
// de las Partes II y III para cruzar frases sueltas con
// `checkGovernanceNarrative` / `checkStrategyNarrative`. Los usan
// narrativa-reauditoria2.test.ts y narrativa-corpus.test.ts.
// ---------------------------------------------------------------------------

import { buildActaExpectedArithmetic } from '../prompts/governance-specialist.prompt';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { GovernanceReportJson } from '../contracts/governance-report';
import type { StrategyReportJson } from '../contracts/strategy-report';
import type { CompanyInfo } from '../types';

/**
 * S.A. con utilidad de $20M (el balance de narrativa-anclas.test.ts):
 * activo $90M, pasivo $30M, patrimonio $60M, efectivo $50M, ingresos $100M.
 */
export const CSV_SA = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');
export const COMPANY_SA: CompanyInfo = { name: 'X SA', nit: '900123456', fiscalPeriod: '2025', entityType: 'SA' };
export const ppSA = preprocessTrialBalance(parseTrialBalanceCSV(CSV_SA));
/** Reserva legal $2M, ocasional $10M, distribuible $8M, mínimo Art. 155 $10M, capitalización $8M. */
export const actaSA = buildActaExpectedArithmetic(COMPANY_SA, ppSA)!;

/** Pérdida de dos cortes: utilidad neta −$40M, EBITDA −$20M, ROE −80 %. */
export const CSV_PERDIDA = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '130505,Clientes nacionales,Auxiliar,1,20000000,15000000',
  '152410,Maquinaria,Auxiliar,1,50000000,50000000',
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
export const ppPerdida = preprocessTrialBalance(parseTrialBalanceCSV(CSV_PERDIDA));

/** Patrimonio NEGATIVO −$40M (causal de disolución): activo $10M, pasivo $50M. */
export const CSV_PATRIMONIO_NEGATIVO = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,10000000',
  '220505,Proveedores,Auxiliar,1,50000000',
  '311505,Capital,Auxiliar,1,10000000',
  '360505,Perdida del ejercicio,Auxiliar,1,-50000000',
  '410505,Ventas,Auxiliar,1,10000000',
  '510505,Sueldos,Auxiliar,1,60000000',
].join('\n');
export const ppPatrimonioNegativo = preprocessTrialBalance(parseTrialBalanceCSV(CSV_PATRIMONIO_NEGATIVO));

/** El balance S.A. ×100: utilidad neta $2.000.000.000 (= "$2 mil M" en los pilares). */
export const ppGrande = preprocessTrialBalance(
  parseTrialBalanceCSV(CSV_SA.replace(/,(\d+)$/gm, (_m, n: string) => `,${n}00`)),
);

/** Dos cortes (2024/2025): activo $80M → $90M, utilidad $10M → $20M, ROE 20 % → 33,3 %. */
export const CSV_DOS_CORTES = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,40000000,50000000',
  '130505,Clientes,Auxiliar,1,40000000,40000000',
  '220505,Proveedores,Auxiliar,1,30000000,30000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,0,10000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,10000000,20000000',
  '410505,Ventas,Auxiliar,1,90000000,100000000',
  '510505,Sueldos,Auxiliar,1,80000000,80000000',
].join('\n');
export const ppDosCortes = preprocessTrialBalance(parseTrialBalanceCSV(CSV_DOS_CORTES));

type Acta = NonNullable<ReturnType<typeof buildActaExpectedArithmetic>>;

/** Parte III mínima: notas y desarrollo del acta con la prosa dada. */
export function govJson(
  o: { developments?: string[]; notes?: string[]; acta?: Acta | null; period?: string; name?: string } = {},
): GovernanceReportJson {
  const a = o.acta === undefined ? actaSA : o.acta;
  return {
    company: {
      name: o.name ?? 'X SA', nit: '900123456', entityType: 'SA', sector: null, niifGroup: 2,
      fiscalPeriod: o.period ?? '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    signatories: null,
    financialNotes: (o.notes && o.notes.length ? o.notes : ['Sociedad anónima.']).map((body, i) => ({
      number: i + 1, title: `Nota ${i + 1}`, body, normReference: null, materiality: 'material' as const, confidence: null,
    })),
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas', entityRegimeCitation: 'C.Co.', city: null, meetingDate: null,
      convocationStatement: 'Se convocó con quince días hábiles de antelación.',
      quorumStatement: 'Se verificó el quorum deliberatorio.',
      agenda: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` })),
      developments: (o.developments ?? []).map((body, i) => ({ itemNumber: i + 1, body })),
      resultDistribution: a
        ? {
            netIncomeCop: a.netIncomeCop, applies: a.distributionApplies,
            lines: a.lines.map((l) => ({ label: l.label, amountCop: l.amountCop, normReference: l.normReference })),
            neutralProposalText: null,
          }
        : { netIncomeCop: '0', applies: false, lines: [], neutralProposalText: 'La asamblea decide.' },
      capitalizationProposal: {
        applies: false, retainedEarningsBaseCop: '0', capitalizationAmountCop: '0', legalReference: 'Art. 30 E.T.', body: 'No aplica.',
      },
      signatures: [
        { role: 'presidente_asamblea', name: null, identification: null },
        { role: 'secretario_asamblea', name: null, identification: null },
        { role: 'representante_legal', name: null, identification: null },
      ],
      fiscalReviewerOpinion: {
        applies: false, reviewerName: null, reviewerTp: null, opinionType: null, opinionBody: null, exemptionReason: 'No obligada.',
      },
      closingStatement: 'Se levanta la sesión.',
    },
    complianceChecklist: [],
    disclaimers: [],
    preparerNotes: [],
  } as unknown as GovernanceReportJson;
}

/** Parte II mínima con el comentario ejecutivo dado (válida para los validadores, no para el schema). */
export function strategyJson(executive: string, over: Partial<StrategyReportJson> = {}): StrategyReportJson {
  return {
    company: {
      name: 'X SA', nit: '900123456', entityType: null, sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    confidence: null,
    executiveDashboard: { rows: [], executiveCommentary: executive },
    technicalAlerts: [], kpis: [], dupontAnalysis: null, trends: null,
    breakEven: { fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1', marginOfSafetyPct: '1', classificationNote: 'nota' },
    projectedCashFlow: null,
    recommendations: [{ title: 'T', diagnosis: 'D.', action: 'A.', expectedImpact: 'I.', priority: 'high', horizon: 'immediate', normReference: null }],
    presumedCostWarning: null,
    preparerNotes: [],
    ...over,
  } as unknown as StrategyReportJson;
}

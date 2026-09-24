// ---------------------------------------------------------------------------
// Escenario de la re-auditoría e2e-niif (2026-09-24): pérdida en los dos años,
// comparativo 2024, depreciación acumulada (correctora 1592) y obligaciones
// financieras. Con él se construye el informe NIIF HONESTO —el que copia las
// anclas y el desglose determinista— sobre el que cada prueba aplica una sola
// manipulación del LLM.
//
// 2024: A 140M = P 70M + K 70M (capital 100M, pérdida −30M).
// 2025: A 100M = P 70M + K 30M (capital 100M, acumulados −30M, pérdida −40M).
// P&G 2025: 80 − 70 − (30 + 10) − 10 = −40M. P&G 2024: 100 − 80 − 40 − 10 = −30M.
// ---------------------------------------------------------------------------

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PeriodSnapshot,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { buildReportAnchors } from '../contracts/anchors';
import {
  buildDeterministicBreakdown,
  buildDeterministicCashFlow,
} from '../contracts/deterministic-breakdown';
import type { NiifReportJson, EquityChangeRowJson } from '../contracts/niif-report';
import type { FinancialReport } from '../types';

export const CSV_PERDIDA_COMPARATIVO = [
  'Razón social: DEMO PERDIDAS SAS',
  'NIT: 900.123.456-8',
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

export function preprocesarPerdidaComparativo(csv = CSV_PERDIDA_COMPARATIVO): PreprocessedBalance {
  return preprocessTrialBalance(parseTrialBalanceCSV(csv));
}

type Line = NiifReportJson['balanceSheet']['assets'][number];

export const linea = (
  account: string | null,
  label: string,
  amountPrimary: string,
  amountComparative: string | null,
  opts: Partial<Line> = {},
): Line => ({
  account,
  label,
  amountPrimary,
  amountComparative,
  level: 2,
  isAbsolute: false,
  confidence: null,
  anomalyFlag: null,
  ...opts,
});

/** Σ en centavos de las hojas de un prefijo PUC. */
export function hojas(snap: PeriodSnapshot, prefix: string): bigint {
  let t = BigInt(0);
  for (const cls of snap.classes) {
    for (const a of cls.accounts) {
      if (!a.isLeaf) continue;
      if (String(a.code).replace(/\D/g, '').startsWith(prefix)) t += BigInt(Math.round(a.balance * 100));
    }
  }
  return t;
}

const absB = (v: bigint) => (v < BigInt(0) ? -v : v);

function balanceLines(pp: PreprocessedBalance, section: 'assets' | 'liabilities' | 'equity'): Line[] {
  const prim = buildDeterministicBreakdown(pp.primary, section);
  const comp = pp.comparative ? buildDeterministicBreakdown(pp.comparative, section) : [];
  const accounts = Array.from(new Set([...prim, ...comp].map((r) => r.account))).sort();
  return accounts.map((acc) => {
    const p = prim.find((r) => r.account === acc);
    const c = comp.find((r) => r.account === acc);
    return linea(acc, p?.label ?? c?.label ?? acc, (p?.cents ?? BigInt(0)).toString(), c ? c.cents.toString() : null);
  });
}

function equityColumns(snap: PeriodSnapshot) {
  const g = (p: string) => hojas(snap, p);
  return {
    capitalSocial: g('31'),
    primaColocacion: g('32'),
    reservaLegal: g('3305'),
    otrasReservas: g('33') - g('3305'),
    resultadosAcumulados: g('37'),
    resultadoEjercicio: g('36'),
    ori: g('38'),
  };
}

export function filaEcp(
  kind: EquityChangeRowJson['kind'],
  label: string,
  cols: Partial<Record<Exclude<keyof EquityChangeRowJson, 'kind' | 'label' | 'total'>, bigint>>,
): EquityChangeRowJson {
  const keys = [
    'capitalSocial', 'primaColocacion', 'reservaLegal', 'otrasReservas',
    'resultadosAcumulados', 'resultadoEjercicio', 'ori',
  ] as const;
  let total = BigInt(0);
  const row = { kind, label } as EquityChangeRowJson;
  for (const k of keys) {
    const v = cols[k] ?? BigInt(0);
    row[k] = v.toString();
    total += v;
  }
  row.total = total.toString();
  return row;
}

/**
 * Informe NIIF que un analista honesto emitiría: anclas copiadas, ESF por
 * grupo PUC en ambas columnas, P&G por grupo, EFE = determinista y ECP desde
 * los dos cortes.
 */
export function informeHonesto(pp: PreprocessedBalance): NiifReportJson {
  const anchors = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
  const a = anchors.primary!.cents;
  const c = anchors.comparative?.cents;
  const s = (v: bigint | undefined) => (v === undefined ? null : v.toString());
  const P = pp.primary;
  const C = pp.comparative!;
  const grupo = (prefix: string, label: string) =>
    linea(prefix, label, absB(hojas(P, prefix)).toString(), absB(hojas(C, prefix)).toString(), { isAbsolute: true });
  const efe = buildDeterministicCashFlow(P, C)!;
  const open = equityColumns(C);
  const close = equityColumns(P);
  return {
    company: {
      name: 'Demo Perdidas SAS',
      nit: '900123456-8',
      entityType: 'SAS',
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: '2024',
      city: null,
      signatories: null,
    },
    balanceSheet: {
      assets: balanceLines(pp, 'assets'),
      liabilities: balanceLines(pp, 'liabilities'),
      equity: balanceLines(pp, 'equity'),
      totalAssetsPrimary: s(a.activo)!,
      totalAssetsComparative: s(c?.activo),
      totalLiabilitiesPrimary: s(a.pasivo)!,
      totalLiabilitiesComparative: s(c?.pasivo),
      totalEquityPrimary: s(a.patrimonio)!,
      totalEquityComparative: s(c?.patrimonio),
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [
        grupo('41', 'Ingresos de actividades ordinarias'),
        grupo('61', 'Costo de ventas'),
        grupo('51', 'Gastos de administración'),
        grupo('53', 'Gastos financieros'),
      ],
      grossProfitPrimary: s(a.utilidadBruta)!,
      grossProfitComparative: s(c?.utilidadBruta),
      operatingProfitPrimary: s(a.ebit)!,
      operatingProfitComparative: s(c?.ebit),
      netIncomePrimary: s(a.utilidadNeta)!,
      netIncomeComparative: s(c?.utilidadNeta),
      oriPrimary: '0',
      oriComparative: '0',
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: efe.sections.map((sec) => ({
        section: sec.section,
        lines: sec.rows.map((r) => linea(null, r.label, r.cents.toString(), null)),
        netFlow: sec.netFlowCents.toString(),
        netFlowComparative: null,
      })),
      netChange: efe.netChangeCents.toString(),
      cashOpening: efe.cashOpeningCents.toString(),
      cashClosing: efe.cashClosingCents.toString(),
      methodNote: 'indirect',
      degeneracyFlag: null,
      netChangeComparative: null,
      cashOpeningComparative: null,
      cashClosingComparative: null,
      comparativeNote: null,
    },
    equityChanges: {
      comparativeRows: null,
      comparativeNote: null,
      rows: [
        filaEcp('opening_balance', 'Saldo al 1 de enero de 2025', open),
        filaEcp('prior_period_result_cancellation', 'Traslado del resultado 2024 a resultados acumulados', {
          resultadoEjercicio: -open.resultadoEjercicio,
          resultadosAcumulados: open.resultadoEjercicio,
        }),
        filaEcp('profit_for_period', 'Resultado del ejercicio 2025', { resultadoEjercicio: close.resultadoEjercicio }),
        filaEcp('closing_balance', 'Saldo al 31 de diciembre de 2025', close),
      ],
      notes: [],
    },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
    reportMode: 'COMPARATIVO_COMPLETO',
  };
}

/** Informe exportable (Partes II/III con contenido) alrededor del JSON NIIF. */
export function informeExportable(json: NiifReportJson): FinancialReport {
  return {
    company: { name: json.company.name, nit: json.company.nit, fiscalPeriod: json.company.fiscalPeriod },
    niifAnalysis: {
      json,
      balanceSheet: '',
      incomeStatement: '',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: 'NIIF',
      reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '',
      fullContent: 'Strategy',
    },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: 'Governance' },
    consolidatedReport: 'Financial report',
    generatedAt: '2026-09-24T00:00:00Z',
  };
}

export const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

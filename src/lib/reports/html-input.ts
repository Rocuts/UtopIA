import type { CompanyInfo, FinancialReport, NiifAnalysisResult } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { aggregateConfidence, summarizeCoverage } from '@/lib/preprocessing/v8-helpers';
import { derivePeriodBounds } from './period-bounds';
import type { ReportProvenance } from './report-ref';

// ---------------------------------------------------------------------------
// Entrada de /api/financial-report/html desde la versión persistida
// ---------------------------------------------------------------------------
// Con `reportRef`, los tres JSON (NIIF, Estrategia, Gobierno), la empresa, el
// balance preprocesado y los veredictos de las Partes II/III salen de la
// versión persistida; del cuerpo sólo se conservan datos de presentación
// (ciudad, tipo societario, ley, grupo, fechas de emisión, modelo). Las cifras
// de la metadata —cobertura por clase, auxiliares, sector, confianza, alertas,
// periodo y huella— se recomponen en el servidor desde esa versión: una
// metadata alterada por el cliente no las sustituye.
// ---------------------------------------------------------------------------

type ReportMode = 'LINEA_BASE' | 'TRANSICION' | 'COMPARATIVO_COMPLETO';

function readReportMode(niifJson: unknown, fallback: unknown): ReportMode {
  const fromJson =
    niifJson && typeof niifJson === 'object' ? (niifJson as { reportMode?: unknown }).reportMode : null;
  for (const m of [fromJson, fallback]) {
    if (m === 'LINEA_BASE' || m === 'TRANSICION' || m === 'COMPARATIVO_COMPLETO') return m;
  }
  return 'LINEA_BASE';
}

/**
 * Conteo de alertas técnicas de la Parte II persistida (`technicalAlerts`:
 * red → high, amber → medium, green → low). Los hallazgos de la auditoría
 * (Parte IV) no forman parte de la versión persistida, así que no se suman:
 * un conteo enviado por el cliente no se imprime como verificado.
 */
export function countStrategyAlerts(strategyJson: unknown): { high: number; medium: number; low: number } {
  const counts = { high: 0, medium: 0, low: 0 };
  const alerts =
    strategyJson && typeof strategyJson === 'object' &&
    Array.isArray((strategyJson as { technicalAlerts?: unknown }).technicalAlerts)
      ? ((strategyJson as { technicalAlerts: Array<{ severity?: unknown } | null> }).technicalAlerts)
      : [];
  for (const a of alerts) {
    if (a?.severity === 'red') counts.high += 1;
    else if (a?.severity === 'amber') counts.medium += 1;
    else if (a?.severity === 'green') counts.low += 1;
  }
  return counts;
}

export function htmlInputFromPersisted(
  body: Record<string, unknown>,
  persisted: {
    report: FinancialReport;
    preprocessed: PreprocessedBalance | undefined;
    provenance: ReportProvenance;
  },
): Record<string, unknown> {
  const { report, preprocessed, provenance } = persisted;
  const niif = report.niifAnalysis?.json ?? null;
  const strategy = report.strategicAnalysis?.json ?? null;
  const governance = report.governance?.json ?? null;
  const clientMeta =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const jsonPeriod = (niif as { company?: { fiscalPeriod?: unknown } } | null)?.company?.fiscalPeriod;
  const bounds = derivePeriodBounds(
    preprocessed ?? null,
    (typeof jsonPeriod === 'string' ? jsonPeriod : '') || report.company?.fiscalPeriod || '',
  );
  const period = /^\d{4}$/.test(bounds.periodYear)
    ? {
        periodYear: bounds.periodYear,
        periodStart: bounds.periodStart,
        periodEnd: bounds.periodEnd,
      }
    : {};

  const metadata: Record<string, unknown> = {
    ...clientMeta,
    reportMode: readReportMode(niif, clientMeta.reportMode),
    entityNit: report.company?.nit,
    entityName: report.company?.name,
    ...period,
    globalConfidence: aggregateConfidence({ niif, strategy, governance }),
    alertsCounts: countStrategyAlerts(strategy),
    coverageByClass: preprocessed ? summarizeCoverage(preprocessed) : [],
    auxiliariesProcessed: preprocessed?.auxiliaryCount ?? 0,
    sectorCIIU: preprocessed?.actividadInferida?.sectorCIIU ?? null,
    reportHashSha256: provenance.reportHash,
  };

  return {
    ...body,
    niifReport: niif,
    strategyReport: strategy,
    governanceReport: governance,
    company: report.company,
    metadata,
    preprocessed: preprocessed ? toJsonSafe(preprocessed) : null,
    actaQualifications: report.governance?.actaQualifications ?? null,
    strategyQualifications: report.strategicAnalysis?.strategyQualifications ?? null,
  };
}

// ---------------------------------------------------------------------------
// /html SIN referencia: el informe que el servidor verifica (procedencia-R2-03)
// ---------------------------------------------------------------------------
// Sin versión persistida /html recibe los tres JSON, la empresa y el balance
// del navegador. /export sin referencia los pasa por
// `withServerRenderedClientReport` (veredictos del servidor, identidad de las
// Partes II/III, prosa de la Parte I, post-proceso de la Parte II y gate
// V1–V15 recalculado); /html sólo corría el gate aritmético y el acta, así que
// un informe que /export rechaza salía en HTML y el Editor Jefe recibía el
// JSON de la Parte II sin post-procesar. Aquí se arma el MISMO `FinancialReport`
// que /export recibiría: las Partes con su JSON y sin texto (el servidor lo
// produce desde el JSON) y los veredictos que reenvía el cliente (sólo pueden
// endurecer): reconciliación NIIF, acta, Parte II y, como /html no recibe el
// archivo del balance, la emitibilidad `no-emitible` y la validación negativa
// que /consolidate calculó con él (V5/V6).
// ---------------------------------------------------------------------------

function objectOrNull(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * Emitibilidad `no-emitible` que reenvía el cliente (la que /consolidate
 * calculó CON el archivo del balance). /html no recibe `rawData`, así que los
 * bloqueantes que dependen de la identidad leída del ARCHIVO (V5 razón social
 * y NIT del encabezado, V6 DV del NIT) no se pueden recalcular aquí; sin esto
 * un informe que /export sin referencia rechaza por V5/V6 salía en HTML. Sólo
 * endurece: una emitibilidad "emittable" no se toma (el gate recalculado
 * decide) y una forma inválida se descarta.
 */
function receivedNotEmittable(v: unknown): FinancialReport['emittability'] | null {
  const o = objectOrNull(v);
  if (!o || o.kind !== 'no-emitible') return null;
  const blockers = (Array.isArray(o.blockers) ? o.blockers : [])
    .map(objectOrNull)
    .filter((b): b is Record<string, unknown> => !!b && typeof b.code === 'string' && typeof b.message === 'string')
    .map((b) => ({ code: b.code as string, message: b.message as string }));
  return { kind: 'no-emitible', blockers, suggestedAdjustments: strings(o.suggestedAdjustments) };
}

/** Validación post-render negativa que reenvía el cliente (sólo endurece). */
function receivedFailedValidation(v: unknown): FinancialReport['validation'] | null {
  const o = objectOrNull(v);
  if (!o || o.ok !== false) return null;
  return { ok: false, errors: strings(o.errors), warnings: strings(o.warnings) };
}

export function htmlClientReport(
  body: Record<string, unknown>,
  input: {
    niifReport: unknown;
    strategyReport: unknown;
    governanceReport: unknown;
    company: { name: string; nit: string; fiscalPeriod: string; entityType: string | null; comparativePeriod?: string | null };
  },
): FinancialReport {
  // Mismo insumo que usó /governance para el régimen de la reserva legal: la
  // empresa del intake que reenvía el cliente, con la identidad ya validada.
  const rawCompany = objectOrNull(body.company) ?? {};
  const company = {
    ...rawCompany,
    name: input.company.name,
    nit: input.company.nit,
    fiscalPeriod: input.company.fiscalPeriod,
    entityType: input.company.entityType ?? undefined,
    comparativePeriod: input.company.comparativePeriod ?? undefined,
  } as CompanyInfo;
  const acta = objectOrNull(body.actaQualifications);
  const strategy = objectOrNull(body.strategyQualifications);
  const reconciliation = objectOrNull(body.niifReconciliation);
  const emittability = receivedNotEmittable(body.emittability);
  const validation = receivedFailedValidation(body.validation);
  return {
    company,
    ...(emittability ? { emittability } : {}),
    ...(validation ? { validation } : {}),
    niifAnalysis: {
      balanceSheet: '',
      incomeStatement: '',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: '',
      json: input.niifReport as NiifAnalysisResult['json'],
      ...(reconciliation ? { reconciliation: reconciliation as unknown as NiifAnalysisResult['reconciliation'] } : {}),
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '',
      fullContent: '',
      json: input.strategyReport as FinancialReport['strategicAnalysis']['json'],
      ...(strategy ? { strategyQualifications: strategy as unknown as FinancialReport['strategicAnalysis']['strategyQualifications'] } : {}),
    },
    governance: {
      financialNotes: '',
      shareholderMinutes: '',
      fullContent: '',
      json: input.governanceReport as FinancialReport['governance']['json'],
      ...(acta ? { actaQualifications: acta as unknown as FinancialReport['governance']['actaQualifications'] } : {}),
    },
    consolidatedReport: '',
    generatedAt: '',
  };
}

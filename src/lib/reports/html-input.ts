import type { FinancialReport } from '@/lib/agents/financial/types';
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

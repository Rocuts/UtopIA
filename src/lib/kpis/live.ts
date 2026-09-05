/** Dashboard values must come from complete, identified inputs, never demos. */
import { listReports } from '@/lib/storage/conversation-history';
import { calculateComplianceScore } from './compliance-score';
import type { KpiSeverity } from '@/types/kpis';
import type { ErpConnectionLite } from '@/lib/alerts/types';

export type LiveKpiSource = 'report' | 'unavailable';
export interface LiveKpiValue {
  value: number | null;
  formatted: string;
  trend: 'up' | 'down' | 'flat';
  trendPercent: number;
  severity: KpiSeverity;
  source: LiveKpiSource;
  sparkline: number[];
  updatedAt?: string;
  reason?: string;
}
export interface DashboardKPIs {
  escudo: LiveKpiValue;
  valor: LiveKpiValue;
  verdad: LiveKpiValue;
  futuro: LiveKpiValue;
}
interface ReportDigest {
  updatedAt: string;
  niifScore?: number;
  taxScore?: number;
  legalScore?: number;
  findings?: { critico: number; alto: number; medio: number };
  opinion?: 'favorable' | 'con_salvedades' | 'desfavorable' | 'abstension';
}
interface LatestReportShape {
  niifAnalysis?: { reconciliation?: { clean?: boolean } };
  emittability?: { kind?: string };
  auditReport?: {
    findingCounts?: Partial<Record<'critico' | 'alto' | 'medio', number>>;
    opinionType?: ReportDigest['opinion'];
    auditorResults?: Array<{ domain: string; complianceScore: number }>;
  };
}
function unavailable(reason: string): LiveKpiValue {
  return { value: null, formatted: 'N/D', trend: 'flat', trendPercent: 0,
    severity: 'neutral', source: 'unavailable', sparkline: [], reason };
}
function readLatestReport(): ReportDigest | null {
  try {
    const latest = listReports()[0];
    if (!latest?.report) return null;
    const report = latest.report as LatestReportShape;
    if (report.niifAnalysis?.reconciliation?.clean !== true ||
        report.emittability?.kind === 'no-emitible') return null;
    const audit = report.auditReport;
    if (!audit || !Array.isArray(audit.auditorResults)) return null;
    const score = (domain: string) => audit.auditorResults!.find(a => a.domain === domain)?.complianceScore;
    const counts = audit.findingCounts;
    return {
      updatedAt: latest.updatedAt,
      niifScore: score('niif'), taxScore: score('tributario'), legalScore: score('legal'),
      findings: counts?.critico !== undefined && counts.alto !== undefined && counts.medio !== undefined
        ? { critico: counts.critico, alto: counts.alto, medio: counts.medio } : undefined,
      opinion: audit.opinionType,
    };
  } catch { return null; }
}

// A trial balance alone does not establish either a tax optimization baseline,
// a valuation scenario or project probabilities. These require explicit inputs
// from the corresponding module. Do not label assumed figures as ERP facts.
export async function getTaxEfficiencyRatio(
  _connections: ErpConnectionLite[] = [],
): Promise<LiveKpiValue> {
  return unavailable('Faltan bases fiscales verificadas antes y después de la planeación.');
}
export async function getExitValue(
  _connections: ErpConnectionLite[] = [],
): Promise<LiveKpiValue> {
  return unavailable('Faltan EBITDA validado, deuda neta y supuestos de valoración confirmados.');
}
export async function getProbabilisticROI(
  _connections: ErpConnectionLite[] = [],
): Promise<LiveKpiValue> {
  return unavailable('Faltan inversiones, retornos y probabilidades de proyectos documentados.');
}
export async function getRegulatoryHealth(
  _connections: ErpConnectionLite[] = [],
  digest: ReportDigest | null = readLatestReport(),
): Promise<LiveKpiValue> {
  const validScore = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  const validCount = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!digest || !validScore(digest.niifScore) || !validScore(digest.taxScore) ||
      !validScore(digest.legalScore) || !digest.findings ||
      !(['critico', 'alto', 'medio'] as const).every(key => validCount(digest.findings![key])) ||
      !digest.opinion || !['favorable', 'con_salvedades', 'desfavorable', 'abstension'].includes(digest.opinion)) {
    return unavailable('Falta una auditoría completa con puntuaciones, hallazgos y dictamen.');
  }
  const result = calculateComplianceScore({
    niifCompliance: digest.niifScore, taxCompliance: digest.taxScore,
    legalCompliance: digest.legalScore, auditFindingsCritical: digest.findings.critico,
    auditFindingsHigh: digest.findings.alto, auditFindingsMedium: digest.findings.medio,
    lastAuditOpinion: digest.opinion,
  });
  return { value: result.value, formatted: result.formatted, trend: 'flat', trendPercent: 0,
    severity: result.severity, source: 'report', sparkline: [], updatedAt: digest.updatedAt };
}
export async function getDashboardKpis(connections: ErpConnectionLite[] = []): Promise<DashboardKPIs> {
  const [escudo, valor, verdad, futuro] = await Promise.all([
    getTaxEfficiencyRatio(connections), getExitValue(connections),
    getRegulatoryHealth(connections), getProbabilisticROI(connections),
  ]);
  return { escudo, valor, verdad, futuro };
}

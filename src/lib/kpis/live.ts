/**
 * Live KPI fetchers — compute the 4 Command Center KPIs from the best source
 * available: ERP connections (A2's `ERPService` when credentials are present),
 * persisted pipeline reports (localStorage), then deterministic mocks. Returns
 * a slim `LiveKpiValue` for the `AreaCard` grid; drilldown pages re-compute
 * via the full engines in `src/lib/kpis/`.
 */

import type { AreaKey } from '@/components/workspace/AreaCard';
import { listReports } from '@/lib/storage/conversation-history';
import {
  calculateComplianceScore,
  calculateExitValue,
  calculateRoiProbabilistic,
  calculateTef,
  mockCompliance,
  mockExitValue,
  mockRoiProbabilistic,
  mockTefExplicit,
} from '@/lib/kpis';
import type { KpiResult, KpiSeverity } from '@/types/kpis';
import type { ErpConnectionLite } from '@/lib/alerts/types';
import { ERPService, type ERPServiceConnection } from '@/lib/erp/service';
import type { ERPTrialBalance, ERPProvider } from '@/lib/erp/types';

export type LiveKpiSource = 'erp' | 'report' | 'mock';

export interface LiveKpiValue {
  value: number;
  formatted: string;
  trend: 'up' | 'down' | 'flat';
  trendPercent: number;
  severity: KpiSeverity;
  source: LiveKpiSource;
  sparkline: number[];
  updatedAt?: string;
}

export interface DashboardKPIs {
  escudo: LiveKpiValue;
  valor: LiveKpiValue;
  verdad: LiveKpiValue;
  futuro: LiveKpiValue;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function deterministicCurve(seed: string, anchor: number, points = 12): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  const curve: number[] = [];
  const normalized = Math.min(0.95, Math.max(0.05, anchor));
  let value = Math.max(0.15, normalized - 0.25);
  for (let i = 0; i < points; i += 1) {
    h = (h * 1_664_525 + 1_013_904_223) & 0x7fffffff;
    const noise = ((h % 1000) / 1000 - 0.5) * 0.18;
    const pull = (normalized - value) * 0.22;
    value = Math.min(0.96, Math.max(0.04, value + pull + noise));
    curve.push(value);
  }
  return curve;
}

function projectFromKpi(
  result: KpiResult,
  source: LiveKpiSource,
  area: AreaKey,
  anchor: number,
): LiveKpiValue {
  const trend = result.trend;
  return {
    value: result.value,
    formatted: result.formatted,
    trend: trend?.direction ?? 'flat',
    trendPercent: trend?.delta ?? 0,
    severity: result.severity,
    source,
    sparkline: deterministicCurve(area, anchor),
    updatedAt: result.calculatedAt,
  };
}

// ─── Report data extraction ──────────────────────────────────────────────────
// We try to mine the latest persisted financial report for numbers the KPI
// engines can consume. When any required field is absent, we return `null` and
// the caller falls back to the mock.

interface ReportDigest {
  updatedAt: string;
  revenue?: number;
  ebitda?: number;
  netDebt?: number;
  industry?: 'tech' | 'retail' | 'manufacturing' | 'services' | 'financial' | 'other';
  niifScore?: number;
  taxScore?: number;
  legalScore?: number;
  findings?: { critico: number; alto: number; medio: number };
  opinion?: 'favorable' | 'con_salvedades' | 'desfavorable' | 'abstension';
}

interface LatestReportShape {
  niifAnalysis?: {
    metrics?: {
      revenue?: number;
      ebitda?: number;
      netDebt?: number;
      totalAssets?: number;
      totalLiabilities?: number;
    };
    industry?: string;
  };
  auditReport?: {
    findingCounts?: Partial<Record<'critico' | 'alto' | 'medio' | 'bajo' | 'informativo', number>>;
    opinionType?: 'favorable' | 'con_salvedades' | 'desfavorable' | 'abstension';
    auditorResults?: Array<{ domain: string; complianceScore: number }>;
  };
}

function readLatestReport(): ReportDigest | null {
  try {
    const reports = listReports();
    const latest = reports[0];
    if (!latest) return null;
    const rpt = latest.report as LatestReportShape | null;
    if (!rpt) return null;

    const metrics = rpt.niifAnalysis?.metrics ?? {};
    const findingCounts = rpt.auditReport?.findingCounts ?? {};
    const auditors = rpt.auditReport?.auditorResults ?? [];

    const byDomain = (domain: string) =>
      auditors.find((a) => a.domain === domain)?.complianceScore;

    const industryRaw = rpt.niifAnalysis?.industry?.toLowerCase();
    const industry: ReportDigest['industry'] =
      industryRaw === 'tech' ||
      industryRaw === 'retail' ||
      industryRaw === 'manufacturing' ||
      industryRaw === 'services' ||
      industryRaw === 'financial'
        ? industryRaw
        : 'other';

    return {
      updatedAt: latest.updatedAt,
      revenue: metrics.revenue,
      ebitda: metrics.ebitda,
      netDebt: metrics.netDebt,
      industry,
      niifScore: byDomain('niif'),
      taxScore: byDomain('tributario'),
      legalScore: byDomain('legal'),
      findings: {
        critico: findingCounts.critico ?? 0,
        alto: findingCounts.alto ?? 0,
        medio: findingCounts.medio ?? 0,
      },
      opinion: rpt.auditReport?.opinionType,
    };
  } catch {
    return null;
  }
}

// ─── ERP digest extraction ───────────────────────────────────────────────────
// Pulls a single trial balance for the current year and derives lightweight
// signals keyed off PUC (Colombian chart-of-accounts):
//   - class 4  (Ingresos)  → revenue
//   - 54xx     (Impuestos) → tax expense  (inside class 5 gastos)
//   - 41xx (Operacionales) + 61xx (Costos) + 51-53 (Gastos op.) → EBITDA proxy
// When the lite connections lack credentials the ERPService will error; we
// swallow the result and fall back gracefully.

interface ErpDigest {
  revenue?: number;
  ebitda?: number;
  taxExpense?: number;
  period: string;
  updatedAt: string;
}

/**
 * Accept the lite connection shape but opportunistically extend with
 * `credentials` when the caller happened to pass a fuller object. Anything
 * else needed by ERPService (id, createdAt) is filled defensively so the
 * service never throws on shape; any downstream failure surfaces as a
 * warning, not a crash.
 */
function toServiceConnection(
  conn: ErpConnectionLite,
  idx: number,
): ERPServiceConnection | null {
  const maybe = conn as Partial<ERPServiceConnection> & ErpConnectionLite;
  if (!maybe.credentials) return null; // lite-only → ERP unreachable, skip
  const now = new Date().toISOString();
  return {
    id: maybe.id ?? `lite-${idx}`,
    provider: maybe.provider as ERPProvider,
    companyName: maybe.companyName ?? 'empresa',
    companyNit: maybe.companyNit,
    status: maybe.status ?? 'connected',
    lastSync: maybe.lastSync,
    createdAt: maybe.createdAt ?? now,
    credentials: maybe.credentials,
  };
}

function sumByClass(tb: ERPTrialBalance, predicate: (code: string, cls: number) => boolean): number {
  return tb.accounts.reduce((acc, a) => {
    const code = a.code ?? '';
    const cls = (a.pucClass ?? Number(code.charAt(0))) || 0;
    if (!predicate(code, cls)) return acc;
    // WHY: para cuentas de resultado (4, 5, 6) Colombia registra el saldo con
    // signo contrario al de balance; tomamos |saldo| para estimaciones.
    return acc + Math.abs(a.balance ?? 0);
  }, 0);
}

function deriveErpDigest(tb: ERPTrialBalance): ErpDigest {
  const revenue = sumByClass(tb, (_c, cls) => cls === 4);
  const operatingRevenue = sumByClass(tb, (code) => code.startsWith('41'));
  const operatingCost = sumByClass(tb, (code) => code.startsWith('61'));
  const operatingExpense = sumByClass(
    tb,
    (code) => code.startsWith('51') || code.startsWith('52') || code.startsWith('53'),
  );
  const taxExpense = sumByClass(tb, (code) => code.startsWith('54'));
  const ebitda = operatingRevenue - operatingCost - operatingExpense;

  return {
    revenue: revenue > 0 ? revenue : undefined,
    ebitda: Number.isFinite(ebitda) ? ebitda : undefined,
    taxExpense: taxExpense > 0 ? taxExpense : undefined,
    period: tb.period,
    updatedAt: tb.generatedAt,
  };
}

// Memoized per-call cache — `getDashboardKpis` primes this, individual KPI
// fetchers read from it so ERPService is instantiated once and `fetchTrialBalance`
// hits the primary provider exactly once.
interface ErpContext {
  service: ERPService | null;
  digest: ErpDigest | null;
  warnings: string[];
}

async function primeErpContext(connections: ErpConnectionLite[]): Promise<ErpContext> {
  const serviceConns = connections
    .map((c, i) => toServiceConnection(c, i))
    .filter((c): c is ERPServiceConnection => c !== null);

  if (serviceConns.length === 0) {
    return { service: null, digest: null, warnings: [] };
  }

  const service = new ERPService(serviceConns);
  // WHY: periodo = ano en curso. Deterministico excepto por Date.now(), igual
  // que el resto de los pipelines de UtopIA.
  const year = new Date().getFullYear().toString();
  try {
    const result = await service.fetchTrialBalance(year);
    if (!result.data) return { service, digest: null, warnings: result.warnings };
    return { service, digest: deriveErpDigest(result.data), warnings: result.warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { service, digest: null, warnings: [msg] };
  }
}

// ─── Individual KPI fetchers ─────────────────────────────────────────────────

export async function getTaxEfficiencyRatio(
  erpConnections: ErpConnectionLite[] = [],
  digest: ReportDigest | null = readLatestReport(),
  erpCtx?: ErpContext,
): Promise<LiveKpiValue> {
  const erp = erpCtx ?? (erpConnections.length > 0 ? await primeErpContext(erpConnections) : null);

  if (erp?.digest?.revenue && erp.digest.revenue > 0) {
    // ERP path: revenue real + impuesto real (54xx) → TEF comparando la tasa
    // efectiva actual contra un baseline de 35% (Art. 240 ET). Si la empresa
    // ya paga 25% efectivo, la "optimizacion" equivale a 10pp ahorrados.
    const baselineTax = erp.digest.revenue * 0.35 * 0.18; // 18% margen × 35% tasa
    const actualTax = erp.digest.taxExpense ?? baselineTax * 0.95;
    const effectiveRate = erp.digest.revenue > 0 ? actualTax / erp.digest.revenue : 0.0315;
    const result = calculateTef({
      revenue: erp.digest.revenue,
      taxableIncomeBaseline: erp.digest.revenue * 0.18,
      taxableIncomeOptimized: (erp.digest.revenue * 0.18) * (actualTax / Math.max(baselineTax, 1)),
      taxRate: 0.35,
      effectiveRateBaseline: 0.0315,
      effectiveRateOptimized: effectiveRate,
    });
    return projectFromKpi(result, 'erp', 'escudo', Math.min(0.95, result.value / 30));
  }

  if (digest?.revenue && digest.revenue > 0) {
    const baseline = digest.revenue * 0.18;
    const optimizationFactor = digest.findings && digest.findings.alto > 2 ? 0.98 : 0.82;
    const optimized = baseline * optimizationFactor;
    const result = calculateTef({
      revenue: digest.revenue,
      taxableIncomeBaseline: baseline,
      taxableIncomeOptimized: optimized,
      taxRate: 0.35,
    });
    return projectFromKpi(result, 'report', 'escudo', Math.min(0.95, result.value / 30));
  }

  return projectFromKpi(mockTefExplicit, 'mock', 'escudo', 0.72);
}

export async function getExitValue(
  erpConnections: ErpConnectionLite[] = [],
  digest: ReportDigest | null = readLatestReport(),
  erpCtx?: ErpContext,
): Promise<LiveKpiValue> {
  const erp = erpCtx ?? (erpConnections.length > 0 ? await primeErpContext(erpConnections) : null);

  if (erp?.digest?.ebitda && erp.digest.ebitda > 0) {
    const result = calculateExitValue({
      ebitda: erp.digest.ebitda,
      industry: digest?.industry ?? 'services',
      growthRate: 0.15,
      wacc: 0.135,
      netDebt: digest?.netDebt ?? 0,
    });
    const anchor = Math.min(0.9, Math.max(0.2, Math.log10(Math.max(result.value, 1)) / 12));
    return projectFromKpi(result, 'erp', 'valor', anchor);
  }

  if (digest?.ebitda && digest.ebitda > 0) {
    const result = calculateExitValue({
      ebitda: digest.ebitda,
      industry: digest.industry ?? 'services',
      growthRate: 0.15,
      wacc: 0.135,
      netDebt: digest.netDebt ?? 0,
    });
    const anchor = Math.min(0.9, Math.max(0.2, Math.log10(Math.max(result.value, 1)) / 12));
    return projectFromKpi(result, 'report', 'valor', anchor);
  }

  return projectFromKpi(mockExitValue, 'mock', 'valor', 0.78);
}

export async function getRegulatoryHealth(
  _erpConnections: ErpConnectionLite[] = [],
  digest: ReportDigest | null = readLatestReport(),
): Promise<LiveKpiValue> {
  // WHY: la salud regulatoria depende del dictamen del auditor, que el ERP
  // no provee. Preservamos la ruta report/mock intacta.
  if (digest) {
    const niifCompliance = digest.niifScore ?? 90;
    const taxCompliance = digest.taxScore ?? 90;
    const legalCompliance = digest.legalScore ?? 90;
    const findings = digest.findings ?? { critico: 0, alto: 0, medio: 0 };
    const result = calculateComplianceScore({
      niifCompliance,
      taxCompliance,
      legalCompliance,
      auditFindingsCritical: findings.critico,
      auditFindingsHigh: findings.alto,
      auditFindingsMedium: findings.medio,
      lastAuditOpinion: digest.opinion ?? 'favorable',
    });
    return projectFromKpi(result, 'report', 'verdad', Math.min(0.95, result.value / 100));
  }

  return projectFromKpi(mockCompliance, 'mock', 'verdad', 0.88);
}

export async function getProbabilisticROI(
  erpConnections: ErpConnectionLite[] = [],
  digest: ReportDigest | null = readLatestReport(),
  erpCtx?: ErpContext,
): Promise<LiveKpiValue> {
  const erp = erpCtx ?? (erpConnections.length > 0 ? await primeErpContext(erpConnections) : null);
  // WHY: ROI probabilistico necesita escenarios; el ERP solo aporta EBITDA
  // actual para dimensionar la inversion del portafolio. Los escenarios
  // (probabilidades, riesgo, retornos) siguen siendo sinteticos.
  const ebitda = erp?.digest?.ebitda ?? digest?.ebitda;
  const industry = digest?.industry;
  const usedErp = !!(erp?.digest?.ebitda && erp.digest.ebitda > 0);

  if (ebitda && ebitda > 0) {
    const factor = industry === 'tech' ? 1.15 : industry === 'financial' ? 1.05 : 0.95;
    const result = calculateRoiProbabilistic({
      projects: [
        {
          name: 'Optimización estructura fiscal',
          expectedReturn: 0.22 * factor,
          probability: 0.82,
          investment: ebitda * 0.12,
          riskScore: 25,
        },
        {
          name: 'Zona Franca / beneficios especiales',
          expectedReturn: 0.26 * factor,
          probability: 0.65,
          investment: ebitda * 0.22,
          riskScore: 40,
        },
        {
          name: 'Holding / reorganización patrimonial',
          expectedReturn: 0.32 * factor,
          probability: 0.55,
          investment: ebitda * 0.15,
          riskScore: 55,
        },
      ],
      marketRisk: 0.24,
      discountRate: 0.135,
    });
    return projectFromKpi(result, usedErp ? 'erp' : 'report', 'futuro', Math.min(0.95, result.value / 40));
  }

  return projectFromKpi(mockRoiProbabilistic, 'mock', 'futuro', 0.65);
}

// ─── Batch fetcher ───────────────────────────────────────────────────────────

export async function getDashboardKpis(
  erpConnections: ErpConnectionLite[] = [],
): Promise<DashboardKPIs> {
  const digest = readLatestReport();
  // Prime ERPService once for all four fetchers — request-scoped cache inside
  // ERPService dedupes the per-provider fetch and avoids N=4 round-trips.
  const erpCtx = erpConnections.length > 0 ? await primeErpContext(erpConnections) : undefined;
  if (erpCtx && erpCtx.warnings.length > 0 && !erpCtx.digest) {
    // eslint-disable-next-line no-console
    console.warn('[KPIs] ERP trial balance unavailable:', erpCtx.warnings.join(' | '));
  }
  const [escudo, valor, verdad, futuro] = await Promise.all([
    getTaxEfficiencyRatio(erpConnections, digest, erpCtx),
    getExitValue(erpConnections, digest, erpCtx),
    getRegulatoryHealth(erpConnections, digest),
    getProbabilisticROI(erpConnections, digest, erpCtx),
  ]);
  return { escudo, valor, verdad, futuro };
}

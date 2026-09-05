import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { reports, type Workspace } from './schema';
import { requireWorkspace } from './workspace';
import { isAuthConfigured } from '@/lib/auth/enabled';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { FinancialReport, CompanyInfo, NiifAnalysisResult, StrategicAnalysisResult } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';

export const reportOutputOptionsSchema = z.object({
  financialStatements: z.boolean().optional(), kpiDashboard: z.boolean().optional(),
  cashFlowProjection: z.boolean().optional(), breakevenAnalysis: z.boolean().optional(),
  notesToFinancialStatements: z.boolean().optional(), shareholdersMinutes: z.boolean().optional(),
  auditPipeline: z.boolean().optional(), metaAudit: z.boolean().optional(),
  excelExport: z.boolean().optional(), comparativeAnalysis: z.boolean().optional(),
}).strict().optional();

export const FINANCIAL_VERSION_KIND = 'financial_server_version_v1';
export class ReportVersionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface FinancialVersion {
  outputOptions?: z.infer<typeof reportOutputOptionsSchema>;
  stage: 'niif' | 'strategy' | 'complete';
  parentId: string | null;
  rawData: string;
  company: CompanyInfo;
  language: 'es' | 'en';
  instructions?: string;
  excludedFactIds: string[] | null;
  bindingTotals: string;
  preprocessed: unknown;
  niifResult: NiifAnalysisResult;
  strategyResult?: StrategicAnalysisResult;
  report?: FinancialReport;
  provisional?: unknown;
  adjustmentLedger?: unknown;
  fiscalSnapshot?: FinancialReport['fiscalSnapshot'];
  ancora?: FinancialReport['ancora'];
}
interface StoredVersion {
  payload: FinancialVersion;
  sha256: string;
  sourceSha256: string;
  rules: string;
  buildCommit: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// JSONB changes key ordering: sort recursively before hashing. No truncation.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function versionDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export async function requireReportWorkspace(): Promise<Workspace> {
  if (!isAuthConfigured()) throw new ReportVersionError(503, 'Authenticated report storage is not configured.');
  const workspace = await requireWorkspace();
  if (!workspace?.userId) throw new ReportVersionError(401, 'Authentication required.');
  if (!workspace.nit) throw new ReportVersionError(409, 'Configure the company NIT before generating a persisted report.');
  return workspace;
}
export function assertReportCompany(workspace: Workspace, company: CompanyInfo) {
  const nit = (s: string) => s.replace(/[^0-9]/g, '');
  if (!workspace.nit || !nit(workspace.nit) || nit(workspace.nit) !== nit(company.nit)) {
    throw new ReportVersionError(403, 'Company does not belong to the current workspace.');
  }
}
export async function saveFinancialVersion(workspace: Workspace, payload: FinancialVersion): Promise<string> {
  assertReportCompany(workspace, payload.company);
  const safe = JSON.parse(JSON.stringify(toJsonSafe(payload))) as FinancialVersion;
  const envelope = {
    payload: safe,
    sourceSha256: createHash('sha256').update(safe.rawData).digest('hex'),
    rules: 'financial-pipeline-v2.1;financial-server-version-v1',
    buildCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
  const data: StoredVersion = { ...envelope, sha256: versionDigest(envelope) };
  // Append-only: retries create distinct versions; no client endpoint may update this kind.
  let row;
  try {
    [row] = await getDb().insert(reports).values({
      workspaceId: workspace.id, kind: FINANCIAL_VERSION_KIND,
      title: `${payload.company.name} — ${payload.company.fiscalPeriod} — ${payload.stage}`,
      data,
    }).returning({ id: reports.id });
  } catch {
    // Driver messages may contain SQL parameters (the complete financial data).
    throw new ReportVersionError(503, 'Report storage is unavailable.');
  }
  if (!row) throw new ReportVersionError(503, 'Report could not be persisted.');
  return row.id;
}
export async function loadFinancialVersionRecord(
  workspace: Workspace, id: unknown,
): Promise<{ payload: FinancialVersion; sha256: string }> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new ReportVersionError(400, 'Invalid report version reference.');
  let row;
  try {
    [row] = await getDb().select({ data: reports.data }).from(reports).where(and(
      eq(reports.id, id), eq(reports.workspaceId, workspace.id), eq(reports.kind, FINANCIAL_VERSION_KIND),
    )).limit(1);
  } catch { throw new ReportVersionError(503, 'Report storage is unavailable.'); }
  if (!row) throw new ReportVersionError(404, 'Report version not found.');
  const stored = row.data as StoredVersion;
  if (!stored?.payload) throw new ReportVersionError(409, 'Report version integrity check failed.');
  const { sha256, ...envelope } = stored;
  if (versionDigest(envelope) !== sha256) {
    throw new ReportVersionError(409, 'Report version integrity check failed.');
  }
  assertReportCompany(workspace, stored.payload.company);
  return { payload: stored.payload, sha256 };
}

export async function loadFinancialVersion(workspace: Workspace, id: unknown): Promise<FinancialVersion> {
  return (await loadFinancialVersionRecord(workspace, id)).payload;
}

// ---------------------------------------------------------------------------
// Audit and meta-audit results (Parte IV / Parte V)
// ---------------------------------------------------------------------------
// Stored in the same `reports` table under their own kind, so no schema
// migration is needed. Each result names the exact financial version it
// examined and carries that version's digest at examination time. A result is
// never accepted from a client: routes run the agents over a loaded version
// and persist the output before reporting success.
export const AUDIT_VERSION_KIND = 'financial_audit_version_v1';

export type AuditResultKind = 'audit' | 'quality';

export interface AuditVersion {
  kind: AuditResultKind;
  /** Financial version whose content the agents actually examined. */
  reportVersionId: string;
  /** Digest of that version's stored envelope when it was examined. */
  examinedSha256: string;
  examinedStage: FinancialVersion['stage'];
  company: CompanyInfo;
  language: 'es' | 'en';
  /** Meta-audit only: the audit result it consumed, `null` when it ran without one. */
  auditVersionId: string | null;
  /** False when an auditor failed or the agent returned nothing to report. */
  complete: boolean;
  audit?: AuditReport;
  quality?: QualityAssessment;
}

interface StoredAuditVersion {
  payload: AuditVersion;
  sha256: string;
  rules: string;
  buildCommit: string | null;
}

/** A partial result stays visible on screen but is never exported as the result of record. */
export function auditResultIsComplete(payload: Pick<AuditVersion, 'kind' | 'audit' | 'quality'>): boolean {
  if (payload.kind === 'audit') {
    const results = payload.audit?.auditorResults;
    return Array.isArray(results) && results.length > 0 && results.every(r => !r.failed)
      && !!payload.audit?.consolidatedReport?.trim();
  }
  const dimensions = payload.quality?.dimensions;
  return Array.isArray(dimensions) && dimensions.length > 0 && !!payload.quality?.fullReport?.trim();
}

export async function saveAuditVersion(workspace: Workspace, payload: AuditVersion): Promise<string> {
  assertReportCompany(workspace, payload.company);
  const safe = JSON.parse(JSON.stringify(toJsonSafe(payload))) as AuditVersion;
  const envelope = {
    payload: safe,
    rules: 'financial-pipeline-v2.1;financial-audit-version-v1',
    buildCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
  const data: StoredAuditVersion = { ...envelope, sha256: versionDigest(envelope) };
  let row;
  try {
    [row] = await getDb().insert(reports).values({
      workspaceId: workspace.id, kind: AUDIT_VERSION_KIND,
      title: `${payload.company.name} — ${payload.company.fiscalPeriod} — ${payload.kind}`,
      data,
    }).returning({ id: reports.id });
  } catch {
    // Driver messages may contain SQL parameters (the complete audit content).
    throw new ReportVersionError(503, 'Audit storage is unavailable.');
  }
  if (!row) throw new ReportVersionError(503, 'Audit result could not be persisted.');
  return row.id;
}

export async function loadAuditVersion(
  workspace: Workspace, id: unknown, kind: AuditResultKind,
): Promise<AuditVersion> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new ReportVersionError(400, 'Invalid audit result reference.');
  let row;
  try {
    [row] = await getDb().select({ data: reports.data }).from(reports).where(and(
      eq(reports.id, id), eq(reports.workspaceId, workspace.id), eq(reports.kind, AUDIT_VERSION_KIND),
    )).limit(1);
  } catch { throw new ReportVersionError(503, 'Audit storage is unavailable.'); }
  if (!row) throw new ReportVersionError(404, 'Audit result not found.');
  const stored = row.data as StoredAuditVersion;
  if (!stored?.payload) throw new ReportVersionError(409, 'Audit result integrity check failed.');
  const { sha256, ...envelope } = stored;
  if (versionDigest(envelope) !== sha256) {
    throw new ReportVersionError(409, 'Audit result integrity check failed.');
  }
  assertReportCompany(workspace, stored.payload.company);
  if (stored.payload.kind !== kind) throw new ReportVersionError(409, 'Audit result is of a different kind.');
  return stored.payload;
}

// A result examined one version of the report; the download may name a later
// version of the same chain (the audit runs on the NIIF stage while strategy and
// governance are still running). Anything outside that chain is a different report.
const MAX_LINEAGE_DEPTH = 16;

export async function resolveVersionLineage(workspace: Workspace, id: string): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current) && chain.length < MAX_LINEAGE_DEPTH) {
    seen.add(current);
    chain.push(current);
    const parent: string | null = (await loadFinancialVersion(workspace, current)).parentId;
    current = parent;
  }
  return chain;
}

/**
 * Load an audit or meta-audit result and prove it belongs to the report version
 * being exported: same workspace and company, same version chain, the examined
 * version unchanged since it was examined, and — unless the caller opts out —
 * a complete result.
 */
export async function loadBoundAuditVersion(args: {
  workspace: Workspace;
  id: unknown;
  kind: AuditResultKind;
  lineage: string[];
  /** The export demands a complete result; the meta-audit may read a partial one. */
  requireComplete?: boolean;
}): Promise<AuditVersion> {
  const payload = await loadAuditVersion(args.workspace, args.id, args.kind);
  if (!args.lineage.includes(payload.reportVersionId)) {
    throw new ReportVersionError(409, 'Audit result belongs to a different report version.');
  }
  const examined = await loadFinancialVersionRecord(args.workspace, payload.reportVersionId);
  if (examined.sha256 !== payload.examinedSha256) {
    throw new ReportVersionError(409, 'The examined report version no longer matches the audit result.');
  }
  if (args.requireComplete !== false && !payload.complete) {
    throw new ReportVersionError(409, 'Audit result is incomplete and cannot be exported.');
  }
  return payload;
}

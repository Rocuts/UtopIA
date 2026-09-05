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
export async function loadFinancialVersion(workspace: Workspace, id: unknown): Promise<FinancialVersion> {
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
  return stored.payload;
}

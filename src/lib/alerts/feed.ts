/**
 * Alerts feed — aggregates operational signals for the Command Center.
 *
 * Sources (in priority):
 *  1. Audit findings from last persisted report (severity criticas/altas).
 *  2. Validation warnings/errors attached to the last FinancialReport.
 *  3. ERP connection errors (status !== 'connected').
 *  4. Verified Colombian tax deadlines (single source of truth — pulled from
 *     `@/lib/calendars/source` so we never drift from the LLM tool's data).
 *
 * The feed is deterministic, side-effect free and ready to run in an
 * SSR-safe context — every read from `localStorage` is guarded.
 */

import { listReports } from '@/lib/storage/conversation-history';
import type { NationalDeadline } from '@/data/calendars';
import type { Alert, AlertArea, AlertSeverity, ErpConnectionLite } from './types';

// NOTA Ola 2: este módulo se usa desde Client Components (ExecutiveDashboard).
// Importar `@/lib/calendars/source` directamente arrastra `pg` al bundle del
// cliente y rompe el build (Module not found: 'dns', 'fs', 'net', 'tls').
// En lugar de eso fetch al endpoint `/api/calendar/verified` que envuelve
// `getVerifiedNational` server-side.
interface VerifiedCalendarResponse {
  source: 'database' | 'fallback' | 'none';
  deadlines: NationalDeadline[];
}

async function fetchVerifiedNational(year: number): Promise<VerifiedCalendarResponse> {
  const baseUrl =
    typeof window === 'undefined'
      ? process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'
      : '';
  const res = await fetch(`${baseUrl}/api/calendar/verified?year=${year}`, {
    cache: 'force-cache',
    next: { revalidate: 3600 },
  });
  if (!res.ok) return { source: 'none', deadlines: [] };
  return (await res.json()) as VerifiedCalendarResponse;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warn: 2,
  info: 1,
};

function sortAlerts(list: Alert[]): Alert[] {
  return [...list].sort((a, b) => {
    const rankDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rankDelta !== 0) return rankDelta;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

const MS_PER_DAY = 86_400_000;

/** Last digit of a NIT, ignoring the check digit ("dígito de verificación"). */
function parseLastDigit(rawNit: string | undefined): number | null {
  if (!rawNit) return null;
  const digitsOnly = rawNit.replace(/\D/g, '');
  if (digitsOnly.length === 0) return null;
  // Strip a single check digit if the NIT looks like 9-10 digits + DV (separated
  // by '-' in the source). When user types "900123456-7", we want '6'.
  const hasCheckDigit = /[-\s]\d$/.test(rawNit);
  const effective = hasCheckDigit ? digitsOnly.slice(0, -1) : digitsOnly;
  if (effective.length === 0) return null;
  return Number(effective[effective.length - 1]);
}

/** Maps a NationalDeadline obligation to one of the four UtopIA areas. */
function deriveArea(obligation: string): AlertArea {
  // Escudo: defensive tax / DIAN-facing obligations
  if (/Renta|Retención|IVA/i.test(obligation)) return 'escudo';
  // Verdad: information / compliance reporting
  if (/Información Exógena|ICA|auxiliares|Medios Magnéticos/i.test(obligation)) return 'verdad';
  // Valor: wealth / cross-border
  if (/Activos en el Exterior|Patrimonio/i.test(obligation)) return 'valor';
  // Default: forward-looking / strategic bucket
  return 'futuro';
}

/**
 * Convert a verified national deadline into an Alert, applying the user-NIT
 * filter and the time horizon. Returns null when the deadline is past, too
 * far in the future, or doesn't match the user's NIT digit.
 */
export function nationalToAlert(d: NationalDeadline, userNit?: string): Alert | null {
  // NIT filter — if we know the user's NIT, only surface their digit
  const userDigit = parseLastDigit(userNit);
  if (userDigit !== null && d.nitDigit !== userDigit) return null;

  if (d.dueDate === 'pendiente') return null;

  const dueMs = Date.parse(d.dueDate);
  if (Number.isNaN(dueMs)) return null;

  const daysUntil = (dueMs - Date.now()) / MS_PER_DAY;
  // Past due (>1 day past) or too far out (>90 days) → drop
  if (daysUntil < -1) return null;
  if (daysUntil > 90) return null;

  const severity: AlertSeverity =
    daysUntil <= 7 ? 'critical' : daysUntil <= 30 ? 'warn' : 'info';

  const lead =
    daysUntil <= 0
      ? 'Vence hoy'
      : daysUntil < 2
        ? 'Vence mañana'
        : `En ${Math.round(daysUntil)} días`;

  return {
    id: `deadline:${d.dueDate}:${d.obligation}:${d.nitDigit}`,
    severity,
    area: deriveArea(d.obligation),
    title: `${d.obligation} — NIT dígito ${d.nitDigit} · ${lead}`,
    description: `${d.period}. Base: ${d.legalBasis}${d.notes ? ` · ${d.notes}` : ''}`,
    createdAt: new Date(dueMs).toISOString(),
    source: 'deadline',
  };
}

async function deadlineAlerts(userNit?: string): Promise<Alert[]> {
  try {
    const verified = await fetchVerifiedNational(2026);
    if (verified.source === 'none' || verified.deadlines.length === 0) return [];

    const out: Alert[] = [];
    for (const d of verified.deadlines) {
      const alert = nationalToAlert(d, userNit);
      if (alert) out.push(alert);
    }
    return out;
  } catch (err) {
    // Never crash the dashboard if the calendar source layer fails.
    console.error('[alerts] Failed to load verified national deadlines.', err);
    return [];
  }
}

function erpAlerts(connections: ErpConnectionLite[]): Alert[] {
  const out: Alert[] = [];
  for (const conn of connections) {
    const status = conn.status ?? 'connected';
    if (status === 'error') {
      out.push({
        id: `erp:${conn.provider}:error`,
        severity: 'critical',
        area: 'global',
        title: `ERP ${conn.provider} — sincronización fallida`,
        description: 'Reintenta la conexión desde Ajustes → Integraciones ERP.',
        createdAt: conn.lastSync ?? new Date().toISOString(),
        source: 'erp',
        actionHref: '/workspace/settings',
      });
    } else if (status === 'disconnected') {
      out.push({
        id: `erp:${conn.provider}:disconnected`,
        severity: 'warn',
        area: 'global',
        title: `ERP ${conn.provider} desconectado`,
        description: 'Los KPIs seguirán mostrando el último valor conocido.',
        createdAt: conn.lastSync ?? new Date().toISOString(),
        source: 'erp',
        actionHref: '/workspace/settings',
      });
    }
  }
  return out;
}

interface AuditFindingLike {
  severity?: string;
  title?: string;
  description?: string;
  normReference?: string;
}

interface StoredReportShape {
  auditReport?: {
    consolidatedFindings?: AuditFindingLike[];
    opinionType?: string;
  };
  validation?: {
    errors?: string[];
    warnings?: string[];
  };
}

function reportAlerts(): Alert[] {
  const out: Alert[] = [];
  const reports = listReports();
  const latest = reports[0];
  if (!latest) return out;

  const rpt = latest.report as StoredReportShape | null;
  if (!rpt) return out;

  // Audit findings — only "critico" and "alto" bubble up
  const findings = rpt.auditReport?.consolidatedFindings ?? [];
  for (const f of findings.slice(0, 20)) {
    const sev = f.severity;
    if (sev !== 'critico' && sev !== 'alto') continue;
    out.push({
      id: `audit:${latest.conversationId}:${f.title ?? sev}`,
      severity: sev === 'critico' ? 'critical' : 'warn',
      area: 'verdad',
      title: f.title ?? 'Hallazgo de auditoría',
      description: f.normReference
        ? `${f.description ?? ''} · ${f.normReference}`.trim()
        : f.description ?? '',
      createdAt: latest.updatedAt,
      source: 'audit',
    });
  }

  // Pipeline validation warnings/errors
  const errors = rpt.validation?.errors ?? [];
  for (const msg of errors.slice(0, 3)) {
    out.push({
      id: `validation:${latest.conversationId}:${msg.slice(0, 30)}`,
      severity: 'critical',
      area: 'global',
      title: 'Validación del pipeline — error',
      description: msg,
      createdAt: latest.updatedAt,
      source: 'validation',
    });
  }
  const warnings = rpt.validation?.warnings ?? [];
  for (const msg of warnings.slice(0, 3)) {
    out.push({
      id: `validation:${latest.conversationId}:w:${msg.slice(0, 30)}`,
      severity: 'warn',
      area: 'global',
      title: 'Validación del pipeline — aviso',
      description: msg,
      createdAt: latest.updatedAt,
      source: 'validation',
    });
  }

  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface GetAlertsInput {
  erpConnections?: ErpConnectionLite[];
  maxItems?: number;
  /** User's NIT — used to filter deadlines to the relevant digit. */
  userNit?: string;
}

export async function getAlerts(input: GetAlertsInput = {}): Promise<Alert[]> {
  const connections = input.erpConnections ?? [];
  const maxItems = input.maxItems ?? 12;

  const buckets: Alert[] = [
    ...reportAlerts(),
    ...erpAlerts(connections),
    ...(await deadlineAlerts(input.userNit)),
  ];

  return sortAlerts(buckets).slice(0, maxItems);
}

export function summarizeAlerts(alerts: Alert[]): {
  total: number;
  critical: number;
  warn: number;
  info: number;
} {
  const out = { total: alerts.length, critical: 0, warn: 0, info: 0 };
  for (const a of alerts) out[a.severity] += 1;
  return out;
}

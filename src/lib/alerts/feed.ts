/**
 * Alerts feed — aggregates operational signals for the Command Center.
 *
 * Sources (in priority):
 *  1. Audit findings from last persisted report (severity criticas/altas).
 *  2. Validation warnings/errors attached to the last FinancialReport.
 *  3. ERP connection errors (status !== 'connected').
 *  4. Static Colombian tax deadlines for the current calendar quarter.
 *
 * The feed is deterministic, side-effect free and ready to run in an
 * SSR-safe context — every read from `localStorage` is guarded.
 */

import { listReports } from '@/lib/storage/conversation-history';
import type { Alert, AlertArea, AlertSeverity, ErpConnectionLite } from './types';

// ─── Deadlines (Colombia, Q1-Q2 2026 — DIAN) ─────────────────────────────────
// Kept intentionally small and high-signal. Extend carefully so the feed stays
// glanceable.

interface Deadline {
  date: string;          // ISO date (used for sorting + staleness)
  title: string;
  description: string;
  area: AlertArea;
  severity: AlertSeverity;
}

const DEADLINES_2026: Deadline[] = [
  {
    date: '2026-04-30',
    title: 'Declaración renta — Personas jurídicas',
    description: 'Vencimientos escalonados según último dígito NIT. Art. 1.6.1.13.2.11 DUR.',
    area: 'escudo',
    severity: 'warn',
  },
  {
    date: '2026-05-15',
    title: 'IVA bimestral Mar–Abr',
    description: 'Formulario 300. Responsables con ingresos > 92.000 UVT.',
    area: 'escudo',
    severity: 'info',
  },
  {
    date: '2026-06-30',
    title: 'Información exógena 2025',
    description: 'Resolución DIAN. Formatos 1001–1011 por fechas específicas.',
    area: 'verdad',
    severity: 'warn',
  },
  {
    date: '2026-07-15',
    title: 'Retención en la fuente Junio',
    description: 'Formulario 350. Obligatorio para todos los agentes retenedores.',
    area: 'escudo',
    severity: 'info',
  },
  {
    date: '2026-09-15',
    title: 'ICA trimestral',
    description: 'Varía por municipio. Bogotá: CHIP autoliquidación.',
    area: 'verdad',
    severity: 'info',
  },
];

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

function daysUntil(isoDate: string): number {
  const target = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function deadlineAlerts(): Alert[] {
  const now = Date.now();
  const horizon = 1000 * 60 * 60 * 24 * 120; // 120 days forward
  const alerts: Alert[] = [];
  for (const d of DEADLINES_2026) {
    const ts = new Date(d.date).getTime();
    if (ts < now - 1000 * 60 * 60 * 24) continue; // past due, hide
    if (ts - now > horizon) continue;             // too far
    const delta = daysUntil(d.date);
    const sev: AlertSeverity = delta <= 10 ? 'critical' : delta <= 30 ? 'warn' : d.severity;
    const lead = delta <= 0 ? 'Vence hoy' : delta === 1 ? 'Vence mañana' : `En ${delta} días`;
    alerts.push({
      id: `deadline:${d.date}:${d.title}`,
      severity: sev,
      area: d.area,
      title: `${d.title} · ${lead}`,
      description: d.description,
      createdAt: new Date(d.date).toISOString(),
      source: 'deadline',
    });
  }
  return alerts;
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
}

export async function getAlerts(input: GetAlertsInput = {}): Promise<Alert[]> {
  const connections = input.erpConnections ?? [];
  const maxItems = input.maxItems ?? 12;

  const buckets: Alert[] = [
    ...reportAlerts(),
    ...erpAlerts(connections),
    ...deadlineAlerts(),
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

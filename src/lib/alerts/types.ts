/**
 * Alerts — operational telemetry surfaced at the top of the Command Center.
 *
 * Alerts aggregate anomalies from several sources (ERP sync failures, audit
 * findings, upcoming tax deadlines) into a single severity-sorted feed. They
 * are purely derived data — no LLM, no I/O, consumed by
 * `ExecutiveDashboard` and downstream area pages.
 */

import type { AreaKey } from '@/components/workspace/AreaCard';

export type AlertSeverity = 'info' | 'warn' | 'critical';
export type AlertArea = AreaKey | 'global';
export type AlertSource =
  | 'deadline'
  | 'audit'
  | 'pipeline'
  | 'erp'
  | 'validation';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  area: AlertArea;
  title: string;
  description: string;
  createdAt: string;
  source: AlertSource;
  actionHref?: string;
}

export type ErpConnectionLite = {
  provider: string;
  status?: 'connected' | 'disconnected' | 'error' | 'syncing';
  lastSync?: string;
  companyName?: string;
};

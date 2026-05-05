// ─── WS6 — Notifications: contratos públicos (Ola 1+1 Élite) ────────────────
//
// El consumidor principal es WS5 (workflow de cierre mensual): el step
// `notify` llama a `dispatchNotification({event: 'period.locked', ...})`.
// Owner: WS6.

import type {
  NotificationLogRow,
  NotificationSubscriptionRow,
} from '@/lib/db/schema';

export type { NotificationLogRow, NotificationSubscriptionRow };

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type NotificationEvent =
  | 'period.locked'
  | 'period.locked.with_warnings'
  | 'reconciliation.broken'
  | 'health_check.failed'
  | 'anomaly.detected';

export type NotificationChannel = 'email' | 'web_push' | 'whatsapp';

// ---------------------------------------------------------------------------
// Dispatch input
// ---------------------------------------------------------------------------

export interface DispatchNotificationInput {
  workspaceId: string;
  event: NotificationEvent;
  /** Idempotency: si llega el mismo (workspace, event, dedup_key) no se reenvía. */
  idempotencyKey: string;
  /** Forzar canales específicos (default: todos los activos del workspace). */
  channels?: NotificationChannel[];
  /** Datos para renderizar la plantilla. */
  payload: PeriodLockedPayload | ReconBrokenPayload | HealthFailedPayload | AnomalyPayload;
}

// ---------------------------------------------------------------------------
// Per-event payload shapes
// ---------------------------------------------------------------------------

export interface PeriodLockedPayload {
  workspaceName: string;
  periodLabel: string;
  periodHash: string;
  withWarnings: boolean;
  overrideReason?: string;
  /** KPIs por pilar (Resiliencia / Valor / Verdad / Futuro). */
  pillars: {
    resiliencia: { totalProvisionTaxesCop: string };
    valor: { ebitdaCop: string };
    verdad: { documentsVerifiedPct: number };
    futuro: { freeCashFlowProjectedCop: string };
  };
  /** Links a CTAs. */
  links: {
    viewReportUrl: string;
    shareReportUrl: string;
    viewAnomaliesUrl: string;
  };
}

export interface ReconBrokenPayload {
  workspaceName: string;
  periodLabel: string;
  bankAccountLabel: string;
  differenceCop: string;
  reviewUrl: string;
}

export interface HealthFailedPayload {
  workspaceName: string;
  periodLabel: string;
  reasons: string[];
  resumeUrl: string;
}

export interface AnomalyPayload {
  workspaceName: string;
  periodLabel: string;
  anomalyKind: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  reviewUrl: string;
}

// ---------------------------------------------------------------------------
// Dispatch result
// ---------------------------------------------------------------------------

export interface DispatchResult {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Detalle por suscripción/canal — útil para debugging. */
  perRecipient: Array<{
    subscriptionId: string;
    channel: NotificationChannel;
    recipientId: string;
    status: 'sent' | 'skipped' | 'failed';
    providerMessageId?: string;
    errorMessage?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Public API surface (a implementar por WS6)
// ---------------------------------------------------------------------------

export interface NotificationsPort {
  dispatch(input: DispatchNotificationInput): Promise<DispatchResult>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NotificationError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
    this.details = details;
  }
}

export const NOTIFY_ERR = {
  PROVIDER_FAILED: 'NOTIFY_PROVIDER_FAILED',
  RECIPIENT_INVALID: 'NOTIFY_RECIPIENT_INVALID',
  CHANNEL_DISABLED: 'NOTIFY_CHANNEL_DISABLED',
  ENGINE_DISABLED: 'NOTIFY_ENGINE_DISABLED',
  IDEMPOTENT_HIT: 'NOTIFY_IDEMPOTENT_HIT',
} as const;

// ---------------------------------------------------------------------------
// Feature flag helper
// ---------------------------------------------------------------------------

export function isNotificationsEnabled(): boolean {
  return process.env.UTOPIA_ENABLE_NOTIFICATIONS === 'true';
}

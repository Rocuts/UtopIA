// ---------------------------------------------------------------------------
// Relevance Learning Engine — escalation por inacción.
// ---------------------------------------------------------------------------
// Reglas:
//   - Alert pending > 48h sin acción → re-emite con tone='escalated' (severity
//     bumped si era 'advertencia' → 'critico') + email.
//   - Alert pending > 96h sin acción → tone='critical' + email URGENTE,
//     status pasa a 'escalated' (no se reemite hasta que el usuario actúe).
//   - Snoozed alert: respeta `snoozed_until`. Cuando expira, vuelve a
//     'pending' y el ciclo recomienza.
//
// La función NO hace I/O — recibe el row + now y devuelve la acción a
// aplicar. El llamador (orchestrator) ejecuta el patch en DB.
// ---------------------------------------------------------------------------

import type { SentinelAlertRow } from '@/lib/db/schema-sentinel';

export const REEMIT_THRESHOLD_HOURS = 48;
export const ESCALATE_THRESHOLD_HOURS = 96;
const HOUR_MS = 3_600_000;

export type EscalationAction =
  | { kind: 'noop' }
  | { kind: 'unsnooze' } // snooze expiró → volver a pending, ciclo nuevo
  | { kind: 'reemit'; newSeverity?: 'critico' | 'advertencia' | 'informativo' }
  | { kind: 'escalate'; newSeverity: 'critico' };

export function evaluateEscalation(
  alert: SentinelAlertRow,
  now: Date = new Date(),
): EscalationAction {
  if (alert.status === 'resolved' || alert.status === 'escalated') {
    return { kind: 'noop' };
  }

  if (alert.status === 'snoozed') {
    if (alert.snoozedUntil && alert.snoozedUntil <= now) {
      return { kind: 'unsnooze' };
    }
    return { kind: 'noop' };
  }

  // Para 'pending', medimos tiempo desde la última notificación (o creación
  // si nunca se notificó).
  const since = alert.lastNotifiedAt ?? alert.createdAt;
  const hours = (now.getTime() - since.getTime()) / HOUR_MS;

  if (hours >= ESCALATE_THRESHOLD_HOURS) {
    return { kind: 'escalate', newSeverity: 'critico' };
  }
  if (hours >= REEMIT_THRESHOLD_HOURS) {
    const newSeverity =
      alert.severity === 'informativo'
        ? 'advertencia'
        : alert.severity === 'advertencia'
          ? 'critico'
          : 'critico';
    return { kind: 'reemit', newSeverity };
  }
  return { kind: 'noop' };
}

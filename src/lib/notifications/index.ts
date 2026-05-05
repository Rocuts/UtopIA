/**
 * Public API surface for the WS6 notifications subsystem.
 *
 * Consumers (WS5 workflow, API routes, etc.) import from here.
 * Only the port interface and the concrete dispatch implementation
 * are exported — internal helpers (repo, client, templates) stay private.
 */

import { dispatch } from './dispatch';
import type { NotificationsPort } from './types';

export type {
  DispatchNotificationInput,
  DispatchResult,
  NotificationChannel,
  NotificationEvent,
  NotificationsPort,
  PeriodLockedPayload,
  ReconBrokenPayload,
  HealthFailedPayload,
  AnomalyPayload,
} from './types';

export { isNotificationsEnabled } from './types';

/**
 * The singleton port implementation.
 * Inject this wherever the NotificationsPort interface is required.
 */
export const notificationsPort: NotificationsPort = {
  dispatch,
};

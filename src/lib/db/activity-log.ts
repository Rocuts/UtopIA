// ---------------------------------------------------------------------------
// `logActivity` — bitácora general de actividad del sistema (fire-and-forget).
// ---------------------------------------------------------------------------
//
// Escribe una row en `system_activity_log` (ver schema-activity.ts) y, en
// paralelo, emite una línea JSON estructurada a consola (drenable a Datadog/
// Logtail). Es el único punto de escritura del log de actividad.
//
// CONTRATO: SIEMPRE fire-and-forget. Cualquier excepción se traga + loguea.
// La bitácora NUNCA debe romper el request que la origina. Los callers usan
// `void logActivity({...})` sin await (o con `.catch(() => {})`).
//
// Uso típico:
//   void logActivity({ category: 'erp', action: 'erp.sync.completed',
//     level: 'info', message: 'Sync Siigo OK', workspaceId, durationMs });
//
// Para requests HTTP, `logApiActivity(req, {...})` extrae método/path/ip/UA.

import { getDb } from './client';
import { systemActivityLog, type NewSystemActivityLogRow } from './schema';

export type ActivityCategory =
  | 'api'
  | 'agent'
  | 'financial'
  | 'accounting'
  | 'tax'
  | 'erp'
  | 'notification'
  | 'auth'
  | 'security'
  | 'system';

export type ActivityLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogActivityInput {
  category: ActivityCategory;
  /** Identificador dot-notation del evento: 'erp.sync.failed', 'chat.message.sent'. */
  action: string;
  message: string;
  level?: ActivityLevel;
  workspaceId?: string | null;
  userId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  durationMs?: number | null;
  statusCode?: number | null;
  method?: string | null;
  path?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

const CONSOLE_ENABLED =
  typeof process !== 'undefined' && process.env.UTOPIA_ACTIVITY_LOG !== 'off';

/**
 * Persiste un evento de actividad. Fire-and-forget: nunca lanza.
 *
 * El truncado de campos de longitud acotada (category/action/level/...) se hace
 * defensivamente aquí para no violar los límites de varchar y abortar el insert.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  const level = input.level ?? 'info';

  // Mirror a consola estructurada (barato, no depende de la DB).
  if (CONSOLE_ENABLED) {
    try {
      console.log(
        `[activity] ${JSON.stringify({
          ts: new Date().toISOString(),
          category: input.category,
          action: input.action,
          level,
          message: input.message,
          workspaceId: input.workspaceId ?? undefined,
          durationMs: input.durationMs ?? undefined,
          statusCode: input.statusCode ?? undefined,
        })}`,
      );
    } catch {
      // Nunca romper por logging.
    }
  }

  try {
    const db = getDb();
    const row: NewSystemActivityLogRow = {
      category: trunc(input.category, 32),
      action: trunc(input.action, 96),
      level: trunc(level, 8),
      message: input.message,
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      resourceType: input.resourceType ? trunc(input.resourceType, 48) : null,
      resourceId: input.resourceId ?? null,
      durationMs: input.durationMs ?? null,
      statusCode: input.statusCode ?? null,
      method: input.method ? trunc(input.method, 8) : null,
      path: input.path ?? null,
      requestId: input.requestId ?? null,
      ip: input.ip ? trunc(input.ip, 64) : null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    };
    await db.insert(systemActivityLog).values(row);
  } catch (err) {
    // Fire-and-forget — la bitácora no debe romper el pipeline.
    console.error('[logActivity] insert failed:', err);
  }
}

/**
 * Conveniencia para route handlers: extrae método/path/ip/user-agent del
 * `Request` y los fusiona con el resto del evento. Fire-and-forget.
 */
export async function logApiActivity(
  req: Request,
  input: Omit<LogActivityInput, 'method' | 'path' | 'ip' | 'userAgent'>,
): Promise<void> {
  let method: string | null = null;
  let path: string | null = null;
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    method = req.method ?? null;
    const url = new URL(req.url);
    path = url.pathname;
    ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      null;
    userAgent = req.headers.get('user-agent');
  } catch {
    // Extracción best-effort; el evento se registra igual.
  }
  return logActivity({ ...input, method, path, ip, userAgent });
}

function trunc(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

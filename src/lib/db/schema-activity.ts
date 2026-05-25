// ─── Schema split: System Activity Log (Observabilidad — Admin Logs) ─────────
//
// system_activity_log ← bitácora general de actividad del sistema.
//
// A diferencia de `agent_telemetry` (solo llamadas LLM) o `notification_log`
// (solo envíos), esta tabla captura CUALQUIER evento del sistema: requests de
// API, sincronizaciones ERP, eventos de negocio (cierres, reportes), errores,
// y acciones de usuario. Es la fuente principal del visor unificado en /admin.
//
// Diseño:
//   - `workspaceId` es NULLABLE: muchos eventos son globales (cron, system,
//     security) y no pertenecen a un workspace. Cuando aplica, FK con cascade.
//   - `category` agrupa por dominio para filtrar en el visor.
//   - `level` permite filtrar por severidad (debug/info/warn/error).
//   - `metadata` (jsonb) lleva el detalle libre de cada evento.
//
// Escritura: SIEMPRE fire-and-forget via `logActivity()` en
// `src/lib/db/activity-log.ts`. La bitácora NUNCA debe romper un request.

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Ciclo 2-step seguro: workspaces se define antes de `export *` en schema.ts.
import { workspaces } from './schema';

// ---------------------------------------------------------------------------
// system_activity_log
// ---------------------------------------------------------------------------

/**
 * Una row por evento del sistema.
 *
 * `category` (taxonomía estable — el visor filtra por estos valores):
 *   - 'api'          ⇒ request a un route handler.
 *   - 'agent'        ⇒ pipeline / llamada a un agente IA (complementa agent_telemetry).
 *   - 'financial'    ⇒ generación de reportes financieros (NIIF/Strategy/Governance).
 *   - 'accounting'   ⇒ contabilidad: asientos, conciliación, cierres, periodos.
 *   - 'tax'          ⇒ motor tributario, planeación, sanciones.
 *   - 'erp'          ⇒ conexión / sincronización con ERPs.
 *   - 'notification' ⇒ despacho de notificaciones.
 *   - 'auth'         ⇒ login / sesión / acceso.
 *   - 'security'     ⇒ rate-limit, token inválido, intentos sospechosos.
 *   - 'system'       ⇒ cron, mantenimiento, jobs internos.
 *
 * `level`: 'debug' | 'info' | 'warn' | 'error'.
 *
 * `action`: identificador dot-notation del evento concreto, p.ej.
 *   'financial-report.niif.completed', 'erp.sync.failed', 'chat.message.sent'.
 */
export const systemActivityLog = pgTable(
  'system_activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Workspace asociado (nullable — eventos globales como cron/system no lo tienen). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    /** Identificador del usuario/actor si aplica (free-form, sin FK por ahora). */
    userId: text('user_id'),
    /** Dominio del evento (ver taxonomía arriba). */
    category: varchar('category', { length: 32 }).notNull(),
    /** Identificador dot-notation del evento concreto. */
    action: varchar('action', { length: 96 }).notNull(),
    /** Severidad. */
    level: varchar('level', { length: 8 }).notNull().default('info'),
    /** Resumen legible del evento (una línea). */
    message: text('message').notNull(),
    /** Tipo de recurso afectado: 'report' | 'journal_entry' | 'workspace' | etc. */
    resourceType: varchar('resource_type', { length: 48 }),
    /** Id del recurso afectado (free-form). */
    resourceId: text('resource_id'),
    /** Duración del evento en ms (requests, jobs). */
    durationMs: integer('duration_ms'),
    /** HTTP status code si el evento es un request. */
    statusCode: integer('status_code'),
    /** Método HTTP si aplica. */
    method: varchar('method', { length: 8 }),
    /** Ruta del request si aplica. */
    path: text('path'),
    /** Correlación: request id / SSE stream id. */
    requestId: text('request_id'),
    /** IP del cliente (si se extrae del request). */
    ip: varchar('ip', { length: 64 }),
    /** User-Agent del cliente. */
    userAgent: text('user_agent'),
    /** Detalle libre del evento. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byCreatedAt: index('sal_created_at_idx').on(t.createdAt),
    byCategory: index('sal_category_idx').on(t.category, t.createdAt),
    byLevel: index('sal_level_idx').on(t.level, t.createdAt),
    byWorkspace: index('sal_workspace_idx').on(t.workspaceId, t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Types inferidos
// ---------------------------------------------------------------------------

export type SystemActivityLogRow = typeof systemActivityLog.$inferSelect;
export type NewSystemActivityLogRow = typeof systemActivityLog.$inferInsert;

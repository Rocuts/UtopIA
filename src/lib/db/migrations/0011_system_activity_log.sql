-- ---------------------------------------------------------------------------
-- Migration: 0011_system_activity_log — Bitácora general de actividad (Admin Logs).
-- ---------------------------------------------------------------------------
-- Crea la tabla `system_activity_log`, fuente principal del visor unificado en
-- /admin. Captura cualquier evento del sistema (api, agent, financial, erp,
-- notification, auth, security, system) con nivel de severidad y metadata libre.
--
-- `workspace_id` es NULLABLE: muchos eventos son globales (cron/system) y no
-- pertenecen a un workspace. Cuando aplica, FK con cascade.
--
-- Aplicar con `npm run db:push` (recomendado — schema.ts es la fuente de verdad)
-- o ejecutando este SQL directamente. Idempotente (IF NOT EXISTS).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "system_activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" text,
  "category" varchar(32) NOT NULL,
  "action" varchar(96) NOT NULL,
  "level" varchar(8) NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "resource_type" varchar(48),
  "resource_id" text,
  "duration_ms" integer,
  "status_code" integer,
  "method" varchar(8),
  "path" text,
  "request_id" text,
  "ip" varchar(64),
  "user_agent" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Índices (el visor filtra por tiempo + categoría + nivel + workspace)
CREATE INDEX IF NOT EXISTS "sal_created_at_idx"
  ON "system_activity_log" ("created_at");
CREATE INDEX IF NOT EXISTS "sal_category_idx"
  ON "system_activity_log" ("category", "created_at");
CREATE INDEX IF NOT EXISTS "sal_level_idx"
  ON "system_activity_log" ("level", "created_at");
CREATE INDEX IF NOT EXISTS "sal_workspace_idx"
  ON "system_activity_log" ("workspace_id", "created_at");

-- ---------------------------------------------------------------------------
-- Migration: 0010_sentinel — Sentinel proactive alerts table (P6).
-- ---------------------------------------------------------------------------
-- Crea los enums + tabla `sentinel_alerts` con índice único por
-- (workspace_id, dedup_key) para garantizar idempotencia desde el orquestador.
-- ---------------------------------------------------------------------------

-- Enums
DO $$ BEGIN
  CREATE TYPE "sentinel_pillar" AS ENUM ('escudo', 'valor', 'verdad', 'futuro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sentinel_severity" AS ENUM ('critico', 'advertencia', 'informativo');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sentinel_status" AS ENUM ('pending', 'snoozed', 'resolved', 'escalated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tabla principal
CREATE TABLE IF NOT EXISTS "sentinel_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_id" uuid REFERENCES "accounting_periods"("id") ON DELETE SET NULL,
  "pillar" "sentinel_pillar" NOT NULL,
  "trigger_code" varchar(8) NOT NULL,
  "severity" "sentinel_severity" NOT NULL,
  "dedup_key" text NOT NULL,
  "status" "sentinel_status" NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL,
  "snoozed_until" timestamptz,
  "resolved_at" timestamptz,
  "resolved_by" uuid,
  "escalated_at" timestamptz,
  "repeated_count" integer NOT NULL DEFAULT 0,
  "last_notified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS "sentinel_alerts_workspace_dedup_unique"
  ON "sentinel_alerts" ("workspace_id", "dedup_key");
CREATE INDEX IF NOT EXISTS "sentinel_alerts_status_idx"
  ON "sentinel_alerts" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "sentinel_alerts_pillar_idx"
  ON "sentinel_alerts" ("workspace_id", "pillar");

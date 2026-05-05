-- ───────────────────────────────────────────────────────────────────────────
-- 0005_smart_tax — Ola 1+1 Élite (WS1)
--
-- Tablas:
--   uvt_constants             — histórico de UVT por año
--   tax_rules                 — catálogo de reglas (built-in + override por workspace)
--   third_party_tax_profile   — perfil tributario expandido del tercero
--   tax_engine_audits         — bitácora de decisiones del motor
--
-- Idempotente: usa CREATE TYPE/IF NOT EXISTS y CREATE TABLE/IF NOT EXISTS.
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "public"."tax_type" AS ENUM('IVA', 'RETEFUENTE', 'RETEIVA', 'ICA', 'CREE', 'INC');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."tax_regime_kind" AS ENUM(
    'gran_contribuyente',
    'autorretenedor',
    'regimen_comun',
    'regimen_simplificado',
    'regimen_simple',
    'persona_natural',
    'no_responsable_iva',
    'no_residente'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "uvt_constants" (
  "year" integer PRIMARY KEY NOT NULL,
  "value_cop" numeric(14, 2) NOT NULL,
  "decree_ref" text,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tax_rules" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid,
  "code" varchar(48) NOT NULL,
  "tax_type" "public"."tax_type" NOT NULL,
  "description" text NOT NULL,
  "rate" numeric(8, 6) NOT NULL,
  "base_account_code" varchar(16),
  "tax_account_code" varchar(16),
  "account_side" varchar(8) NOT NULL,
  "apply_threshold_uvt" numeric(12, 4),
  "apply_threshold_cop" numeric(20, 2),
  "applicable_triggers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_deductible" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "valid_from" timestamp with time zone,
  "valid_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "tax_rules"
    ADD CONSTRAINT "tax_rules_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tr_ws_code_uniq" ON "tax_rules" ("workspace_id", "code");
CREATE INDEX IF NOT EXISTS "tr_type_idx" ON "tax_rules" ("tax_type", "is_active");

CREATE TABLE IF NOT EXISTS "third_party_tax_profile" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "third_party_id" uuid NOT NULL,
  "regime" "public"."tax_regime_kind" DEFAULT 'persona_natural' NOT NULL,
  "is_gran_contribuyente" boolean DEFAULT false NOT NULL,
  "is_autorretenedor" boolean DEFAULT false NOT NULL,
  "is_responsable_iva" boolean DEFAULT true NOT NULL,
  "is_regimen_simple" boolean DEFAULT false NOT NULL,
  "city_code" varchar(8),
  "economic_activity" varchar(16),
  "resolution_ref" text,
  "notes" text,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "third_party_tax_profile"
    ADD CONSTRAINT "tptp_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "third_party_tax_profile"
    ADD CONSTRAINT "tptp_third_party_id_third_parties_id_fk"
    FOREIGN KEY ("third_party_id") REFERENCES "public"."third_parties"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tptp_ws_tp_uniq" ON "third_party_tax_profile" ("workspace_id", "third_party_id");

CREATE TABLE IF NOT EXISTS "tax_engine_audits" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "journal_entry_id" uuid,
  "matched_rule_ids" jsonb NOT NULL,
  "input_context" jsonb NOT NULL,
  "proposed_lines" jsonb NOT NULL,
  "applied_lines" jsonb,
  "override_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "tax_engine_audits"
    ADD CONSTRAINT "tea_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "tea_ws_idx" ON "tax_engine_audits" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "tea_entry_idx" ON "tax_engine_audits" ("journal_entry_id");

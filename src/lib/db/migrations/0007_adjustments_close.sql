-- ───────────────────────────────────────────────────────────────────────────
-- 0007_adjustments_close — Ola 1+1 Élite (WS4 + WS5)
--
-- Tablas:
--   fixed_assets         — activos fijos depreciables
--   deferred_assets      — gastos pagados anticipados a amortizar
--   provisions_config    — parámetros de provisiones laborales y fiscales
--   monthly_close_runs   — bitácora de workflows de cierre mensual durables
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "fixed_assets" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "code" varchar(32) NOT NULL,
  "name" text NOT NULL,
  "category" varchar(32) NOT NULL,
  "asset_account_id" uuid NOT NULL,
  "depreciation_account_id" uuid NOT NULL,
  "expense_account_id" uuid NOT NULL,
  "acquisition_date" timestamp with time zone NOT NULL,
  "acquisition_cost" numeric(20, 2) NOT NULL,
  "salvage_value" numeric(20, 2) DEFAULT '0' NOT NULL,
  "useful_life_months" integer NOT NULL,
  "depreciation_method" varchar(24) DEFAULT 'straight_line' NOT NULL,
  "accumulated_depreciation" numeric(20, 2) DEFAULT '0' NOT NULL,
  "last_depreciated_period_id" uuid,
  "active" boolean DEFAULT true NOT NULL,
  "disposed_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fa_useful_life_chk" CHECK ("useful_life_months" > 0 AND "useful_life_months" <= 1200),
  CONSTRAINT "fa_salvage_chk" CHECK ("salvage_value" >= 0 AND "salvage_value" <= "acquisition_cost")
);

DO $$ BEGIN
  ALTER TABLE "fixed_assets"
    ADD CONSTRAINT "fa_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "fixed_assets"
    ADD CONSTRAINT "fa_asset_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("asset_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "fixed_assets"
    ADD CONSTRAINT "fa_depreciation_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("depreciation_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "fixed_assets"
    ADD CONSTRAINT "fa_expense_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "fixed_assets"
    ADD CONSTRAINT "fa_last_depreciated_period_id_accounting_periods_id_fk"
    FOREIGN KEY ("last_depreciated_period_id") REFERENCES "public"."accounting_periods"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "fa_ws_code_uniq" ON "fixed_assets" ("workspace_id", "code");
CREATE INDEX IF NOT EXISTS "fa_category_idx" ON "fixed_assets" ("workspace_id", "category", "active");

CREATE TABLE IF NOT EXISTS "deferred_assets" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "description" text NOT NULL,
  "category" varchar(32) DEFAULT 'other' NOT NULL,
  "asset_account_id" uuid NOT NULL,
  "expense_account_id" uuid NOT NULL,
  "total_amount" numeric(20, 2) NOT NULL,
  "amortization_start" timestamp with time zone NOT NULL,
  "amortization_end" timestamp with time zone NOT NULL,
  "amortized_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
  "last_amortized_period_id" uuid,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "da_range_chk" CHECK ("amortization_end" > "amortization_start")
);

DO $$ BEGIN
  ALTER TABLE "deferred_assets"
    ADD CONSTRAINT "da_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deferred_assets"
    ADD CONSTRAINT "da_asset_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("asset_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deferred_assets"
    ADD CONSTRAINT "da_expense_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "deferred_assets"
    ADD CONSTRAINT "da_last_amortized_period_id_accounting_periods_id_fk"
    FOREIGN KEY ("last_amortized_period_id") REFERENCES "public"."accounting_periods"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "da_period_idx" ON "deferred_assets" ("workspace_id", "amortization_start", "amortization_end");

CREATE TABLE IF NOT EXISTS "provisions_config" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provision_type" varchar(32) NOT NULL,
  "rate" numeric(8, 6) NOT NULL,
  "base_account_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expense_account_id" uuid NOT NULL,
  "liability_account_id" uuid NOT NULL,
  "cadence" varchar(16) DEFAULT 'monthly' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "provisions_config"
    ADD CONSTRAINT "pc_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "provisions_config"
    ADD CONSTRAINT "pc_expense_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "provisions_config"
    ADD CONSTRAINT "pc_liability_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("liability_account_id") REFERENCES "public"."chart_of_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "pc_ws_type_uniq" ON "provisions_config" ("workspace_id", "provision_type");

CREATE TABLE IF NOT EXISTS "monthly_close_runs" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "period_id" uuid NOT NULL,
  "workflow_run_id" text,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "health_check_results" jsonb,
  "depreciation_entry_id" uuid,
  "amortization_entry_id" uuid,
  "provision_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "closing_entry_id" uuid,
  "previous_period_hash" varchar(64),
  "period_hash" varchar(64),
  "pdf_report_url" text,
  "excel_report_url" text,
  "notified_at" timestamp with time zone,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "error_message" text,
  "triggered_by" uuid
);

DO $$ BEGIN
  ALTER TABLE "monthly_close_runs"
    ADD CONSTRAINT "mcr_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "monthly_close_runs"
    ADD CONSTRAINT "mcr_period_id_accounting_periods_id_fk"
    FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "mcr_period_uniq" ON "monthly_close_runs" ("period_id");
CREATE INDEX IF NOT EXISTS "mcr_status_idx" ON "monthly_close_runs" ("workspace_id", "status", "started_at");

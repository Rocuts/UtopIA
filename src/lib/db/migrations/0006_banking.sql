-- ───────────────────────────────────────────────────────────────────────────
-- 0006_banking — Ola 1+1 Élite (WS3)
--
-- Tablas:
--   bank_accounts            — cuentas bancarias del workspace, mapeadas al PUC
--   bank_statement_imports   — cada subida de CSV/OFX
--   bank_transactions        — movimientos individuales (deduplicados por fingerprint)
--   bank_reconciliations     — snapshot del estado de conciliación por (período, cuenta)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "bank_name" text NOT NULL,
  "account_number" varchar(32) NOT NULL,
  "account_kind" varchar(16) DEFAULT 'savings' NOT NULL,
  "currency" varchar(3) DEFAULT 'COP' NOT NULL,
  "holder_name" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "bank_accounts"
    ADD CONSTRAINT "ba_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_accounts"
    ADD CONSTRAINT "ba_account_id_chart_of_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ba_ws_acc_uniq" ON "bank_accounts" ("workspace_id", "bank_name", "account_number");
CREATE INDEX IF NOT EXISTS "ba_account_idx" ON "bank_accounts" ("workspace_id", "account_id");

CREATE TABLE IF NOT EXISTS "bank_statement_imports" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "format" varchar(16) DEFAULT 'csv' NOT NULL,
  "period_start" timestamp with time zone,
  "period_end" timestamp with time zone,
  "starting_balance" numeric(20, 2),
  "ending_balance" numeric(20, 2),
  "transaction_count" integer DEFAULT 0 NOT NULL,
  "duplicates_skipped" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "imported_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "bank_statement_imports"
    ADD CONSTRAINT "bsi_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_statement_imports"
    ADD CONSTRAINT "bsi_bank_account_id_bank_accounts_id_fk"
    FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "bsi_bank_idx" ON "bank_statement_imports" ("bank_account_id", "created_at");

CREATE TABLE IF NOT EXISTS "bank_transactions" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "import_id" uuid,
  "posted_at" timestamp with time zone NOT NULL,
  "value_date" timestamp with time zone,
  "description" text NOT NULL,
  "reference" text,
  "amount" numeric(20, 2) NOT NULL,
  "running_balance" numeric(20, 2),
  "currency" varchar(3) DEFAULT 'COP' NOT NULL,
  "matched_journal_line_id" uuid,
  "match_confidence" numeric(4, 3),
  "match_method" varchar(16),
  "matched_at" timestamp with time zone,
  "matched_by" uuid,
  "external_id" text,
  "fingerprint" varchar(64) NOT NULL,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bt_confidence_chk"
    CHECK ("match_confidence" IS NULL OR ("match_confidence" >= 0 AND "match_confidence" <= 1))
);

DO $$ BEGIN
  ALTER TABLE "bank_transactions"
    ADD CONSTRAINT "bt_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_transactions"
    ADD CONSTRAINT "bt_bank_account_id_bank_accounts_id_fk"
    FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_transactions"
    ADD CONSTRAINT "bt_import_id_bank_statement_imports_id_fk"
    FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "bt_ws_acc_fp_uniq" ON "bank_transactions" ("workspace_id", "bank_account_id", "fingerprint");
CREATE INDEX IF NOT EXISTS "bt_posted_idx" ON "bank_transactions" ("workspace_id", "bank_account_id", "posted_at");
CREATE INDEX IF NOT EXISTS "bt_unmatched_idx" ON "bank_transactions" ("workspace_id", "bank_account_id", "matched_journal_line_id");

CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "period_id" uuid NOT NULL,
  "ledger_balance" numeric(20, 2) NOT NULL,
  "bank_balance" numeric(20, 2) NOT NULL,
  "difference" numeric(20, 2) NOT NULL,
  "matched_count" integer DEFAULT 0 NOT NULL,
  "unmatched_count" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "reconciled_at" timestamp with time zone,
  "reconciled_by" uuid,
  "notes" text,
  "details_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "bank_reconciliations"
    ADD CONSTRAINT "br_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_reconciliations"
    ADD CONSTRAINT "br_bank_account_id_bank_accounts_id_fk"
    FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_reconciliations"
    ADD CONSTRAINT "br_period_id_accounting_periods_id_fk"
    FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "br_period_idx" ON "bank_reconciliations" ("workspace_id", "period_id", "bank_account_id");

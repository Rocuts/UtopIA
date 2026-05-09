CREATE TYPE "public"."tax_regime_kind" AS ENUM('gran_contribuyente', 'autorretenedor', 'regimen_comun', 'regimen_simplificado', 'regimen_simple', 'persona_natural', 'no_responsable_iva', 'no_residente');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('IVA', 'RETEFUENTE', 'RETEIVA', 'ICA', 'CREE', 'INC');--> statement-breakpoint
CREATE TYPE "public"."sentinel_pillar" AS ENUM('escudo', 'valor', 'verdad', 'futuro');--> statement-breakpoint
CREATE TYPE "public"."sentinel_severity" AS ENUM('critico', 'advertencia', 'informativo');--> statement-breakpoint
CREATE TYPE "public"."sentinel_status" AS ENUM('pending', 'snoozed', 'resolved', 'escalated');--> statement-breakpoint
CREATE TABLE "erp_account_mapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"erp_account" text NOT NULL,
	"puc_account" text NOT NULL,
	"puc_name" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"ipc" real NOT NULL,
	"trm" real NOT NULL,
	"tasa_banrep" real NOT NULL,
	"fuente" text NOT NULL,
	"fecha_actualizacion" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_engine_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"matched_rule_ids" jsonb NOT NULL,
	"input_context" jsonb NOT NULL,
	"proposed_lines" jsonb NOT NULL,
	"applied_lines" jsonb,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"code" varchar(48) NOT NULL,
	"tax_type" "tax_type" NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "third_party_tax_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"third_party_id" uuid NOT NULL,
	"regime" "tax_regime_kind" DEFAULT 'persona_natural' NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "uvt_constants" (
	"year" integer PRIMARY KEY NOT NULL,
	"value_cop" numeric(14, 2) NOT NULL,
	"decree_ref" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	CONSTRAINT "bt_confidence_chk" CHECK ("bank_transactions"."match_confidence" IS NULL OR ("bank_transactions"."match_confidence" >= 0 AND "bank_transactions"."match_confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "deferred_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	CONSTRAINT "da_range_chk" CHECK ("deferred_assets"."amortization_end" > "deferred_assets"."amortization_start")
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	CONSTRAINT "fa_useful_life_chk" CHECK ("fixed_assets"."useful_life_months" > 0 AND "fixed_assets"."useful_life_months" <= 1200),
	CONSTRAINT "fa_salvage_chk" CHECK ("fixed_assets"."salvage_value" >= 0 AND "fixed_assets"."salvage_value" <= "fixed_assets"."acquisition_cost")
);
--> statement-breakpoint
CREATE TABLE "monthly_close_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "provisions_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subscription_id" uuid,
	"event" varchar(48) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"recipient_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"provider_message_id" text,
	"idempotency_key" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"recipient_id" text NOT NULL,
	"email" text,
	"web_push_endpoint" text,
	"web_push_p256dh" text,
	"web_push_auth" text,
	"whatsapp_number" text,
	"user_agent" text,
	"label" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sentinel_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_id" uuid,
	"pillar" "sentinel_pillar" NOT NULL,
	"trigger_code" varchar(8) NOT NULL,
	"severity" "sentinel_severity" NOT NULL,
	"dedup_key" text NOT NULL,
	"status" "sentinel_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"escalated_at" timestamp with time zone,
	"repeated_count" integer DEFAULT 0 NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "representante_legal_nombre" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "revisor_fiscal_nombre" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "revisor_fiscal_tp" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "contador_publico_nombre" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "contador_publico_tp" text;--> statement-breakpoint
ALTER TABLE "erp_account_mapping" ADD CONSTRAINT "erp_account_mapping_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_engine_audits" ADD CONSTRAINT "tax_engine_audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_tax_profile" ADD CONSTRAINT "third_party_tax_profile_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_tax_profile" ADD CONSTRAINT "third_party_tax_profile_third_party_id_third_parties_id_fk" FOREIGN KEY ("third_party_id") REFERENCES "public"."third_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_import_id_bank_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferred_assets" ADD CONSTRAINT "deferred_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferred_assets" ADD CONSTRAINT "deferred_assets_asset_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferred_assets" ADD CONSTRAINT "deferred_assets_expense_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferred_assets" ADD CONSTRAINT "deferred_assets_last_amortized_period_id_accounting_periods_id_fk" FOREIGN KEY ("last_amortized_period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("depreciation_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expense_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_last_depreciated_period_id_accounting_periods_id_fk" FOREIGN KEY ("last_depreciated_period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close_runs" ADD CONSTRAINT "monthly_close_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close_runs" ADD CONSTRAINT "monthly_close_runs_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisions_config" ADD CONSTRAINT "provisions_config_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisions_config" ADD CONSTRAINT "provisions_config_expense_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisions_config" ADD CONSTRAINT "provisions_config_liability_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("liability_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_subscription_id_notification_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."notification_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentinel_alerts" ADD CONSTRAINT "sentinel_alerts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentinel_alerts" ADD CONSTRAINT "sentinel_alerts_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erp_mapping_unique_idx" ON "erp_account_mapping" USING btree ("workspace_id","provider","erp_account");--> statement-breakpoint
CREATE INDEX "tea_ws_idx" ON "tax_engine_audits" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "tea_entry_idx" ON "tax_engine_audits" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tr_ws_code_uniq" ON "tax_rules" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "tr_type_idx" ON "tax_rules" USING btree ("tax_type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "tptp_ws_tp_uniq" ON "third_party_tax_profile" USING btree ("workspace_id","third_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ba_ws_acc_uniq" ON "bank_accounts" USING btree ("workspace_id","bank_name","account_number");--> statement-breakpoint
CREATE INDEX "ba_account_idx" ON "bank_accounts" USING btree ("workspace_id","account_id");--> statement-breakpoint
CREATE INDEX "br_period_idx" ON "bank_reconciliations" USING btree ("workspace_id","period_id","bank_account_id");--> statement-breakpoint
CREATE INDEX "bsi_bank_idx" ON "bank_statement_imports" USING btree ("bank_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bt_ws_acc_fp_uniq" ON "bank_transactions" USING btree ("workspace_id","bank_account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "bt_posted_idx" ON "bank_transactions" USING btree ("workspace_id","bank_account_id","posted_at");--> statement-breakpoint
CREATE INDEX "bt_unmatched_idx" ON "bank_transactions" USING btree ("workspace_id","bank_account_id","matched_journal_line_id");--> statement-breakpoint
CREATE INDEX "da_period_idx" ON "deferred_assets" USING btree ("workspace_id","amortization_start","amortization_end");--> statement-breakpoint
CREATE UNIQUE INDEX "fa_ws_code_uniq" ON "fixed_assets" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "fa_category_idx" ON "fixed_assets" USING btree ("workspace_id","category","active");--> statement-breakpoint
CREATE UNIQUE INDEX "mcr_period_uniq" ON "monthly_close_runs" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "mcr_status_idx" ON "monthly_close_runs" USING btree ("workspace_id","status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pc_ws_type_uniq" ON "provisions_config" USING btree ("workspace_id","provision_type");--> statement-breakpoint
CREATE UNIQUE INDEX "nl_idempotency_uniq" ON "notification_log" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "nl_event_idx" ON "notification_log" USING btree ("workspace_id","event","sent_at");--> statement-breakpoint
CREATE INDEX "nl_status_idx" ON "notification_log" USING btree ("workspace_id","status","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ns_ws_channel_rec_uniq" ON "notification_subscriptions" USING btree ("workspace_id","channel","recipient_id");--> statement-breakpoint
CREATE INDEX "ns_channel_idx" ON "notification_subscriptions" USING btree ("workspace_id","channel","active");--> statement-breakpoint
CREATE UNIQUE INDEX "sentinel_alerts_workspace_dedup_unique" ON "sentinel_alerts" USING btree ("workspace_id","dedup_key");--> statement-breakpoint
CREATE INDEX "sentinel_alerts_status_idx" ON "sentinel_alerts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "sentinel_alerts_pillar_idx" ON "sentinel_alerts" USING btree ("workspace_id","pillar");
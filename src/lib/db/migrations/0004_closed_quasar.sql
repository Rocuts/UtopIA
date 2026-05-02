-- Ola 1.A — Núcleo contable (chart_of_accounts, accounting_periods,
-- third_parties, cost_centers, journal_entries, journal_lines).
--
-- Notas de idempotencia:
--   * Esta migración fue regenerada por drizzle-kit y, por causa del
--     drift previo de Ola 0, también re-incluyó CREATE TABLE para las
--     tablas pyme_* / rag_chunks que ya fueron creadas por 0003. Para
--     que el migrator no falle al aplicarla, se usaron CREATE TABLE
--     IF NOT EXISTS en esas tablas y `ADD COLUMN IF NOT EXISTS` en el
--     ALTER de repair_adjustments.period.
--   * Los enums (account_type, entry_status, period_status, source_type)
--     se crean con `DO $$ … EXCEPTION WHEN duplicate_object` para que
--     re-aplicarlas sea seguro (DROP TYPE IF EXISTS no es trivial con
--     dependencias).
DO $$ BEGIN
 CREATE TYPE "public"."account_type" AS ENUM('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO', 'ORDEN_DEUDORA', 'ORDEN_ACREEDORA');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."entry_status" AS ENUM('draft', 'posted', 'reversed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."period_status" AS ENUM('open', 'closed', 'locked');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."source_type" AS ENUM('manual', 'import', 'invoice', 'payment', 'depreciation', 'adjustment', 'closing', 'reversal', 'ai_generated', 'opening');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"locked_at" timestamp with time zone,
	CONSTRAINT "period_month_chk" CHECK ("accounting_periods"."month" BETWEEN 1 AND 13)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"parent_id" uuid,
	"level" integer NOT NULL,
	"is_postable" boolean DEFAULT false NOT NULL,
	"currency" varchar(3) DEFAULT 'COP' NOT NULL,
	"requires_third_party" boolean DEFAULT false NOT NULL,
	"requires_cost_center" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"entry_number" integer NOT NULL,
	"entry_date" timestamp with time zone NOT NULL,
	"status" "entry_status" DEFAULT 'draft' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"reversal_of_entry_id" uuid,
	"reversed_by_entry_id" uuid,
	"source_type" "source_type" DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"source_ref" text,
	"description" text NOT NULL,
	"total_debit" numeric(20, 2) NOT NULL,
	"total_credit" numeric(20, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'COP' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "je_balanced_chk" CHECK ("journal_entries"."total_debit" = "journal_entries"."total_credit")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"third_party_id" uuid,
	"cost_center_id" uuid,
	"debit" numeric(20, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(20, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'COP' NOT NULL,
	"exchange_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"functional_debit" numeric(20, 2) DEFAULT '0' NOT NULL,
	"functional_credit" numeric(20, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"dimensions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jl_single_side_chk" CHECK ("journal_lines"."debit" >= 0 AND "journal_lines"."credit" >= 0 AND ("journal_lines"."debit" = 0 OR "journal_lines"."credit" = 0)),
	CONSTRAINT "jl_positive_chk" CHECK ("journal_lines"."debit" + "journal_lines"."credit" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pyme_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'COP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pyme_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"puc_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pyme_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"upload_id" uuid,
	"entry_date" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"category" text,
	"puc_hint" text,
	"source_image_url" text,
	"source_page" integer,
	"raw_ocr_text" text,
	"confidence" numeric(4, 3),
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pyme_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"page_count" integer DEFAULT 1 NOT NULL,
	"ocr_status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"source" text NOT NULL,
	"doc_type" varchar(64),
	"entity" varchar(64),
	"year" integer,
	"section" text,
	"content" text NOT NULL,
	"contextual_prefix" text,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "third_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"identification_type" varchar(8) NOT NULL,
	"identification" varchar(32) NOT NULL,
	"verification_digit" varchar(1),
	"legal_name" text NOT NULL,
	"trade_name" text,
	"tax_regime" varchar(32),
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"is_employee" boolean DEFAULT false NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" varchar(64),
	"country" varchar(3) DEFAULT 'COL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repair_adjustments" ADD COLUMN IF NOT EXISTS "period" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_third_party_id_third_parties_id_fk" FOREIGN KEY ("third_party_id") REFERENCES "public"."third_parties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pyme_books" ADD CONSTRAINT "pyme_books_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pyme_categories" ADD CONSTRAINT "pyme_categories_book_id_pyme_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."pyme_books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pyme_entries" ADD CONSTRAINT "pyme_entries_book_id_pyme_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."pyme_books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pyme_entries" ADD CONSTRAINT "pyme_entries_upload_id_pyme_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."pyme_uploads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pyme_uploads" ADD CONSTRAINT "pyme_uploads_book_id_pyme_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."pyme_books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "third_parties" ADD CONSTRAINT "third_parties_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "period_ws_ym_uniq" ON "accounting_periods" USING btree ("workspace_id","year","month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "period_ws_status_idx" ON "accounting_periods" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coa_ws_code_uniq" ON "chart_of_accounts" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coa_parent_idx" ON "chart_of_accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coa_ws_type_idx" ON "chart_of_accounts" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cc_ws_code_uniq" ON "cost_centers" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "je_ws_period_num_uniq" ON "journal_entries" USING btree ("workspace_id","period_id","entry_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "je_ws_date_idx" ON "journal_entries" USING btree ("workspace_id","entry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "je_ws_period_status_idx" ON "journal_entries" USING btree ("workspace_id","period_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "je_source_idx" ON "journal_entries" USING btree ("workspace_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jl_entry_line_uniq" ON "journal_lines" USING btree ("entry_id","line_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jl_ws_account_idx" ON "journal_lines" USING btree ("workspace_id","account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jl_ws_tp_idx" ON "journal_lines" USING btree ("workspace_id","third_party_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jl_ws_cc_idx" ON "journal_lines" USING btree ("workspace_id","cost_center_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_ws_idx" ON "rag_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_source_idx" ON "rag_chunks" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_ws_id_uniq" ON "third_parties" USING btree ("workspace_id","identification_type","identification");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_ws_active_idx" ON "third_parties" USING btree ("workspace_id","active");

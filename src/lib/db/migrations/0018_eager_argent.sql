CREATE TYPE "public"."fact_kind" AS ENUM('narrative', 'donation', 'leasing', 'loss_carryforward');--> statement-breakpoint
CREATE TYPE "public"."fact_source" AS ENUM('chat', 'manual');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "agent_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"report_id" uuid,
	"agent_name" text NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"cached_input_tokens" integer,
	"cost_usd_micros" integer,
	"elapsed_ms" integer NOT NULL,
	"finish_reason" text,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"first_pass_reasoning_tokens" integer,
	"first_pass_finish_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pyme_empleados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text DEFAULT 'empleado' NOT NULL,
	"cargo" text,
	"tipo_contrato" text,
	"salario_cop" numeric(14, 2) NOT NULL,
	"eps" text,
	"afp" text,
	"arl" text,
	"arl_clase" integer DEFAULT 1,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pyme_tax_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"annual_sales_cop" numeric(20, 2) NOT NULL,
	"rst_group" text NOT NULL,
	"rst_cop" numeric(20, 2) NOT NULL,
	"ordinario_cop" numeric(20, 2) NOT NULL,
	"recommended" text NOT NULL,
	"savings_cop" numeric(20, 2) NOT NULL,
	"semaforo_level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_decision_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"rule_key" varchar(64) NOT NULL,
	"rule_version" varchar(32) NOT NULL,
	"inputs" jsonb NOT NULL,
	"resultado" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "fact_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"structured" jsonb,
	"fiscal_period" varchar(8),
	"status" "fact_status" DEFAULT 'active' NOT NULL,
	"superseded_by_id" uuid,
	"source" "fact_source" DEFAULT 'chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" text,
	"category" varchar(32) NOT NULL,
	"action" varchar(96) NOT NULL,
	"level" varchar(8) DEFAULT 'info' NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete',
	"period_start" timestamp,
	"period_end" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"display_name" text,
	"stripe_customer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "agent_telemetry" ADD CONSTRAINT "agent_telemetry_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_telemetry" ADD CONSTRAINT "agent_telemetry_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pyme_empleados" ADD CONSTRAINT "pyme_empleados_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pyme_tax_calculations" ADD CONSTRAINT "pyme_tax_calculations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decision_records" ADD CONSTRAINT "fact_decision_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decision_records" ADD CONSTRAINT "fact_decision_records_fact_id_workspace_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."workspace_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_facts" ADD CONSTRAINT "workspace_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_facts" ADD CONSTRAINT "workspace_facts_superseded_by_id_workspace_facts_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."workspace_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_activity_log" ADD CONSTRAINT "system_activity_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pe_ws_idx" ON "pyme_empleados" USING btree ("workspace_id","activo");--> statement-breakpoint
CREATE INDEX "ptc_ws_idx" ON "pyme_tax_calculations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_facts_reconcile" ON "workspace_facts" USING btree ("workspace_id","kind","fiscal_period","status");--> statement-breakpoint
CREATE INDEX "sal_created_at_idx" ON "system_activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sal_category_idx" ON "system_activity_log" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "sal_level_idx" ON "system_activity_log" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "sal_workspace_idx" ON "system_activity_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
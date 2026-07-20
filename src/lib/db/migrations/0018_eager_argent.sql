CREATE TYPE "public"."fact_kind" AS ENUM('narrative', 'donation', 'leasing', 'loss_carryforward');--> statement-breakpoint
CREATE TYPE "public"."fact_source" AS ENUM('chat', 'manual');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('active', 'revoked');--> statement-breakpoint
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
ALTER TABLE "fact_decision_records" ADD CONSTRAINT "fact_decision_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_decision_records" ADD CONSTRAINT "fact_decision_records_fact_id_workspace_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."workspace_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_facts" ADD CONSTRAINT "workspace_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_facts" ADD CONSTRAINT "workspace_facts_superseded_by_id_workspace_facts_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."workspace_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_facts_reconcile" ON "workspace_facts" USING btree ("workspace_id","kind","fiscal_period","status");

CREATE TABLE "repair_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"adjustment_id" text NOT NULL,
	"account_code" text NOT NULL,
	"account_name" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"rationale" text NOT NULL,
	"status" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" text NOT NULL,
	"error_message" text NOT NULL,
	"raw_csv" text,
	"language" text NOT NULL,
	"company_name" text,
	"period" text,
	"provisional" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_sessions_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "repair_adjustments" ADD CONSTRAINT "repair_adjustments_session_id_repair_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."repair_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_sessions" ADD CONSTRAINT "repair_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
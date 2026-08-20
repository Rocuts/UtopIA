CREATE TABLE "api_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"idem_key" varchar(255) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"pepper_version" smallint DEFAULT 1 NOT NULL,
	"prefix" text NOT NULL,
	"last4" varchar(4) NOT NULL,
	"scopes" text[] NOT NULL,
	"rpm_read" integer DEFAULT 120 NOT NULL,
	"rpm_write" integer DEFAULT 20 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_by" text,
	"rotated_from_key_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_trial_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"period_label" text NOT NULL,
	"raw_rows_encrypted" text NOT NULL,
	"row_count" integer NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"preprocessor_version" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_webhook_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt_n" integer NOT NULL,
	"response_status" integer,
	"error" text,
	"elapsed_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] NOT NULL,
	"secret_encrypted" text NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"first_failing_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_webhook_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_rotated_from_key_id_api_keys_id_fk" FOREIGN KEY ("rotated_from_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_trial_balances" ADD CONSTRAINT "api_trial_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_webhook_attempts" ADD CONSTRAINT "api_webhook_attempts_message_id_api_webhook_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."api_webhook_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_webhook_endpoints" ADD CONSTRAINT "api_webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_webhook_messages" ADD CONSTRAINT "api_webhook_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_webhook_messages" ADD CONSTRAINT "api_webhook_messages_endpoint_id_api_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."api_webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_idem_scope_idx" ON "api_idempotency_keys" USING btree ("workspace_id","endpoint","idem_key");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_tb_workspace_created_idx" ON "api_trial_balances" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "api_wha_message_idx" ON "api_webhook_attempts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "api_whe_workspace_idx" ON "api_webhook_endpoints" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_whm_status_next_idx" ON "api_webhook_messages" USING btree ("status","next_attempt_at");
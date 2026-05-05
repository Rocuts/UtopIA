-- ───────────────────────────────────────────────────────────────────────────
-- 0008_notifications — Ola 1+1 Élite (WS6)
--
-- Tablas:
--   notification_subscriptions — suscripciones por canal (email/web_push/whatsapp)
--   notification_log           — bitácora de envíos para auditoría e idempotencia
--
-- MVP: solo el canal `email` está activo. Las columnas de Web Push y WhatsApp
-- existen ya para no migrar el schema cuando WS6.1 las habilite.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notification_subscriptions" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
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

DO $$ BEGIN
  ALTER TABLE "notification_subscriptions"
    ADD CONSTRAINT "ns_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ns_ws_channel_rec_uniq" ON "notification_subscriptions" ("workspace_id", "channel", "recipient_id");
CREATE INDEX IF NOT EXISTS "ns_channel_idx" ON "notification_subscriptions" ("workspace_id", "channel", "active");

CREATE TABLE IF NOT EXISTS "notification_log" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
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

DO $$ BEGIN
  ALTER TABLE "notification_log"
    ADD CONSTRAINT "nl_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "notification_log"
    ADD CONSTRAINT "nl_subscription_id_notification_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "public"."notification_subscriptions"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "nl_idempotency_uniq" ON "notification_log" ("workspace_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "nl_event_idx" ON "notification_log" ("workspace_id", "event", "sent_at");
CREATE INDEX IF NOT EXISTS "nl_status_idx" ON "notification_log" ("workspace_id", "status", "sent_at");

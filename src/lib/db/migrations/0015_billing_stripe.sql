-- Migration 0015 — Billing Stripe (@better-auth/stripe plugin)
-- Run via: npm run db:migrate
-- Required env (to ACTIVATE billing — schema is safe to apply without them):
--   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_PRO[, STRIPE_PRICE_ID_ENTERPRISE]
--
-- Column list mirrors the plugin schema exactly (@better-auth/stripe 1.6.16).
-- referenceId = BetterAuth user id (workspace plan resolves via workspaces.user_id).

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;

CREATE TABLE IF NOT EXISTS "subscription" (
  "id"                      TEXT PRIMARY KEY,
  "plan"                    TEXT NOT NULL,
  "reference_id"            TEXT NOT NULL,
  "stripe_customer_id"      TEXT,
  "stripe_subscription_id"  TEXT,
  "status"                  TEXT DEFAULT 'incomplete',
  "period_start"            TIMESTAMP,
  "period_end"              TIMESTAMP,
  "trial_start"             TIMESTAMP,
  "trial_end"               TIMESTAMP,
  "cancel_at_period_end"    BOOLEAN DEFAULT FALSE,
  "cancel_at"               TIMESTAMP,
  "canceled_at"             TIMESTAMP,
  "ended_at"                TIMESTAMP,
  "seats"                   INTEGER,
  "billing_interval"        TEXT,
  "stripe_schedule_id"      TEXT
);

-- Lookups: plan resolution by owner, webhook upserts by Stripe ids.
CREATE INDEX IF NOT EXISTS subscription_reference_id_idx
  ON "subscription" ("reference_id");
CREATE INDEX IF NOT EXISTS subscription_stripe_customer_id_idx
  ON "subscription" ("stripe_customer_id");
CREATE INDEX IF NOT EXISTS subscription_stripe_subscription_id_idx
  ON "subscription" ("stripe_subscription_id");

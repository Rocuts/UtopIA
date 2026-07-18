// ---------------------------------------------------------------------------
// BetterAuth tables — separate file to avoid circular imports with schema.ts.
//
// These tables are managed by BetterAuth. Do NOT modify column names — the
// drizzleAdapter reads them by exact name. Migrations: 0013_auth_tables.sql,
// 0015_billing_stripe.sql (subscription + user.stripe_customer_id).
//
// NOTE: this file is intentionally NOT re-exported from schema.ts — drizzle-kit
// must not own these tables (migrations are written manually, same as 0013).
// ---------------------------------------------------------------------------

import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const authUsers = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  displayName: text('display_name'),
  // @better-auth/stripe — Stripe Customer linked to this user.
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const authSessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
});

export const authAccounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const authVerifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// @better-auth/stripe — subscription lifecycle (plan free/pro/enterprise).
// Field list mirrors the plugin schema EXACTLY (verified against the installed
// @better-auth/stripe 1.6.16 — plugin.schema.subscription.fields). The plugin
// writes these rows from Stripe webhooks; never mutate them by hand.
// `referenceId` is the owning entity — for UtopIA it is the BetterAuth user id
// (workspaces are 1:1 with users; the workspace plan resolves through
// workspaces.user_id → subscription.reference_id).
// ---------------------------------------------------------------------------

export const authSubscriptions = pgTable('subscription', {
  id: text('id').primaryKey(),
  plan: text('plan').notNull(),
  referenceId: text('reference_id').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status').default('incomplete'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  trialStart: timestamp('trial_start'),
  trialEnd: timestamp('trial_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  cancelAt: timestamp('cancel_at'),
  canceledAt: timestamp('canceled_at'),
  endedAt: timestamp('ended_at'),
  seats: integer('seats'),
  billingInterval: text('billing_interval'),
  stripeScheduleId: text('stripe_schedule_id'),
});

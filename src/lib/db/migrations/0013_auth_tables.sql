-- Migration 0013 — BetterAuth tables
-- Run after: npm run db:push or drizzle-kit migrate
-- Required env: BETTER_AUTH_SECRET, BETTER_AUTH_URL

CREATE TABLE IF NOT EXISTS "user" (
  "id"             TEXT PRIMARY KEY,
  "name"           TEXT NOT NULL,
  "email"          TEXT NOT NULL UNIQUE,
  "email_verified" BOOLEAN NOT NULL DEFAULT FALSE,
  "image"          TEXT,
  "display_name"   TEXT,
  "created_at"     TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"          TEXT PRIMARY KEY,
  "expires_at"  TIMESTAMP NOT NULL,
  "token"       TEXT NOT NULL UNIQUE,
  "created_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "ip_address"  TEXT,
  "user_agent"  TEXT,
  "user_id"     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                        TEXT PRIMARY KEY,
  "account_id"                TEXT NOT NULL,
  "provider_id"               TEXT NOT NULL,
  "user_id"                   TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token"              TEXT,
  "refresh_token"             TEXT,
  "id_token"                  TEXT,
  "access_token_expires_at"   TIMESTAMP,
  "refresh_token_expires_at"  TIMESTAMP,
  "scope"                     TEXT,
  "password"                  TEXT,
  "created_at"                TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"                TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"          TEXT PRIMARY KEY,
  "identifier"  TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "expires_at"  TIMESTAMP NOT NULL,
  "created_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Link existing workspaces to users (nullable until migration is run)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES "user"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workspaces_user_id_idx ON workspaces (user_id);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session (user_id);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account (user_id);

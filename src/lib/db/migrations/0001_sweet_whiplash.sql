CREATE TABLE "verified_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"slug" text NOT NULL,
	"decree_number" text NOT NULL,
	"decree_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

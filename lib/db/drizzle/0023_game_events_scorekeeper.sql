CREATE TABLE IF NOT EXISTS "game_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "fixture_id" integer NOT NULL REFERENCES "fixtures"("id") ON DELETE cascade,
  "team_id" integer REFERENCES "teams"("id") ON DELETE set null,
  "event_type" text NOT NULL,
  "player_id" integer REFERENCES "users"("id") ON DELETE set null,
  "value" integer DEFAULT 1 NOT NULL,
  "recorded_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

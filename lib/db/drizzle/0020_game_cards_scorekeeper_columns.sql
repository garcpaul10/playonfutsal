-- Add scorekeeper + clock/approval columns to game_cards
-- These columns were applied directly via executeSql on first deploy;
-- this file records the migration for future environments.

ALTER TABLE "game_cards"
  ADD COLUMN IF NOT EXISTS "scorekeeper_id"   integer REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "clock_state"      text,
  ADD COLUMN IF NOT EXISTS "accumulated_fouls" text,
  ADD COLUMN IF NOT EXISTS "goals"            text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "corrections"      text,
  ADD COLUMN IF NOT EXISTS "approved_at"      timestamp,
  ADD COLUMN IF NOT EXISTS "approved_by"      integer REFERENCES "users"("id");

-- Add waiver capture fields to league_registrations

ALTER TABLE league_registrations
  ADD COLUMN IF NOT EXISTS waiver_signed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS waiver_template_id integer;

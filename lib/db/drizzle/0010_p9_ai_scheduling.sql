-- P9: AI Scheduling — schema extensions + new tables

-- 1. Extend event_suggestions with P9 AI scheduling columns
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS suggested_start_date date;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS suggested_end_date date;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS suggested_court_id integer;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS suggested_capacity integer;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS suggested_duration_weeks integer;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS suggested_fee numeric(10, 2);
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS pricing_rule_id integer;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS season_alignment text;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS ai_raw_response text;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS adjusted_details text;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS locked_offering_type text;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS locked_offering_id integer;
ALTER TABLE event_suggestions ADD COLUMN IF NOT EXISTS locked_at timestamp with time zone;

-- 2. Extend schedule_proposals with P9 AI metadata columns
ALTER TABLE schedule_proposals ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE schedule_proposals ADD COLUMN IF NOT EXISTS ai_raw_response text;
ALTER TABLE schedule_proposals ADD COLUMN IF NOT EXISTS reoptimize_request text;
ALTER TABLE schedule_proposals ADD COLUMN IF NOT EXISTS reoptimize_count integer NOT NULL DEFAULT 0;
ALTER TABLE schedule_proposals ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;

-- 3. AI Calendar Sources — Fayette County Schools, KSSL, KPL, ECNL
CREATE TABLE IF NOT EXISTS ai_calendar_sources (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  source_type text NOT NULL DEFAULT 'youth_availability',
  fetch_url text,
  is_active boolean NOT NULL DEFAULT true,
  last_fetched_at timestamp with time zone,
  last_fetch_error text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. AI Calendar Dates — individual confirmed/unconfirmed dates per source
CREATE TABLE IF NOT EXISTS ai_calendar_dates (
  id serial PRIMARY KEY,
  source_id integer REFERENCES ai_calendar_sources(id) ON DELETE CASCADE,
  date date NOT NULL,
  label text,
  date_type text NOT NULL DEFAULT 'school_day',
  is_confirmed boolean NOT NULL DEFAULT false,
  confirmed_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_calendar_dates_source_date_idx ON ai_calendar_dates (source_id, date);
CREATE INDEX IF NOT EXISTS ai_calendar_dates_date_confirmed_idx ON ai_calendar_dates (date, is_confirmed);

-- 5. Seed the four known calendar sources
INSERT INTO ai_calendar_sources (name, slug, source_type, notes) VALUES
  ('Fayette County Public Schools', 'fayette-county-schools', 'youth_availability',
   'Primary youth scheduling constraint. Fetch public ICS when available; admin confirms dates.'),
  ('KSSL', 'kssl', 'alignment_hint',
   'Kentucky Soccer League — use as alignment hint when planning PlayOn seasons.'),
  ('KPL', 'kpl', 'alignment_hint',
   'Kentucky Premier League — use as alignment hint when planning PlayOn seasons.'),
  ('ECNL', 'ecnl', 'alignment_hint',
   'Elite Clubs National League — use as alignment hint when planning PlayOn seasons.')
ON CONFLICT (slug) DO NOTHING;

-- 6. DB-level conflict guardrail: prevent two proposals from publishing fixtures
--    that assign the same court at the exact same scheduled_at.
--    (The fixtures table already has court_id + scheduled_at; the server also checks ranges.)
CREATE UNIQUE INDEX IF NOT EXISTS fixtures_court_time_conflict_uq
  ON fixtures (court_id, scheduled_at)
  WHERE court_id IS NOT NULL AND scheduled_at IS NOT NULL;

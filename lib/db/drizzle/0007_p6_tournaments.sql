-- P6: Extend tournaments table + add tournament_registrations + tournament_seeds

-- 1. Add new columns to tournaments
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS bracket_format text NOT NULL DEFAULT 'single_elimination',
  ADD COLUMN IF NOT EXISTS has_group_stage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_stage_teams integer,
  ADD COLUMN IF NOT EXISTS playoff_teams integer,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS balance_due_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tiebreaker_rules text,
  ADD COLUMN IF NOT EXISTS consolation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seeding_method text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS venue_id integer;

-- 2. tournament_registrations
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id serial PRIMARY KEY,
  tournament_id integer NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id integer REFERENCES teams(id) ON DELETE SET NULL,
  registered_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  deposit_amount numeric(10,2) NOT NULL DEFAULT '0',
  deposit_paid boolean NOT NULL DEFAULT false,
  deposit_paid_at timestamp with time zone,
  total_amount numeric(10,2) NOT NULL DEFAULT '0',
  amount_paid numeric(10,2) NOT NULL DEFAULT '0',
  balance_due_date timestamp with time zone,
  payment_status text NOT NULL DEFAULT 'unpaid',
  payment_method text,
  status text NOT NULL DEFAULT 'active',
  balance_overridden_by_admin boolean NOT NULL DEFAULT false,
  waiver_signed boolean NOT NULL DEFAULT false,
  waiver_signed_at timestamp with time zone,
  waiver_template_id integer,
  self_checkin_confirmed boolean NOT NULL DEFAULT false,
  self_checkin_confirmed_at timestamp with time zone,
  self_checkin_roster_json text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tourney_reg_team
  ON tournament_registrations(tournament_id, team_id);

-- 3. tournament_seeds
CREATE TABLE IF NOT EXISTS tournament_seeds (
  id serial PRIMARY KEY,
  tournament_id integer NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  seed integer NOT NULL,
  group_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tourney_seed_team
  ON tournament_seeds(tournament_id, team_id);

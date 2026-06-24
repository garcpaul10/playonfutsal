-- P5 Leagues: new columns on leagues, teams; new tables team_members, league_registrations, league_free_agents

-- Extend leagues table
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS pricing_rule_id integer,
  ADD COLUMN IF NOT EXISTS division_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tiebreaker_rules text DEFAULT '["goal_difference","goals_for","head_to_head"]',
  ADD COLUMN IF NOT EXISTS playoff_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS playoff_teams integer DEFAULT 4,
  ADD COLUMN IF NOT EXISTS playoff_format text DEFAULT 'single_elimination',
  ADD COLUMN IF NOT EXISTS allow_free_agents boolean NOT NULL DEFAULT true;

-- Extend teams table
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS season_id integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Team roster / members
CREATE TABLE IF NOT EXISTS team_members (
  id serial PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'player',
  status text NOT NULL DEFAULT 'active',
  waiver_signed boolean NOT NULL DEFAULT false,
  waiver_signed_at timestamptz,
  waiver_template_id integer,
  jersey_number integer,
  added_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- League team registrations (deposit + balance tracking)
CREATE TABLE IF NOT EXISTS league_registrations (
  id serial PRIMARY KEY,
  league_id integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id integer REFERENCES teams(id) ON DELETE SET NULL,
  registered_by_user_id text NOT NULL,
  deposit_amount numeric(10,2) NOT NULL DEFAULT 0,
  deposit_paid boolean NOT NULL DEFAULT false,
  deposit_paid_at timestamptz,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  amount_paid numeric(10,2) NOT NULL DEFAULT 0,
  balance_due numeric(10,2) NOT NULL DEFAULT 0,
  balance_due_date date,
  payment_status text NOT NULL DEFAULT 'unpaid',
  payment_method text,
  status text NOT NULL DEFAULT 'pending',
  balance_overridden_by_admin boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Free-agent pool per league
CREATE TABLE IF NOT EXISTS league_free_agents (
  id serial PRIMARY KEY,
  league_id integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id integer REFERENCES teams(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  waiver_signed boolean NOT NULL DEFAULT false,
  waiver_signed_at timestamptz,
  waiver_template_id integer,
  notes text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

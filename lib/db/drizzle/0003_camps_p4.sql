-- P4: Camps — camp_days, camp_registrations, camps.pricing_rule_id
ALTER TABLE camps ADD COLUMN IF NOT EXISTS pricing_rule_id integer;

CREATE TABLE IF NOT EXISTS camp_days (
  id serial PRIMARY KEY,
  camp_id integer NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time text NOT NULL DEFAULT '09:00',
  end_time text NOT NULL DEFAULT '12:00',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS camp_registrations (
  id serial PRIMARY KEY,
  camp_id integer NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  payment_status text NOT NULL DEFAULT 'unpaid',
  price_paid numeric(10,2) NOT NULL DEFAULT 0,
  deposit_paid boolean NOT NULL DEFAULT false,
  deposit_amount numeric(10,2),
  balance_due numeric(10,2),
  waiver_signed_at timestamptz,
  waiver_template_id integer REFERENCES waiver_templates(id) ON DELETE SET NULL,
  waiver_version integer,
  guardian_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  guardian_signed_at timestamptz,
  photo_consent_given boolean NOT NULL DEFAULT false,
  sibling_number integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS camp_regs_camp_id ON camp_registrations(camp_id);
CREATE INDEX IF NOT EXISTS camp_regs_user_id ON camp_registrations(user_id);
CREATE INDEX IF NOT EXISTS camp_regs_player_user_id ON camp_registrations(player_user_id);
CREATE INDEX IF NOT EXISTS camp_days_camp_id ON camp_days(camp_id);

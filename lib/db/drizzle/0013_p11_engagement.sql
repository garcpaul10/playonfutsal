-- P11: Engagement & Family Experience
-- Notification preferences per user (one row per user per notification type)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  channel_email boolean NOT NULL DEFAULT true,
  channel_sms boolean NOT NULL DEFAULT false,
  channel_push boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notif_pref_user_type UNIQUE (user_id, notification_type)
);

-- Player stats (goals, assists, attendance streak, games played)
CREATE TABLE IF NOT EXISTS player_stats (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id integer,
  entity_type text,
  entity_id integer,
  goals_scored integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  games_played integer NOT NULL DEFAULT 0,
  games_attended integer NOT NULL DEFAULT 0,
  attendance_streak integer NOT NULL DEFAULT 0,
  best_attendance_streak integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- End-of-season / end-of-camp youth recaps
CREATE TABLE IF NOT EXISTS season_recaps (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  season_label text NOT NULL,
  games_played integer NOT NULL DEFAULT 0,
  games_attended integer NOT NULL DEFAULT 0,
  attendance_rate text,
  coach_note text,
  positive_highlight text,
  delivered_at timestamptz,
  delivery_channel text DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

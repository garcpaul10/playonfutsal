-- P10: AI Creation Agent — conversation sessions + payout rate configs

-- 1. AI creation sessions for conversational entity creation
CREATE TABLE IF NOT EXISTS ai_creation_sessions (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL DEFAULT 'unknown',
  thread TEXT NOT NULL DEFAULT '[]',
  partial_entity TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'drafting',
  created_entity_id INTEGER,
  created_entity_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Payout rate configs for role/event-type rate management
CREATE TABLE IF NOT EXISTS payout_rate_configs (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  rate_type TEXT NOT NULL DEFAULT 'flat_per_game',
  amount NUMERIC(10,2) NOT NULL,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_clerk_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

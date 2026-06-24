-- P7: Stripe/Payments migration
-- 1. stripe_events — idempotency dedup for Stripe webhook events
CREATE TABLE IF NOT EXISTS stripe_events (
  id serial PRIMARY KEY,
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT true,
  error_message text
);

-- 2. discount_codes
CREATE TABLE IF NOT EXISTS discount_codes (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  description text,
  discount_type text NOT NULL DEFAULT 'percent',
  discount_value numeric(10, 2) NOT NULL,
  applicable_to text NOT NULL DEFAULT 'all',
  entity_type text,
  entity_id integer,
  max_uses integer,
  times_used integer NOT NULL DEFAULT 0,
  min_order_amount numeric(10, 2),
  valid_from timestamp with time zone,
  valid_until timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  created_by_clerk_id text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 3. refund_credit_policies
CREATE TABLE IF NOT EXISTS refund_credit_policies (
  id serial PRIMARY KEY,
  name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'all',
  refund_type text NOT NULL DEFAULT 'credit',
  window_days integer NOT NULL DEFAULT 7,
  refund_percent numeric(5, 2) NOT NULL DEFAULT 100.00,
  credit_percent numeric(5, 2) NOT NULL DEFAULT 100.00,
  non_refundable_amount numeric(10, 2) NOT NULL DEFAULT 0,
  allow_partial_refund boolean NOT NULL DEFAULT true,
  requires_admin_approval boolean NOT NULL DEFAULT false,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. account_credits
CREATE TABLE IF NOT EXISTS account_credits (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL,
  remaining_amount numeric(10, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  reason text NOT NULL DEFAULT 'refund',
  source_entity_type text,
  source_entity_id integer,
  source_payment_id integer,
  expires_at timestamp with time zone,
  used_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 5. installment_schedules — tracks per-registration installment plans
CREATE TABLE IF NOT EXISTS installment_schedules (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  registration_id integer,
  total_amount numeric(10, 2) NOT NULL,
  paid_amount numeric(10, 2) NOT NULL DEFAULT 0,
  installment_count integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 6. installment_payments — individual payment milestones within a schedule
CREATE TABLE IF NOT EXISTS installment_payments (
  id serial PRIMARY KEY,
  schedule_id integer NOT NULL REFERENCES installment_schedules(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  amount numeric(10, 2) NOT NULL,
  due_date timestamp with time zone NOT NULL,
  paid_at timestamp with time zone,
  payment_id integer REFERENCES payments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  reminder_sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 7. Add provider_charge_id to payments if missing (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='payments' AND column_name='provider_charge_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN provider_charge_id text;
  END IF;
END $$;

-- 8. Add service_fee_amount to payments for accurate refund base tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='payments' AND column_name='service_fee_amount'
  ) THEN
    ALTER TABLE payments ADD COLUMN service_fee_amount numeric(10, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 9. Add play_blocked to league_registrations for balance enforcement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='league_registrations' AND column_name='play_blocked'
  ) THEN
    ALTER TABLE league_registrations ADD COLUMN play_blocked boolean NOT NULL DEFAULT false;
    ALTER TABLE league_registrations ADD COLUMN play_block_override_by text;
  END IF;
END $$;

-- 10. Add play_blocked to tournament_registrations for balance enforcement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tournament_registrations' AND column_name='play_blocked'
  ) THEN
    ALTER TABLE tournament_registrations ADD COLUMN play_blocked boolean NOT NULL DEFAULT false;
    ALTER TABLE tournament_registrations ADD COLUMN play_block_override_by text;
  END IF;
END $$;

-- 11. compensation_status on payments — atomic one-time compensation guard.
--     null = uncompensated; "refunded" = Stripe refund issued; "credited" = account credit issued.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS compensation_status text;

-- 12. Partial unique index on revenue_records(payment_id) for idempotent inserts.
--     ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL requires this index to exist.
CREATE UNIQUE INDEX IF NOT EXISTS revenue_records_payment_id_uq
  ON revenue_records (payment_id)
  WHERE payment_id IS NOT NULL;

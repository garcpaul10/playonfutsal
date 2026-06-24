-- P8: Stripe Connect / Payouts migration

-- 1. Add Stripe Connect fields to staff_profiles
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS connect_account_id text;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS connect_onboarding_status text NOT NULL DEFAULT 'pending';

-- 2. Extend payouts table with Connect-specific fields
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS assignment_id integer;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS connect_account_id text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS provider_transfer_id text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS approved_by_user_id integer;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS failure_reason text;

-- 3. Partial unique index: only one active payout per assignment at a time.
--    Failed / voided payouts are excluded so a retry can create a new record.
CREATE UNIQUE INDEX IF NOT EXISTS payouts_assignment_id_active_uq
  ON payouts (assignment_id)
  WHERE assignment_id IS NOT NULL
    AND status NOT IN ('failed', 'voided');

-- Migration 0017: redesign referrals for multi-use codes
-- Each referrer has one stable code (anchor row, referred_user_id IS NULL).
-- Each successful referral signup creates a separate attribution row (referred_user_id IS NOT NULL).

-- 1. Drop the global unique constraint on code (attribution rows share the same code as the anchor)
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_code_key;

-- 2. Partial unique index: each code may only appear once as an anchor
CREATE UNIQUE INDEX IF NOT EXISTS referrals_code_anchor_unique
  ON referrals (code)
  WHERE referred_user_id IS NULL;

-- 3. Partial unique index: each referred user can only ever be attributed once
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_user_unique
  ON referrals (referred_user_id)
  WHERE referred_user_id IS NOT NULL;

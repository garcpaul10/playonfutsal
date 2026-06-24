-- Migration: scoped admin permissions
-- Adds two-level admin system (super / scoped) and per-feature permission toggles on staff_profiles.

-- 1. Add admin_level column to users table (default 'super' so all existing admins are unchanged)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "admin_level" text NOT NULL DEFAULT 'super';

-- 2. Add three new permission toggle columns to staff_profiles
ALTER TABLE "staff_profiles"
  ADD COLUMN IF NOT EXISTS "can_manage_payouts"       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_manage_announcements" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_manage_game_cards"    boolean NOT NULL DEFAULT false;

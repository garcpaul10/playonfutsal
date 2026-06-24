-- P14: Referral program tables

CREATE TABLE IF NOT EXISTS "referral_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "reward_credit_cents" integer NOT NULL DEFAULT 1000,
  "is_enabled" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed a single config row
INSERT INTO "referral_config" ("id", "reward_credit_cents", "is_enabled")
VALUES (1, 1000, true)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "referrals" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL UNIQUE,
  "referrer_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "referred_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "status" text NOT NULL DEFAULT 'pending',
  "reward_credit_cents" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "redeemed_at" timestamp with time zone
);

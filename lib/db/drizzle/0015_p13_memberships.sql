-- P13 Memberships: add Stripe fields to membership_plans and users

ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id   text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;
